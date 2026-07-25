// Assertion tests over the synthesized template (ADR 0017 track E). The AWS
// account is not usable, so nothing here proves the alarm fires; what it does
// prove is the seam that silently kills this kind of alarm — that the metric
// filter's terms actually occur in the log record the indexer emits, built
// here with the same shared formatter the indexer calls.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as cdk from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";

import { PopChartsInfraStack } from "../lib/popcharts-infra-stack.js";
import {
  formatOperatorAlert,
  OPERATOR_ALERT_EVENTS,
} from "../../server/src/shared/operator-alert-log.js";

const INDEXER_LOG_GROUP = "/ecs/popcharts-staging-indexer";
const DISPUTE_FILTER_PATTERN =
  '"POPCHARTS_OPERATOR_ALERT" "resolution_disputed"';

/** A record the indexer really emits, rendered by the shared formatter. */
const DISPUTE_ALERT_RECORD = formatOperatorAlert(
  OPERATOR_ALERT_EVENTS.resolutionDisputed,
  {
    bond: "100000000",
    chainId: 84532,
    disputer: "0x00000000000000000000000000000000000000ab",
    marketId: "7",
    postgradMarket: "0x00000000000000000000000000000000000000ee",
    transactionHash: `0x${"22".repeat(32)}`,
  },
);

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

/** The terms the synthesized dispute filter requires, read back out of it. */
function synthesizedDisputeTerms(): string[] {
  const template = synthesize();
  const logGroupId = indexerLogGroupId(template);
  const patterns = Object.values(
    template.findResources("AWS::Logs::MetricFilter"),
  )
    .filter((filter) => filter.Properties.LogGroupName?.Ref === logGroupId)
    .map((filter) => filter.Properties.FilterPattern as string);

  assert.deepEqual(patterns, [DISPUTE_FILTER_PATTERN]);
  return requiredTerms(patterns[0]!);
}

describe("resolution-dispute operator alarm", () => {
  it("filters the indexer log group on the dispute marker terms", () => {
    const template = synthesize();

    template.hasResourceProperties("AWS::Logs::MetricFilter", {
      FilterPattern: DISPUTE_FILTER_PATTERN,
      LogGroupName: { Ref: indexerLogGroupId(template) },
      MetricTransformations: [
        Match.objectLike({
          MetricName: "ResolutionDisputed",
          MetricNamespace: "PopCharts/staging",
          MetricValue: "1",
        }),
      ],
    });
  });

  it("matches the record the indexer actually emits", () => {
    const terms = synthesizedDisputeTerms();

    assert.ok(terms.length > 0, "filter pattern requires no terms");
    for (const term of terms) {
      assert.ok(
        DISPUTE_ALERT_RECORD.includes(term),
        `emitted dispute record is missing filter term ${term}: ${DISPUTE_ALERT_RECORD}`,
      );
    }
  });

  it("does not match the watcher's routine per-event line", () => {
    const terms = synthesizedDisputeTerms();

    assert.ok(
      terms.some((term) => !ROUTINE_WATCHER_RECORD.includes(term)),
      "every dispute filter term occurs in an ordinary watcher log line",
    );
  });

  it("pages on the first matching record and reads no data as no dispute", () => {
    synthesize().hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmName: "popcharts-staging-resolution-disputed",
      ComparisonOperator: "GreaterThanOrEqualToThreshold",
      DatapointsToAlarm: 1,
      EvaluationPeriods: 1,
      MetricName: "ResolutionDisputed",
      Namespace: "PopCharts/staging",
      Period: 60,
      Statistic: "Sum",
      Threshold: 1,
      TreatMissingData: "notBreaching",
    });
  });

  it("notifies the operator topic", () => {
    const template = synthesize();
    const topics = template.findResources("AWS::SNS::Topic", {
      Properties: { TopicName: "popcharts-staging-operator-alerts" },
    });
    const topicIds = Object.keys(topics);

    assert.equal(topicIds.length, 1);
    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      AlarmActions: [{ Ref: topicIds[0] }],
    });
    template.hasOutput("OperatorAlertTopicArn", {});
  });
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
