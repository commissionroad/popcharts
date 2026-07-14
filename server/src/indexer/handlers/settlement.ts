/**
 * Barrel for the settlement indexer handlers, split per ADR 0016 D3 once the
 * file crossed its documented trigger (a 7th event type, MarketCancelled).
 * Kept because four modules import this surface; shared plumbing lives in
 * `settlement-shared.ts` and stays private to the handler modules.
 */
export * from "src/indexer/handlers/settlement-claims";
export * from "src/indexer/handlers/settlement-graduation";
export * from "src/indexer/handlers/settlement-refunds";
