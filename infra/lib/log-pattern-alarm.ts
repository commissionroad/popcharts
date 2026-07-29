import * as cdk from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as cloudwatchActions from "aws-cdk-lib/aws-cloudwatch-actions";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

/** Inputs for {@link LogPatternAlarm}. */
export type LogPatternAlarmProps = {
  /** What happened and what the operator should do about it. */
  readonly alarmDescription: string;
  /** Stage-qualified name, e.g. `popcharts-staging-resolution-disputed`. */
  readonly alarmName: string;
  /** Which records count. Terms are matched case-sensitively. */
  readonly filterPattern: logs.IFilterPattern;
  /** Log group the service writes those records to. */
  readonly logGroup: logs.ILogGroup;
  /** Metric name under {@link LogPatternAlarmProps.metricNamespace}. */
  readonly metricName: string;
  /** Namespace for the derived metric, e.g. `PopCharts/staging`. */
  readonly metricNamespace: string;
  /** Where the notification goes. */
  readonly topic: sns.ITopic;
};

/**
 * Counts log records matching a pattern and pages on the first one — for
 * events that are incidents rather than volume, where any occurrence is worth
 * a human's attention (the resolution-dispute page of repo ADR 0024 phase 5 is
 * the first). Missing data is explicitly not a breach: a period with no
 * matching record is the normal case and must neither fire nor sit in
 * INSUFFICIENT_DATA.
 *
 * This is the repo's first alarm construct; the ADR 0015 backlog (ALB 5xx,
 * ECS restarts, RDS health, indexer cursor lag) should extend or copy it
 * rather than inline alarms into the stack.
 */
export class LogPatternAlarm extends Construct {
  /** The alarm, exposed so callers can attach further actions. */
  readonly alarm: cloudwatch.Alarm;
  /** The filter turning matching records into the alarm's metric. */
  readonly metricFilter: logs.MetricFilter;

  constructor(scope: Construct, id: string, props: LogPatternAlarmProps) {
    super(scope, id);

    this.metricFilter = new logs.MetricFilter(this, "MetricFilter", {
      filterPattern: props.filterPattern,
      logGroup: props.logGroup,
      metricName: props.metricName,
      metricNamespace: props.metricNamespace,
      // One data point per matching record, so Sum is an occurrence count.
      metricValue: "1",
    });

    this.alarm = new cloudwatch.Alarm(this, "Alarm", {
      alarmDescription: props.alarmDescription,
      alarmName: props.alarmName,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      datapointsToAlarm: 1,
      evaluationPeriods: 1,
      metric: this.metricFilter.metric({
        period: cdk.Duration.minutes(1),
        statistic: "Sum",
      }),
      threshold: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    this.alarm.addAlarmAction(new cloudwatchActions.SnsAction(props.topic));
  }
}
