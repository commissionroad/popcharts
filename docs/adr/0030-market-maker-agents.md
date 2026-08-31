# ADR 0030: Market-Maker Agents For Testnet

Status: Proposed

Date: 2026-08-31

## Context

A prediction market with no liquidity is not a slow version of a working
product; it is a different, broken one. A visitor who opens a market and finds
no depth cannot form a price, cannot test a trade, and has no way to tell
whether the venue works. The same emptiness stops
[ADR 0029](0029-recurring-price-markets.md)'s recurring markets from working at
all: a market that does not reach `graduationThreshold` in matched cap by its
deadline refunds instead of graduating, so without someone reliably taking both
sides, a five-minute cadence produces a board of refunds.

Two starting points already exist. `server/scripts/bot-trade.ts` and
`bot-trade-postgrad.ts` drive pregrad receipts and postgrad venue swaps against
a local devchain — interactive scripts with a readline prompt, built for a
human at a terminal. They are a proof that the trading paths are drivable
programmatically. They are not deployable agents.

This ADR is explicitly a **testnet** measure. Its purpose is to make an
unfinished product legible to people evaluating it, during the window before
real participants exist.

## Decision

Run a small set of unattended agents that supply liquidity, take positions, and
create markets on the Arc Testnet deployment, under four constraints that are
not optional and are the reason this ADR exists rather than a script.

### 1. Disclosure is a property of the system, not a disclaimer

Every market an agent creates and every position an agent holds is **labelled
as such in the product**, sourced from data rather than from a footer.

- Agent accounts are a known, enumerable set recorded server-side.
- Market and position reads expose whether the actor is an agent.
- The board and market pages show it wherever an agent's activity is visible.

The failure this prevents is specific. Synthetic depth that a visitor believes
is organic is a false statement about the market's liquidity, made by us, to
someone deciding whether to trust the venue. Labelling it costs a column and a
badge. Not labelling it is the kind of thing that is defensible for exactly as
long as nobody looks.

### 2. Aggregate statistics separate agents out

Volume, open interest, liquidity depth, and market counts must be computable
both with and without agent activity, and any figure shown as a headline
number must say which it is.

This follows from §1 but is worth stating separately because it fails
differently: a labelled market inside an unlabelled total still produces a
"$2.4M traded" figure that is a statement about our own agents. The separation
belongs in the query, not in a caveat under the chart.

### 3. Sunset is written into the ADR, not remembered

**Agents are testnet-only. This ADR is superseded, not extended, when a mainnet
plan exists**, and the agents stop before real money is on the venue.

The risk being managed is not the agents; it is their persistence. Scaffolding
that works tends to survive into production because nobody schedules its
removal. Recording the end condition here makes leaving them running a decision
someone has to make and defend, rather than an omission.

### 4. Mirrored questions are reframed and unattributed to their source

Agents may create markets on subjects that are publicly interesting, including
subjects other prediction venues cover. Two rules:

- **Question text is written fresh, never copied.** Another venue's question
  wording is their content, and lifting it is both a licensing question we have
  no answer to and a quality trap — their phrasing is tuned to their resolution
  rules, not ours.
- **No third-party company, protocol, or product names appear in identifiers**
  — not in contract, function, script, or branch names, not in table or column
  names, not in deployment artifacts. This is the standing `AGENTS.md` rule and
  it binds here specifically because "mirror the markets from $VENUE" is a
  natural thing to name a script and exactly what the rule forbids. Describe
  the mechanism: a topic list, a question generator.

### 5. What the agents do

- **Pregrad fill.** Take both sides of new markets so they reach
  `graduationThreshold` before their deadline. This is the duty ADR 0029
  depends on, and its reliability requirement comes from there, not from here.
- **Postgrad liquidity.** Supply v4 positions on graduated markets. Note this
  is the *third-party* liquidity that
  [protocol ADR 0014 §4a](../../protocol/docs/adr/0014-pre-graduation-withdrawals-and-fees.md)
  now expects to provide postgrad depth — the protocol itself supplies none.
  The agents are therefore standing in for LPs who do not exist yet, and §4a's
  divergence warning applies to them in full: a position in a market resolving
  to 0 or 1 is fully exposed, and the agent must exit before resolution.
- **Position taking.** Small, bounded trades so order flow exists and prices
  move.
- **Market creation.** A modest, scheduled stream of markets on a versioned
  topic list, distinct from ADR 0029's price markets.

### 6. Funding and keys

Agents fund from the popUSD faucet
([protocol ADR 0016](../../protocol/docs/adr/0016-popusd-testnet-faucet-collateral.md)),
whose owner exemption exists partly for this. Their collateral is therefore
free and their losses are not real, which is what makes unattended trading
acceptable here and is a further reason §3's sunset matters.

The keys are real regardless. Agent keys are separate from the operator,
resolver, review-manager, and market-creation-authorizer keys, provisioned as
deployment secrets ([ADR 0015](0015-deployment-and-infrastructure.md)) and
individually revocable. An agent key is the least trusted key in the system and
should be able to lose everything it holds without that mattering.

Note the one place this is not merely cosmetic: agents creating markets need
**trusted-creator** status or authorized-creation signatures, and
trusted-creator status also carries the `bypassAiResolution` privilege and,
under protocol ADR 0015, the zero-dispute-window privilege. **Do not grant
trusted-creator status to a trading agent.** Market-creating agents should hold
the narrowest credential that works, and if that is not narrow enough, that is
an argument for splitting the privilege rather than for widening the grant.

### 7. Bounded by construction

Every agent runs with hard caps — per-trade size, per-interval spend, maximum
concurrent positions, maximum markets created per day — read from configuration
and enforced in the agent, and it stops rather than degrades when it hits one.
An unattended process with a key and no ceiling is the shape of an incident
even when the money is fake, because the habits and the code outlive the
testnet.

## Progress

- [ ] **P1 — Agent identity.** An enumerable set of agent accounts recorded
      server-side, exposed on market and position reads. Nothing else in this
      ADR ships before this: labelling is a precondition, not a follow-up.
- [ ] **P2 — Agent-excluded aggregates.** Volume, open interest, depth and
      counts computable with and without agent activity.
- [ ] **P3 — Product labelling.** Agent badges wherever agent activity is
      visible, and headline figures stating which basis they use.
- [ ] **P4 — Runner harness.** An unattended agent process with the §7 caps,
      built from the shapes proven in `bot-trade.ts` / `bot-trade-postgrad.ts`
      but not their interactive form.
- [ ] **P5 — Pregrad fill duty.** Both-sides filling to graduation threshold.
      DEPENDS: ADR 0029 P4 for the markets to fill.
- [ ] **P6 — Postgrad liquidity duty**, including the pre-resolution exit that
      protocol ADR 0014 §4a's divergence analysis requires.
- [ ] **P7 — Position-taking duty**, bounded per §7.
- [ ] **P8 — Market-creation duty** over a versioned topic list, with
      freshly written question text per §4.
- [ ] **P9 — Deployment.** Agent services, keys as secrets, caps as
      configuration. Belongs to ADR 0015's stack work.

## Exit criteria

A visitor to the testnet finds markets with depth, prices that move, and a
board that is never empty — and can tell at a glance which of it is ours. Every
aggregate on the site is stated on a basis that says whether agents are in it.

## Consequences

Positive:

- The product becomes evaluable by someone who is not us.
- ADR 0029's recurring markets become viable, since their graduation depends on
  exactly this.
- The postgrad venue gets exercised under continuous load before real
  participants arrive.

Tradeoffs:

- **Every economic signal from testnet becomes a measurement of our own
  configuration.** Combined with free popUSD collateral, testnet activity is
  worthless as evidence about market design, pricing quality, or demand. It is
  a functional test, and reading it as product validation would be a serious
  error.
- More unattended processes holding keys, which is more operational surface at
  a moment when the deployment story (ADR 0015) does not exist yet.
- A standing temptation to keep the agents on past the point where organic
  activity should replace them, precisely because the board looks worse the day
  they stop. §3 exists for this and will still take deliberate effort.

## Related

- ADR 0029 — the recurring price markets whose graduation depends on P5.
- Protocol ADR 0016 — popUSD, which funds the agents.
- Protocol ADR 0014 §4a — why third-party liquidity is the only postgrad depth,
  and the divergence warning P6 must respect.
- Protocol ADR 0015 — the zero-window privilege that rides on trusted-creator
  status, which §6 says not to grant a trading agent.
- ADR 0015 — deployment, where P9 lives.
