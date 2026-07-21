import { createInterface } from "node:readline/promises";

import type { StackDescriptor } from "./registry.ts";
import { describeTargetStack } from "./resolveTargetStack.ts";

/**
 * Prompts an interactive caller to choose one of the running local dev stacks
 * (the `chooseStack` used by {@link resolveTargetStack} on a TTY). Each attempt
 * accepts either the displayed one-based list index or a stack's slot number,
 * and invalid choices are retried until a live stack is selected. Shared by
 * every stack-targeting script (`local-create-market`, the `with-target-stack`
 * launcher) so the selection UX stays identical.
 */
export async function promptForStack(
  stacks: readonly StackDescriptor[],
): Promise<StackDescriptor> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Multiple local dev stacks are running:");
  stacks.forEach((stack, index) => {
    console.log(`  ${index + 1}. ${describeTargetStack(stack)}`);
  });

  try {
    while (true) {
      const answer = (
        await readline.question("Choose a stack (list number or slot): ")
      ).trim();
      const numericChoice = Number(answer);
      const indexedStack = Number.isInteger(numericChoice)
        ? stacks[numericChoice - 1]
        : undefined;
      const slottedStack = Number.isInteger(numericChoice)
        ? stacks.find((stack) => stack.slot === numericChoice)
        : undefined;
      const selected = indexedStack ?? slottedStack;

      if (selected !== undefined) {
        return selected;
      }

      console.log(
        "Invalid choice. Enter a displayed list number or stack slot.",
      );
    }
  } finally {
    readline.close();
  }
}
