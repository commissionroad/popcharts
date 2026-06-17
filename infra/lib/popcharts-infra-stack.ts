import * as cdk from "aws-cdk-lib";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as logs from "aws-cdk-lib/aws-logs";
import * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type { Construct } from "constructs";

export type NetworkId = "baseSepolia" | "base";

export type PopChartsInfraStackProps = cdk.StackProps & {
  certificateArn?: string;
  domainName?: string;
  enableApiService: boolean;
  enableIndexerService: boolean;
  network: NetworkId;
  pregradManagerAddress: string;
  pregradManagerDeployBlock: string;
  stage: string;
};

const DATABASE_NAME = "popcharts";
const DATABASE_USER = "popcharts";
const CONTAINER_PORT = 3000;

export class PopChartsInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PopChartsInfraStackProps) {
    super(scope, id, props);

    const isProduction = props.stage === "prod" || props.stage === "production";
    const namePrefix = `popcharts-${props.stage}`;
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: isProduction ? 2 : 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });

    const cluster = new ecs.Cluster(this, "Cluster", {
      clusterName: namePrefix,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
      vpc,
    });

    const serviceSecurityGroup = new ec2.SecurityGroup(
      this,
      "ServiceSecurityGroup",
      {
        allowAllOutbound: true,
        description: "Pop Charts ECS task egress",
        vpc,
      },
    );

    const databaseSecurityGroup = new ec2.SecurityGroup(
      this,
      "DatabaseSecurityGroup",
      {
        allowAllOutbound: true,
        description: "Pop Charts RDS ingress",
        vpc,
      },
    );

    const proxySecurityGroup = new ec2.SecurityGroup(
      this,
      "DatabaseProxySecurityGroup",
      {
        allowAllOutbound: true,
        description: "Pop Charts RDS Proxy ingress",
        vpc,
      },
    );

    const database = new rds.DatabaseInstance(this, "Database", {
      allocatedStorage: 20,
      autoMinorVersionUpgrade: true,
      backupRetention: cdk.Duration.days(isProduction ? 14 : 3),
      credentials: rds.Credentials.fromGeneratedSecret(DATABASE_USER),
      databaseName: DATABASE_NAME,
      deletionProtection: isProduction,
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.of("16.4", "16"),
      }),
      instanceType: isProduction
        ? ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.SMALL)
        : ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      maxAllocatedStorage: 100,
      multiAz: isProduction,
      publiclyAccessible: false,
      removalPolicy: isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      securityGroups: [databaseSecurityGroup],
      storageEncrypted: true,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    const databaseSecret = database.secret;
    if (!databaseSecret) {
      throw new Error("Expected the RDS database to create a credentials secret.");
    }
    databaseSecret.applyRemovalPolicy(
      isProduction ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    );

    const databaseProxy = new rds.DatabaseProxy(this, "DatabaseProxy", {
      dbProxyName: `${namePrefix}-db-proxy`,
      debugLogging: false,
      idleClientTimeout: cdk.Duration.minutes(30),
      proxyTarget: rds.ProxyTarget.fromInstance(database),
      requireTLS: true,
      secrets: [databaseSecret],
      securityGroups: [proxySecurityGroup],
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    databaseProxy.connections.allowFrom(
      serviceSecurityGroup,
      ec2.Port.tcp(5432),
      "Allow ECS tasks to connect to RDS Proxy",
    );

    const serverRepository = new ecr.Repository(this, "ServerRepository", {
      imageScanOnPush: true,
      repositoryName: `${namePrefix}-server`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const rpcWssSecret = new secretsmanager.Secret(this, "RpcWssSecret", {
      description: `WebSocket RPC URL for Pop Charts ${props.stage} ${props.network}`,
      removalPolicy: isProduction
        ? cdk.RemovalPolicy.RETAIN
        : cdk.RemovalPolicy.DESTROY,
      secretName: `/popcharts/${props.stage}/${props.network}/rpc-wss-url`,
    });

    const commonEnvironment = {
      DATABASE_HOST: databaseProxy.endpoint,
      DATABASE_NAME,
      DATABASE_PORT: "5432",
      DATABASE_SSL: "true",
      NETWORK: props.network,
      PREGRAD_MANAGER_ADDRESS: props.pregradManagerAddress,
      PREGRAD_MANAGER_DEPLOY_BLOCK: props.pregradManagerDeployBlock,
    };

    const databaseSecrets = {
      DATABASE_PASSWORD: ecs.Secret.fromSecretsManager(databaseSecret, "password"),
      DATABASE_USER: ecs.Secret.fromSecretsManager(databaseSecret, "username"),
    };

    const apiLogGroup = new logs.LogGroup(this, "ApiLogGroup", {
      logGroupName: `/ecs/${namePrefix}-api`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const indexerLogGroup = new logs.LogGroup(this, "IndexerLogGroup", {
      logGroupName: `/ecs/${namePrefix}-indexer`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const migrationLogGroup = new logs.LogGroup(this, "MigrationLogGroup", {
      logGroupName: `/ecs/${namePrefix}-migrations`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    const image = ecs.ContainerImage.fromEcrRepository(serverRepository, "latest");
    const apiTaskDefinition = new ecs.FargateTaskDefinition(this, "ApiTaskDefinition", {
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    apiTaskDefinition.addContainer("api", {
      command: ["bun", "/app/dist/api/index.js"],
      environment: {
        ...commonEnvironment,
        PORT: String(CONTAINER_PORT),
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          `bun --eval "fetch('http://localhost:${CONTAINER_PORT}/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"`,
        ],
        interval: cdk.Duration.seconds(30),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
        timeout: cdk.Duration.seconds(5),
      },
      image,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: apiLogGroup,
        streamPrefix: "api",
      }),
      portMappings: [
        {
          containerPort: CONTAINER_PORT,
          protocol: ecs.Protocol.TCP,
        },
      ],
      secrets: databaseSecrets,
    });

    const indexerTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "IndexerTaskDefinition",
      {
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      },
    );

    indexerTaskDefinition.addContainer("indexer", {
      command: ["bun", "/app/dist/indexer/index.js"],
      environment: {
        ...commonEnvironment,
        HEALTH_CHECK_FILE: "/tmp/popcharts-indexer-healthy",
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          "test -f /tmp/popcharts-indexer-healthy && find /tmp/popcharts-indexer-healthy -mmin -2 | grep -q . || exit 1",
        ],
        interval: cdk.Duration.seconds(60),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
        timeout: cdk.Duration.seconds(5),
      },
      image,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: indexerLogGroup,
        streamPrefix: "indexer",
      }),
      secrets: {
        ...databaseSecrets,
        RPC_WSS_URL: ecs.Secret.fromSecretsManager(rpcWssSecret),
      },
    });

    const migrationTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "MigrationTaskDefinition",
      {
        cpu: 256,
        memoryLimitMiB: 512,
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.X86_64,
          operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        },
      },
    );

    migrationTaskDefinition.addContainer("migrations", {
      command: ["bun", "run", "db:migrate"],
      environment: commonEnvironment,
      image,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: migrationLogGroup,
        streamPrefix: "migrations",
      }),
      secrets: databaseSecrets,
    });

    if (props.enableApiService || props.enableIndexerService) {
      this.createServices({
        apiTaskDefinition,
        certificateArn: props.certificateArn,
        cluster,
        domainName: props.domainName,
        enableApiService: props.enableApiService,
        enableIndexerService: props.enableIndexerService,
        indexerTaskDefinition,
        isProduction,
        namePrefix,
        serviceSecurityGroup,
        vpc,
      });
    }

    const privateSubnetIds = vpc
      .selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS })
      .subnetIds;

    new cdk.CfnOutput(this, "ServerRepositoryUri", {
      value: serverRepository.repositoryUri,
    });
    new cdk.CfnOutput(this, "ClusterName", {
      value: cluster.clusterName,
    });
    new cdk.CfnOutput(this, "DatabaseCredentialsSecretName", {
      value: databaseSecret.secretName,
    });
    new cdk.CfnOutput(this, "RpcWssSecretName", {
      value: rpcWssSecret.secretName,
    });
    new cdk.CfnOutput(this, "MigrationTaskDefinitionArn", {
      value: migrationTaskDefinition.taskDefinitionArn,
    });
    new cdk.CfnOutput(this, "ServiceSecurityGroupId", {
      value: serviceSecurityGroup.securityGroupId,
    });
    new cdk.CfnOutput(this, "PrivateSubnetIds", {
      value: cdk.Fn.join(",", privateSubnetIds),
    });
  }

  private createServices({
    apiTaskDefinition,
    certificateArn,
    cluster,
    domainName,
    enableApiService,
    enableIndexerService,
    indexerTaskDefinition,
    isProduction,
    namePrefix,
    serviceSecurityGroup,
    vpc,
  }: {
    apiTaskDefinition: ecs.FargateTaskDefinition;
    certificateArn?: string;
    cluster: ecs.Cluster;
    domainName?: string;
    enableApiService: boolean;
    enableIndexerService: boolean;
    indexerTaskDefinition: ecs.FargateTaskDefinition;
    isProduction: boolean;
    namePrefix: string;
    serviceSecurityGroup: ec2.SecurityGroup;
    vpc: ec2.Vpc;
  }) {
    if (enableApiService) {
      const alb = new elbv2.ApplicationLoadBalancer(this, "ApiLoadBalancer", {
        internetFacing: true,
        loadBalancerName: `${namePrefix}-api`,
        vpc,
      });

      const apiService = new ecs.FargateService(this, "ApiService", {
        assignPublicIp: false,
        circuitBreaker: {
          rollback: true,
        },
        cluster,
        desiredCount: isProduction ? 2 : 1,
        enableExecuteCommand: true,
        healthCheckGracePeriod: cdk.Duration.seconds(60),
        securityGroups: [serviceSecurityGroup],
        taskDefinition: apiTaskDefinition,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      });

      const listener = this.createListener({
        alb,
        certificateArn,
      });

      const targetGroup = listener.addTargets("ApiTargets", {
        deregistrationDelay: cdk.Duration.seconds(30),
        healthCheck: {
          healthyHttpCodes: "200",
          interval: cdk.Duration.seconds(30),
          path: "/health",
          timeout: cdk.Duration.seconds(5),
        },
        port: CONTAINER_PORT,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [apiService],
      });

      const scaling = apiService.autoScaleTaskCount({
        maxCapacity: isProduction ? 10 : 3,
        minCapacity: isProduction ? 2 : 1,
      });

      scaling.scaleOnCpuUtilization("CpuScaling", {
        scaleInCooldown: cdk.Duration.seconds(120),
        scaleOutCooldown: cdk.Duration.seconds(60),
        targetUtilizationPercent: 60,
      });

      scaling.scaleOnMemoryUtilization("MemoryScaling", {
        scaleInCooldown: cdk.Duration.seconds(120),
        scaleOutCooldown: cdk.Duration.seconds(60),
        targetUtilizationPercent: 70,
      });

      scaling.scaleOnRequestCount("RequestScaling", {
        requestsPerTarget: 1000,
        targetGroup,
      });

      new cdk.CfnOutput(this, "ApiLoadBalancerDnsName", {
        value: alb.loadBalancerDnsName,
      });

      if (domainName) {
        new cdk.CfnOutput(this, "ApiDomainName", {
          value: domainName,
        });
      }
    }

    if (enableIndexerService) {
      new ecs.FargateService(this, "IndexerService", {
        assignPublicIp: false,
        circuitBreaker: {
          rollback: true,
        },
        cluster,
        desiredCount: 1,
        enableExecuteCommand: true,
        securityGroups: [serviceSecurityGroup],
        taskDefinition: indexerTaskDefinition,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      });
    }
  }

  private createListener({
    alb,
    certificateArn,
  }: {
    alb: elbv2.ApplicationLoadBalancer;
    certificateArn?: string;
  }) {
    if (!certificateArn) {
      return alb.addListener("HttpListener", {
        open: true,
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
      });
    }

    alb.addRedirect({
      sourcePort: 80,
      sourceProtocol: elbv2.ApplicationProtocol.HTTP,
      targetPort: 443,
      targetProtocol: elbv2.ApplicationProtocol.HTTPS,
    });

    return alb.addListener("HttpsListener", {
      certificates: [acm.Certificate.fromCertificateArn(this, "Certificate", certificateArn)],
      open: true,
      port: 443,
      protocol: elbv2.ApplicationProtocol.HTTPS,
    });
  }
}
