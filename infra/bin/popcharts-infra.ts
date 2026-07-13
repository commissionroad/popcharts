#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";

import { PopChartsInfraStack, type NetworkId } from "../lib/popcharts-infra-stack.js";

const app = new cdk.App();

const stage = readStringContext(app, "stage", "staging");
const network = readNetworkContext(app, "network", "baseSepolia");
const enableApiService = readBooleanContext(app, "enableApiService", false);
const enableIndexerService = readBooleanContext(app, "enableIndexerService", false);
const enableResolutionService = readBooleanContext(
  app,
  "enableResolutionService",
  false,
);
const enableServices = readBooleanContext(app, "enableServices", false);

new PopChartsInfraStack(app, `popcharts-${stage}`, {
  certificateArn: readOptionalStringContext(app, "certificateArn"),
  domainName: readOptionalStringContext(app, "domainName"),
  enableApiService: enableServices || enableApiService,
  enableIndexerService: enableServices || enableIndexerService,
  enableResolutionService: enableServices || enableResolutionService,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  network,
  pregradManagerAddress: readStringContext(
    app,
    "pregradManagerAddress",
    "0x0000000000000000000000000000000000000000",
  ),
  pregradManagerDeployBlock: readStringContext(
    app,
    "pregradManagerDeployBlock",
    "0",
  ),
  stage,
});

function readStringContext(app: cdk.App, key: string, fallback: string) {
  const value = app.node.tryGetContext(key);
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function readOptionalStringContext(app: cdk.App, key: string) {
  const value = app.node.tryGetContext(key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readBooleanContext(app: cdk.App, key: string, fallback: boolean) {
  const value = app.node.tryGetContext(key);
  if (value === undefined) {
    return fallback;
  }

  return value === true || value === "true";
}

function readNetworkContext(app: cdk.App, key: string, fallback: NetworkId) {
  const value = readStringContext(app, key, fallback);
  if (value === "base" || value === "baseSepolia") {
    return value;
  }

  throw new Error(`Unsupported network context '${value}'. Use baseSepolia or base.`);
}
