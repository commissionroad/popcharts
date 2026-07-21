/**
 * Scenario framework for the lifecycle nightly suite: named scenarios made of
 * labeled steps, run strictly in order (chain-time jumps are global, so
 * concurrency would let one scenario's clock moves corrupt another's gates).
 * A failed scenario stops at the failing step but the suite continues, so one
 * regression never masks the health of the remaining paths.
 */

export type Scenario = {
  name: string;
  run: (scenario: ScenarioContext) => Promise<void>;
};

export type ScenarioContext = {
  step: <T>(label: string, work: () => Promise<T>) => Promise<T>;
};

type StepOutcome = {
  label: string;
  ms: number;
};

type ScenarioOutcome = {
  error: unknown;
  ms: number;
  name: string;
  steps: StepOutcome[];
};

export async function runScenarios(
  scenarios: readonly Scenario[],
): Promise<number> {
  const outcomes: ScenarioOutcome[] = [];

  for (const scenario of scenarios) {
    console.log(`\n=== scenario: ${scenario.name} ===`);
    const steps: StepOutcome[] = [];
    const startedAt = Date.now();
    let error: unknown = null;

    const context: ScenarioContext = {
      step: async (label, work) => {
        console.log(`[${scenario.name}] ${label}…`);
        const stepStartedAt = Date.now();
        const value = await work();
        const ms = Date.now() - stepStartedAt;
        steps.push({ label, ms });
        console.log(`[${scenario.name}] ${label} ✓ (${formatMs(ms)})`);
        return value;
      },
    };

    try {
      await scenario.run(context);
    } catch (caught) {
      error = caught;
      console.error(`[${scenario.name}] FAILED:`, caught);
    }

    outcomes.push({
      error,
      ms: Date.now() - startedAt,
      name: scenario.name,
      steps,
    });
  }

  return summarize(outcomes);
}

function summarize(outcomes: readonly ScenarioOutcome[]): number {
  const failed = outcomes.filter((outcome) => outcome.error !== null);

  console.log("\n=== lifecycle nightly summary ===");
  for (const outcome of outcomes) {
    const status = outcome.error === null ? "PASS" : "FAIL";
    console.log(
      `${status}  ${outcome.name}  (${outcome.steps.length} steps, ${formatMs(outcome.ms)})`,
    );
  }
  console.log(
    `${outcomes.length - failed.length}/${outcomes.length} scenarios passed`,
  );

  return failed.length === 0 ? 0 : 1;
}

function formatMs(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}s` : `${ms}ms`;
}
