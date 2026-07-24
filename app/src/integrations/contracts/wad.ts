/**
 * The app's single seam onto the protocol's WAD fixed-point conventions.
 *
 * WAD (18-decimal fixed point) is a protocol encoding, so its constant and
 * decode live in `@popcharts/protocol/wad` — the exact helpers the indexer
 * decodes pushed prices with, so a charted price can never disagree with a
 * refetched one. This re-export keeps protocol quarantined under
 * integrations/contracts (the same rule the ABI and virtual-LMSR shims
 * follow): app code imports WAD helpers from here, never from
 * @popcharts/protocol directly.
 */

export * from "@popcharts/protocol/wad";
