# ADR 0016: popUSD, An Allowlisted Faucet Collateral For Testnet

## Status

Proposed

Supersedes section 1 (Collateral) of
[ADR 0009](0009-complete-set-testnet-policy.md).

## Context

ADR 0009 §1 fixed the testnet collateral path in two steps: local tests and the
first Arc Testnet smoke run on the repo's `MockCollateral`, then the public
demo moves to Arc's native ERC20 USDC at
`0x3600000000000000000000000000000000000000` once dedicated smoke tests pass
for its decimals, its native/ERC20 duality, and its restricted transfer
behavior. It closes with: "No other collateral token is in scope for testnet."

That decision optimizes for realism, and it is the right instinct for a system
that will eventually hold real money. It is the wrong instinct for the thing
the public testnet actually has to do first, which is let people use the
product.

Real USDC on a public testnet has two problems that have nothing to do with the
protocol. Acquiring it is a faucet scavenger hunt that happens outside our
product and that we do not control. And a market maker, a curious visitor, and
a griefer are indistinguishable to a token we did not issue, so we have no way
to gate who exercises an unaudited protocol during the period it is most likely
to be wrong.

`MockCollateral` solves neither: it is `mint(address,uint256)` with no access
control at all, which is correct for a local devchain and unusable on a public
network.

## Decision

Ship **popUSD**, a first-party ERC20 minted by a faucet, as the collateral for
the Arc Testnet demo. It is a plain, freely transferable ERC20 — the
restriction lives on the faucet, not on the token's transfer path.

### 1. Faucet, not a swap

popUSD is **minted, not exchanged**. Nothing is deposited and nothing is
redeemable. The contract custodies no funds, holds no reserve, and has no
withdrawal path.

The 500:1 relationship to USDC is a **notional display convention** — it makes
balances read like plausible money in the UI — and is deliberately not
implemented as a rate, a peg, or an oracle anywhere in the contract. Writing it
into the contract would create the impression of redeemability that the absence
of a reserve makes false.

This is the load-bearing simplification. Because nothing is custodied, popUSD is
not a fund-holding contract and falls outside
[repo ADR 0016](../../../docs/adr/0016-monorepo-architecture-cleanup-program.md)'s
Track C review requirement.

### 2. Three controls, all owner-managed

- **Daily cap.** 10,000 popUSD per address per rolling 24 hours, enforced on
  claim.
- **Allowlist.** Only allowlisted addresses may claim. Owner adds and removes;
  a single owner call **disables the allowlist entirely**, turning the faucet
  open without a redeploy. Disabling is the expected end state as the demo
  widens.
- **Owner exemption.** The owner is subject to neither the cap nor the
  allowlist, so seeding agent accounts (repo ADR 0029) and lifecycle fixtures
  does not require raising limits everyone else is held to.

Each control emits an event on change. The allowlist is a mapping with the same
shape as `PregradManager`'s `_trustedCreators`, deliberately — it is the same
kind of decision and should read the same way.

### 3. Six decimals

popUSD uses **6 decimals**, matching Arc USDC rather than `MockCollateral`'s
inherited 18.

This is not cosmetic. `CompleteSetBinaryMarket` converts between collateral and
outcome precision explicitly and rejects conversion dust, and
`LocalV4StackSmoke.t.sol` already exercises 18-decimal outcome tokens against
6-decimal collateral. Choosing 6 means the testnet exercises the same
conversion arithmetic the eventual USDC path will, so popUSD is a drop-in
rehearsal rather than a different code path wearing the same interface. An
18-decimal popUSD would make every testnet run evidence about a path we do not
intend to ship.

### 4. What it does not replace

`CreationFeeVault` and `ReviewCreditVault` take **native USDC** through
`msg.value` — Arc's native token, not an ERC20. popUSD cannot pay either. A
user holding only popUSD can trade and hold positions but **cannot create a
market**, because the creation fee and the review bond are both native.

This ADR does not change that, and the gap must be closed deliberately rather
than discovered by a confused creator. Two options, and the choice belongs with
whoever writes the onboarding flow:

- Keep the vaults native and make a native-USDC faucet link a required,
  explicit step in the create flow.
- Move the creation fee and review bond to popUSD for testnet, which makes
  onboarding one step but means the anti-spam bond is denominated in a token we
  hand out for free — which is to say, not an anti-spam bond.

The second option is cheaper and weaker. Recorded here so the tradeoff is made
on purpose.

### 5. Scope

Testnet only. popUSD has no mainnet role and this ADR is superseded, not
extended, when a mainnet plan exists. ADR 0009's underlying judgment — that
real USDC earns its slot through its own smoke run rather than by assumption —
is unchanged and still governs whatever collateral mainnet uses.

## Consequences

Positive:

- Onboarding becomes a button in our product instead of an errand in someone
  else's.
- Access to an unaudited protocol is gated by a control we own, and ungating is
  one transaction when we are ready.
- The 6-decimal choice makes testnet activity evidence about the conversion path
  mainnet will actually use.

Tradeoffs:

- Testnet stops exercising the one thing ADR 0009 wanted from real USDC: its
  native/ERC20 duality and its restricted transfer behavior. Those smoke tests
  are deferred, not cancelled, and they must run before any collateral decision
  for mainnet.
- Free collateral makes every economic signal on testnet fictional. Volume,
  liquidity depth and price quality are product-shaped noise, not evidence about
  market design. Do not read them as validation.
- A token we mint freely cannot secure anything. Any bond, stake or
  anti-spam mechanism denominated in popUSD is decorative — see §4.

## Related

- Protocol ADR 0009 — the testnet policy whose collateral section this
  supersedes; its price/tick and decimals policy stand.
- Protocol ADR 0008 — the complete-set market design that consumes collateral
  and converts precision.
- Repo ADR 0022 — the review bond and creation fee, both native USDC today.
- Repo ADR 0029 — the market-maker agents the owner exemption exists to seed.
- Repo ADR 0015 — deployment, where the collateral-choice box this answers
  lives.
