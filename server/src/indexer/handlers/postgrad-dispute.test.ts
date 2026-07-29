import { describe, expect, it } from "bun:test";

import {
  buildPostgradDisputeRecord,
  type PostgradResolutionDisputedLog,
  type PostgradResolutionProposedLog,
} from "./postgrad-dispute";
import {
  OPERATOR_ALERT_EVENTS,
  OPERATOR_ALERT_MARKER,
} from "src/shared/operator-alert-log";

const BASE_LOG = {
  address: "0xABCDEF0000000000000000000000000000000001",
  blockNumber: 123n,
  logIndex: 4,
  transactionHash: `0x${"22".repeat(32)}`,
};

const blockTimestamp = new Date("2026-06-13T12:00:00.000Z");
const DISPUTE_DEADLINE_UNIX = 1_781_006_400n;

describe("buildPostgradDisputeRecord", () => {
  it("maps ResolutionProposed(side=0) to a proposed event with the window deadline", () => {
    const record = buildPostgradDisputeRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "proposed",
      log: {
        ...BASE_LOG,
        args: { disputeDeadline: DISPUTE_DEADLINE_UNIX, side: 0 },
      } as PostgradResolutionProposedLog,
      marketId: 7n,
    });

    expect(record.event).toMatchObject({
      blockNumber: 123n,
      blockTimestamp,
      chainId: 5042002,
      contractId: 42,
      disputer: null,
      kind: "proposed",
      logIndex: 4,
      marketId: 7n,
      postgradMarket: BASE_LOG.address.toLowerCase(),
      proposedSide: "yes",
    });
    // uint64 unix seconds widen to the millisecond timestamp column.
    expect(record.event.disputeDeadline).toEqual(
      new Date(Number(DISPUTE_DEADLINE_UNIX) * 1000),
    );
  });

  it("maps ResolutionProposed(side=1) to proposed side no", () => {
    const record = buildPostgradDisputeRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "proposed",
      log: {
        ...BASE_LOG,
        args: { disputeDeadline: DISPUTE_DEADLINE_UNIX, side: 1 },
      } as PostgradResolutionProposedLog,
      marketId: 7n,
    });

    expect(record.event.proposedSide).toBe("no");
  });

  it("maps ResolutionDisputed to a disputed event with the lowercased disputer", () => {
    const record = buildPostgradDisputeRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "disputed",
      log: {
        ...BASE_LOG,
        args: {
          bond: 100_000_000n,
          disputer: "0xAAAAAAAA00000000000000000000000000000009",
        },
      } as PostgradResolutionDisputedLog,
      marketId: 7n,
    });

    expect(record.event).toMatchObject({
      disputeDeadline: null,
      disputer: "0xaaaaaaaa00000000000000000000000000000009",
      kind: "disputed",
      proposedSide: null,
    });
  });

  // The alarm in infra/ keys on these two marker terms and an operator acts on
  // the JSON detail; a refactor that drops either silently unbuilds the page.
  it("builds the operator alert a dispute pages on", () => {
    const record = buildPostgradDisputeRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "disputed",
      log: {
        ...BASE_LOG,
        args: {
          bond: 100_000_000n,
          disputer: "0xAAAAAAAA00000000000000000000000000000009",
        },
      } as PostgradResolutionDisputedLog,
      marketId: 7n,
    });

    const [marker, event, ...detail] = record.operatorAlert!.split(" ");
    expect(marker).toBe(OPERATOR_ALERT_MARKER);
    expect(event).toBe(OPERATOR_ALERT_EVENTS.resolutionDisputed);
    expect(JSON.parse(detail.join(" "))).toEqual({
      // uint256 base units, not dollars.
      bond: "100000000",
      chainId: 5042002,
      disputer: "0xaaaaaaaa00000000000000000000000000000009",
      marketId: "7",
      postgradMarket: BASE_LOG.address.toLowerCase(),
      transactionHash: BASE_LOG.transactionHash,
    });
  });

  it("leaves a proposed record without an operator alert", () => {
    const record = buildPostgradDisputeRecord({
      blockTimestamp,
      config: { chainId: 5042002 },
      contractId: 42,
      kind: "proposed",
      log: {
        ...BASE_LOG,
        args: { disputeDeadline: DISPUTE_DEADLINE_UNIX, side: 0 },
      } as PostgradResolutionProposedLog,
      marketId: 7n,
    });

    expect(record.operatorAlert).toBeUndefined();
  });

  it("throws when a disputed log is missing its bond", () => {
    expect(() =>
      buildPostgradDisputeRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "disputed",
        log: {
          ...BASE_LOG,
          args: { disputer: "0xAAAAAAAA00000000000000000000000000000009" },
        } as PostgradResolutionDisputedLog,
        marketId: 7n,
      }),
    ).toThrow("bond");
  });

  it("throws when a proposed log is missing its side", () => {
    expect(() =>
      buildPostgradDisputeRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "proposed",
        log: {
          ...BASE_LOG,
          args: { disputeDeadline: DISPUTE_DEADLINE_UNIX },
        } as PostgradResolutionProposedLog,
        marketId: 7n,
      }),
    ).toThrow("side");
  });

  it("throws on a side outside the MarketTypes.Side range", () => {
    // The shared decoder maps every non-YES value to NO, so an out-of-range 2
    // would otherwise be recorded as a real, plausible-looking NO proposal —
    // the input to a money-moving outcome. Stop the cursor instead.
    expect(() =>
      buildPostgradDisputeRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "proposed",
        log: {
          ...BASE_LOG,
          args: { disputeDeadline: DISPUTE_DEADLINE_UNIX, side: 2 },
        } as PostgradResolutionProposedLog,
        marketId: 7n,
      }),
    ).toThrow("out-of-range");
  });

  it("throws when a proposed log is missing its dispute deadline", () => {
    expect(() =>
      buildPostgradDisputeRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "proposed",
        log: {
          ...BASE_LOG,
          args: { side: 0 },
        } as PostgradResolutionProposedLog,
        marketId: 7n,
      }),
    ).toThrow("disputeDeadline");
  });

  it("throws when a disputed log is missing its disputer", () => {
    expect(() =>
      buildPostgradDisputeRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "disputed",
        log: {
          ...BASE_LOG,
          args: { bond: 1n },
        } as PostgradResolutionDisputedLog,
        marketId: 7n,
      }),
    ).toThrow("disputer");
  });

  it("throws when required log metadata is missing", () => {
    expect(() =>
      buildPostgradDisputeRecord({
        blockTimestamp,
        config: { chainId: 5042002 },
        contractId: 42,
        kind: "proposed",
        log: {
          ...BASE_LOG,
          args: { disputeDeadline: DISPUTE_DEADLINE_UNIX, side: 0 },
          blockNumber: null,
        } as unknown as PostgradResolutionProposedLog,
        marketId: 7n,
      }),
    ).toThrow("blockNumber");
  });
});
