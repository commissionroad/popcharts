/**
 * The app's single seam onto the protocol's virtual LMSR (repo ADR 0021).
 *
 * The pricing formula lives in `@popcharts/protocol/virtual-lmsr` so the
 * indexer prices live chart ticks with the exact function the app quotes and
 * charts with — one implementation, so a pushed price can never disagree with a
 * refetched one. This re-export keeps protocol quarantined under
 * integrations/contracts (the same rule the ABI shims follow): app code imports
 * pregrad pricing from here, never from @popcharts/protocol directly.
 */

export * from "@popcharts/protocol/virtual-lmsr";
