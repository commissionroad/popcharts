/**
 * The app's single seam onto the protocol's market metadata schema.
 *
 * The serialized key order is a hash commitment: the indexer recomputes the
 * metadata hash from these exact bytes and rejects a mismatch, so the app must
 * serialize through the same function every other creator uses rather than its
 * own copy. This re-export keeps protocol quarantined under
 * integrations/contracts (the same rule the ABI, WAD, and virtual-LMSR shims
 * follow): app code imports metadata helpers from here, never from
 * @popcharts/protocol directly.
 */

export * from "@popcharts/protocol/market-metadata";
