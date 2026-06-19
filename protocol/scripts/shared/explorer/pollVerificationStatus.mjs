import { sleep } from "../time/sleep.mjs";
import { getExplorerJson } from "./getExplorerJson.mjs";
import { normalizeExplorerMessage } from "./normalizeExplorerMessage.mjs";

/**
 * Polls Blockscout's verification status endpoint until verification finishes.
 */
export async function pollVerificationStatus({
  apiUrl,
  explorerName,
  guid,
  pollAttempts,
  pollIntervalMs,
}) {
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
    if (result === "Pass - Verified") {
      return result;
    }
    if (result !== "Pending in queue") {
      throw new Error(`${explorerName} verification failed: ${result}`);
    }

    console.log(`Verification pending (${attempt}/${pollAttempts})`);
  }

  throw new Error(`${explorerName} verification did not complete for guid ${guid}.`);
}
