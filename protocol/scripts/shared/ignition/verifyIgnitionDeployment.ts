type IgnitionVerifyTaskRegistry = {
  getTask(path: string[]): {
    run(options: { deploymentId: string; force: boolean }): Promise<unknown>;
  };
};

/**
 * Runs Hardhat's Ignition verification task and turns task failure into an error.
 */
export async function verifyIgnitionDeployment({
  deploymentId,
  force = false,
  tasks,
}: {
  deploymentId: string;
  force?: boolean;
  tasks: IgnitionVerifyTaskRegistry;
}) {
  await tasks.getTask(["ignition", "verify"]).run({ deploymentId, force });

  if (process.exitCode !== undefined && process.exitCode !== 0) {
    throw new Error(`Hardhat Ignition verification failed for deployment ${deploymentId}.`);
  }
}
