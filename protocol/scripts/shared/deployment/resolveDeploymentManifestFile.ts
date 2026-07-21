import { resolve } from "node:path";

/** Manifest-file naming a deployment constant contributes: default path + env override. */
export type DeploymentManifestSpec = {
  readonly defaultDeploymentFile: (chainEnv: string) => string;
  readonly deploymentFileEnvVar: string;
};

/**
 * Resolves one deployment manifest to an absolute path: the spec's env-var
 * override when set, the spec's per-chain default otherwise — so every reader
 * and the writer of a manifest agree on the same file.
 */
export function resolveDeploymentManifestFile(
  spec: DeploymentManifestSpec,
  args: {
    readonly chainEnv: string;
    readonly env: NodeJS.ProcessEnv;
    readonly protocolRoot: string;
  },
): string {
  return resolve(
    args.protocolRoot,
    args.env[spec.deploymentFileEnvVar] || spec.defaultDeploymentFile(args.chainEnv),
  );
}
