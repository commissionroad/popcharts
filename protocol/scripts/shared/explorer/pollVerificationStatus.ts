import { sleep } from "../time/sleep.js";
import { getExplorerJson } from "./getExplorerJson.js";
import { normalizeExplorerMessage } from "./normalizeExplorerMessage.js";

const VERIFICATION_PASSED = "Pass - Verified";
const VERIFICATION_PENDING = "Pending in queue";

/**
 * Polls Blockscout's verification status endpoint until verification finishes.
 */
export async function pollVerificationStatus({
  apiUrl,
  explorerName,
  guid,
  pollAttempts,
  pollIntervalMs,
}: {
  apiUrl: string;
  explorerName: string;
  guid: string;
  pollAttempts: number;
  pollIntervalMs: number;
}): Promise<string> {
  const statusUrl = new URL(apiUrl);
  statusUrl.searchParams.set("module", "contract");
  statusUrl.searchParams.set("action", "checkverifystatus");
  statusUrl.searchParams.set("guid", guid);

  for (let attempt = 1; attempt <= pollAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(pollIntervalMs);
    }

    const status = await getExplorerJson({ explorerName, url: statusUrl });
    const result = normalizeExplorerMessage(status.result);
    if (result === VERIFICATION_PASSED) {
      return result;
    }
    if (result !== VERIFICATION_PENDING) {
      throw new Error(`${explorerName} verification failed: ${result}`);
    }

    console.log(`Verification pending (${attempt}/${pollAttempts})`);
  }

  throw new Error(`${explorerName} verification did not complete for guid ${guid}.`);
}
