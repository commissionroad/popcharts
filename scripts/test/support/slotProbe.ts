import { readSlotFromEnv } from "../../shared/localStack/readSlotFromEnv.ts";

/**
 * Spawned as an entry point (never imported) so a test can observe the slot a
 * *child process* derives from the environment it was handed. Stands in for
 * every wrapped command that resolves its own stack resources through
 * `readSlotFromEnv`, which is the consumer a missing `POPCHARTS_STACK_SLOT`
 * silently degrades to slot 0.
 */
process.stdout.write(String(readSlotFromEnv(process.env)));
