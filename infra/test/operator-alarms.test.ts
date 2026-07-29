// Assertion tests over the synthesized template (ADR 0017 track E). The AWS
// account is not usable, so nothing here proves an alarm fires; what it does
// prove is the seam that silently kills this kind of alarm — that each metric
// filter's terms actually occur in the log record the indexer emits, built
// here with the same shared formatter the indexer calls. This file is also the
// keeper for the intentionally duplicated marker terms: infra defines its own
// (the stack imports no server source) and this is what fails when they drift.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { PopChartsInfraStack } from "../lib/popcharts-infra-stack.js";
// The one place `infra/` reaches into another workspace's source, and only
// here: the stack itself imports nothing outside `infra/` (docs/architecture.md
// — "self-contained; imports no workspace source"). The alarms' marker terms
// are deliberately duplicated on the infra side, and this import is what keeps
// the duplicate honest — a test crossing the boundary to pin two masters, not
// shipped code depending across it.
import {
  formatOperatorAlert,
  OPERATOR_ALERT_EVENTS,
} from "../../server/src/shared/operator-alert-log.js";

const INDEXER_LOG_GROUP = "/ecs/popcharts-staging-indexer";

/**
 * One operator page: what the stack synthesizes for it, and a record the
 * indexer really emits for it, rendered by the shared formatter. Every alarm on
 * the indexer log group belongs here — one case pins that the set is complete,
 * so an alarm added without an entry fails rather than shipping with its terms
 * never checked against a real record.
 */
const OPERATOR_ALARMS = [
  {
    alarmName: "popcharts-staging-resolution-disputed",
    filterPattern: '"POPCHARTS_OPERATOR_ALERT" "resolution_disputed"',
    metricName: "ResolutionDisputed",
    record: formatOperatorAlert(OPERATOR_ALERT_EVENTS.resolutionDisputed, {
      bond: "100000000",
      chainId: 84532,
      disputer: "0x00000000000000000000000000000000000000ab",
      marketId: "7",
      postgradMarket: "0x00000000000000000000000000000000000000ee",
      transactionHash: `0x${"22".repeat(32)}`,
    }),
    title: "resolution dispute",
  },
  {
    alarmName: "popcharts-staging-market-status-out-of-order",
    filterPattern: '"POPCHARTS_OPERATOR_ALERT" "market_status_out_of_order"',
    metricName: "MarketStatusOutOfOrder",
    record: formatOperatorAlert(OPERATOR_ALERT_EVENTS.marketStatusOutOfOrder, {
      allowedFrom: "resolution_pending,graduated",
      chainId: 84532,
      currentStatus: "bootstrap",
      marketId: "7",
      targetStatus: "disputed",
    }),
    title: "out-of-order market status",
  },
] as const;

/** The routine line the postgrad-market watcher logs for every event. */
const ROUTINE_WATCHER_RECORD =
  "[PostgradMarket] market=0x00000000000000000000000000000000000000ee marketId=7 event=ResolutionDisputed";

function synthesize(operatorAlertEmail?: string): Template {
  const stack = new PopChartsInfraStack(new cdk.App(), "popcharts-staging", {
    enableApiService: false,
    enableIndexerService: false,
    enableResolutionService: false,
    env: { account: "111111111111", region: "us-east-1" },
    network: "baseSepolia",
    operatorAlertEmail,
    pregradManagerAddress: `0x${"00".repeat(20)}`,
    pregradManagerDeployBlock: "0",
    stage: "staging",
  });

  return Template.fromStack(stack);
}

/**
 * Splits a metric-filter pattern into the terms it requires. Matches each
 * double-quoted run, allowing backslash escapes inside it (`\\.` before the
 * negated class so an escaped quote does not end the run), then unescapes —
 * the inverse of how the pattern quotes each term.
 */
function requiredTerms(filterPattern: string): string[] {
  const quoted = filterPattern.match(/"(?:\\.|[^"\\])*"/g) ?? [];
  return quoted.map((term) => term.slice(1, -1).replace(/\\(.)/g, "$1"));
}

/** Logical id of the indexer log group, which filters reference by `Ref`. */
function indexerLogGroupId(template: Template): string {
  const ids = Object.keys(
    template.findResources("AWS::Logs::LogGroup", {
      Properties: { LogGroupName: INDEXER_LOG_GROUP },
    }),
  );

  assert.equal(ids.length, 1, `expected one ${INDEXER_LOG_GROUP} log group`);
  return ids[0]!;
}

/** Every filter pattern the synthesized stack puts on the indexer log group. */
function synthesizedIndexerFilterPatterns(): string[] {
  const template = synthesize();
  const logGroupId = indexerLogGroupId(template);

  return Object.values(template.findResources("AWS::Logs::MetricFilter"))
    .filter((filter) => filter.Properties.LogGroupName?.Ref === logGroupId)
    .map((filter) => filter.Properties.FilterPattern as string);
}

describe("indexer operator alarms", () => {
  it("puts exactly the pinned filters on the indexer log group", () => {
    assert.deepEqual(
      synthesizedIndexerFilterPatterns().sort(),
      OPERATOR_ALARMS.map((alarm) => alarm.filterPattern).sort(),
    );
  });

  for (const alarm of OPERATOR_ALARMS) {
    describe(`${alarm.title} alarm`, () => {
      it("filters the indexer log group on its marker terms", () => {
        const template = synthesize();

        template.hasResourceProperties("AWS::Logs::MetricFilter", {
          FilterPattern: alarm.filterPattern,
          LogGroupName: { Ref: indexerLogGroupId(template) },
          MetricTransformations: [
            Match.objectLike({
              MetricName: alarm.metricName,
              MetricNamespace: "PopCharts/staging",
              MetricValue: "1",
            }),
          ],
        });
      });

      it("matches the record the indexer actually emits", () => {
        const terms = requiredTerms(alarm.filterPattern);

        assert.ok(terms.length > 0, "filter pattern requires no terms");
        for (const term of terms) {
          assert.ok(
            alarm.record.includes(term),
            `emitted record is missing filter term ${term}: ${alarm.record}`,
          );
        }
      });

      it("does not match the watcher's routine per-event line", () => {
        assert.ok(
          requiredTerms(alarm.filterPattern).some(
            (term) => !ROUTINE_WATCHER_RECORD.includes(term),
          ),
          "every filter term occurs in an ordinary watcher log line",
        );
      });

      it("does not match another operator page on the same log group", () => {
        // Both filters carry the marker term and sit on one log group, so the
        // event term is the only thing telling them apart. If it stopped
        // discriminating, one incident would light every alarm.
        for (const other of OPERATOR_ALARMS) {
          if (other.metricName === alarm.metricName) {
            continue;
          }

          assert.ok(
            requiredTerms(alarm.filterPattern).some(
              (term) => !other.record.includes(term),
            ),
            `${alarm.title} filter also matches the ${other.title} record`,
          );
        }
      });

      it("pages on the first matching record and reads no data as no incident", () => {
        synthesize().hasResourceProperties("AWS::CloudWatch::Alarm", {
          AlarmName: alarm.alarmName,
          ComparisonOperator: "GreaterThanOrEqualToThreshold",
          DatapointsToAlarm: 1,
          EvaluationPeriods: 1,
          MetricName: alarm.metricName,
          Namespace: "PopCharts/staging",
          Period: 60,
          Statistic: "Sum",
          Threshold: 1,
          TreatMissingData: "notBreaching",
        });
      });

      it("notifies the operator topic", () => {
        const template = synthesize();
        const topicIds = Object.keys(
          template.findResources("AWS::SNS::Topic", {
            Properties: { TopicName: "popcharts-staging-operator-alerts" },
          }),
        );

        assert.equal(topicIds.length, 1);
        template.hasResourceProperties("AWS::CloudWatch::Alarm", {
          AlarmActions: [{ Ref: topicIds[0] }],
          AlarmName: alarm.alarmName,
        });
        template.hasOutput("OperatorAlertTopicArn", {});
      });
    });
  }
});

describe("operator alert subscription", () => {
  it("synthesizes with no subscriber when none is configured", () => {
    synthesize().resourceCountIs("AWS::SNS::Subscription", 0);
  });

  it("subscribes the configured address", () => {
    synthesize("oncall@example.com").hasResourceProperties(
      "AWS::SNS::Subscription",
      { Endpoint: "oncall@example.com", Protocol: "email" },
    );
  });
});
