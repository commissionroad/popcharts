import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import {
  MARKET_STATUS,
  MARKET_STATUS_MEMBERS,
  POSTGRAD_MARKET_STATUS,
  POSTGRAD_MARKET_STATUS_MEMBERS,
} from "../../src/generated/contract-enums.js";
import { MARKET_STATUS as shimMarketStatus } from "../../src/market-status.js";
import { POSTGRAD_MARKET_STATUS as shimPostgradMarketStatus } from "../../src/postgrad-market-status.js";

const protocolRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Reads an enum's members straight out of the Solidity source text. This is a
 * deliberately independent route to the same facts the generator derives from
 * the solc AST: if the checked-in tables ever disagree with the contracts —
 * including because nobody rebuilt after editing an enum — one of the two
 * routes moves and this fails.
 */
function readSolidityEnumMembers({
  contractPath,
  enumName,
}: {
  contractPath: string;
  enumName: string;
}): string[] {
  const source = readFileSync(join(protocolRoot, contractPath), "utf8");
  // Strip every comment before going looking for the enum. Comments are not
  // merely noise between members: a `}` inside NatSpec would end the body
  // early, and a commented-out `enum <Name> { ... }` example earlier in the
  // file would be matched in place of the real declaration. Removing them
  // first also means a member can carry a trailing `// note` or a `/* */`
  // block without breaking the parse. Order matters — block comments go
  // first, so a `//` inside one cannot swallow the rest of its line.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  // The enum body is everything between `enum <Name> {` and the next `}`.
  // Solidity enum bodies cannot nest braces, so `[^}]*` is exact rather than
  // merely lazy, and no `s`/`m` flag is needed: `[^}]` already spans newlines.
  const body = new RegExp(`enum\\s+${enumName}\\s*\\{([^}]*)\\}`).exec(code)?.[1];
  assert.ok(body !== undefined, `${contractPath} declares no enum ${enumName}`);

  // Members are comma-separated, not line-separated: with comments gone,
  // splitting on the comma reads `Yes, No` on one line the same as one
  // member per line.
  const members = body
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  for (const member of members) {
    assert.match(member, /^[A-Z][A-Za-z0-9]*$/, `Unparsed ${enumName} member line: "${member}"`);
  }

  return members;
}

const enumCases = [
  {
    contractPath: "contracts/types/MarketTypes.sol",
    enumName: "MarketStatus",
    members: MARKET_STATUS_MEMBERS,
    table: MARKET_STATUS,
    title: "MarketTypes.MarketStatus",
  },
  {
    contractPath: "contracts/postgrad/CompleteSetBinaryMarket.sol",
    enumName: "Status",
    members: POSTGRAD_MARKET_STATUS_MEMBERS,
    table: POSTGRAD_MARKET_STATUS,
    title: "CompleteSetBinaryMarket.Status",
  },
] as const;

describe("generated Solidity enum tables", () => {
  for (const enumCase of enumCases) {
    describe(enumCase.title, () => {
      it("lists the Solidity members in declaration order", () => {
        assert.deepEqual(
          [...enumCase.members],
          readSolidityEnumMembers(enumCase),
          `${enumCase.title} drifted from ${enumCase.contractPath}. Run \`pnpm --dir protocol build\`.`,
        );
      });

      it("numbers every member by its declaration ordinal", () => {
        assert.deepEqual(
          Object.values(enumCase.table),
          enumCase.members.map((_member, ordinal) => ordinal),
        );
      });

      it("keys the table by the camelCase member name", () => {
        assert.deepEqual(
          Object.keys(enumCase.table).map((key) => key.toLowerCase()),
          enumCase.members.map((member) => member.toLowerCase()),
        );
      });
    });
  }

  // The source-derived assertions above cannot catch a *reordering* of the
  // Solidity enum: the table would regenerate, still match the source, and
  // silently re-encode statuses that deployed contracts and indexed rows
  // already use. So every ordinal of both enums is pinned literally here, and
  // changing one has to be an explicit, reviewed edit to this file.
  it("pins every ordinal deployed contracts and indexed data already encode", () => {
    // UnderReview (7) and Rejected (8) were removed from the TAIL by repo
    // ADR 0022 P5 — a tail removal never re-encodes surviving ordinals, which
    // is the only removal shape this pin permits.
    assert.deepEqual(MARKET_STATUS, {
      active: 0,
      frozen: 1,
      graduating: 2,
      graduated: 3,
      refunded: 4,
      resolved: 5,
      cancelled: 6,
    });

    // `resolutionPending` and `disputed` were appended by the dispute-window
    // work (protocol ADR 0013), so they sit after `cancelled` rather than in
    // lifecycle order — the enum is append-only.
    assert.deepEqual(POSTGRAD_MARKET_STATUS, {
      trading: 0,
      resolved: 1,
      cancelled: 2,
      resolutionPending: 3,
      disputed: 4,
    });
  });

  // src/market-status.ts and src/postgrad-market-status.ts stay as modules so
  // their package subpaths and existing importers keep working. Identity, not
  // deep equality: a shim that copied the table instead of re-exporting it
  // would satisfy deepEqual today and drift silently tomorrow.
  it("serves the compatibility shims the generated tables themselves", () => {
    assert.equal(shimMarketStatus, MARKET_STATUS);
    assert.equal(shimPostgradMarketStatus, POSTGRAD_MARKET_STATUS);
  });
});
