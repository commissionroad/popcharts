import type {
  ReviewCreditPosition,
  ReviewCreditShortfall,
} from "./draftFlow.ts";

/**
 * Recovers a local market creation from the review-credit meter's refusal
 * (repo ADR 0022, prepaid-credit amendment).
 *
 * The app answers a 402 with the deposit panel and resubmits for you; a CLI
 * has no panel, so before this the command simply died and left a stranded
 * draft. On a devchain the native token is worthless and the wallet is the
 * publicly known first Hardhat account, so topping up automatically costs
 * nothing and asking would only be ceremony.
 *
 * A confirmed deposit is not immediately spendable — the gate reads the
 * server's *indexed* rows, which lag the chain — so this waits for the
 * indexed balance to cover the run before retrying, rather than retrying
 * straight into the same refusal.
 */

/** The default top-up, matching the app panel's first preset ($1 = 1e18). */
export const AUTO_TOP_UP_WAD = 10n ** 18n;

/** How long to wait for a confirmed deposit to reach the indexed view. */
export const INDEXING_TIMEOUT_MS = 30_000;
const INDEXING_POLL_INTERVAL_MS = 1_000;

/**
 * Environment for the protocol deposit helper.
 *
 * `chainEnv` is spread deliberately and is the whole reason this is a function
 * rather than an inline object: the helper runs `--network localhost`, which
 * only honours `POPCHARTS_LOCAL_RPC_URL`. Omit it and a non-zero slot deposits
 * on slot 0's chain while its draft waits on another slot's API — the deposit
 * succeeds, the credit never appears, and the retry times out blaming the
 * indexer.
 */
export function depositCommandEnv({
  amountWad,
  beneficiary,
  chainEnv,
  commandEnv,
  vaultAddress,
}: {
  readonly amountWad: bigint;
  readonly beneficiary: string;
  readonly chainEnv: NodeJS.ProcessEnv;
  readonly commandEnv: NodeJS.ProcessEnv;
  readonly vaultAddress: string;
}): NodeJS.ProcessEnv {
  return {
    ...commandEnv,
    ...chainEnv,
    LOCAL_REVIEW_CREDIT_VAULT_ADDRESS: vaultAddress,
    POPCHARTS_CREDIT_AMOUNT_WAD: amountWad.toString(),
    POPCHARTS_CREDIT_BENEFICIARY: beneficiary,
  };
}

/**
 * How much to deposit for a given refusal: the standard top-up, unless one
 * review costs more than that, in which case cover the gap exactly. Depositing
 * less than the shortfall would retry into the same 402.
 */
export function topUpAmountWad(shortfall: ReviewCreditShortfall): bigint {
  const gap = BigInt(shortfall.requiredWad) - BigInt(shortfall.availableWad);

  return gap > AUTO_TOP_UP_WAD ? gap : AUTO_TOP_UP_WAD;
}

/**
 * Polls the indexed credit until it covers `requiredWad`. Resolves true once
 * it does, false on timeout — a timeout is not a lost deposit, so the caller
 * says so rather than implying the money vanished.
 */
export async function waitForIndexedCredit({
  now = () => Date.now(),
  readCredit,
  requiredWad,
  sleep,
  timeoutMs = INDEXING_TIMEOUT_MS,
}: {
  readonly now?: () => number;
  readonly readCredit: () => Promise<ReviewCreditPosition>;
  readonly requiredWad: string;
  readonly sleep: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
}): Promise<boolean> {
  const required = BigInt(requiredWad);
  const deadline = now() + timeoutMs;

  for (;;) {
    try {
      const position = await readCredit();

      if (BigInt(position.availableWad) >= required) {
        return true;
      }
    } catch {
      // A transient read failure is the same as "not indexed yet".
    }

    if (now() >= deadline) {
      return false;
    }

    await sleep(INDEXING_POLL_INTERVAL_MS);
  }
}
