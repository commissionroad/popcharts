/**
 * Runs a CLI entrypoint and prints user-facing errors without a Node stack trace.
 */
export async function runScript(main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
