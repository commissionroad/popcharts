# ADR 0030: Market-Maker Agents For Testnet

Status: Proposed

Date: 2026-08-31

## Context

A prediction market with no liquidity is not a slow version of a working
product; it is a different, broken one. A visitor who opens a market and finds
no depth cannot form a price, cannot test a trade, and has no way to tell
whether the venue works.

Two things sharpen this. [Protocol ADR 0014 §4a](../../protocol/docs/adr/0014-pre-graduation-withdrawals-and-fees.md)
now funds post-graduation seeding from the fee pot alone, with no
protocol-capital top-up — and §4 computes that fee-only depth is `φ_in / 2` of
matched cap, around 0.5%, which it calls unusable on its own. Third-party
liquidity is therefore the load-bearing source of depth, not a supplement to
ours. And [ADR 0029](0029-recurring-price-markets.md)'s recurring markets, while
no longer dependent on agents to *exist*, are the most visible markets on the
board and the least forgiving of having none.

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
  `graduationThreshold` before their deadline. This serves organic markets that
  would otherwise refund for want of a counterparty. It is **no longer
  load-bearing for ADR 0029**, whose price markets are created directly as
  postgrad markets and so cannot refund for missing a threshold.
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

On trusted-creator status: the extra abilities it carries —
`bypassAiResolution`, and the zero dispute window under protocol ADR 0015 —
are **per-market opt-ins chosen at creation**, not properties that switch on
for every market the account touches. Both are fields in `CreateMarketParams`,
signed into the authorization and validated at creation, so holding the status
is permission to *ask*, not a default that applies retroactively. That is the
right granularity and this ADR does not ask for more.

What follows for agents is simply scoping: **a trading agent has no reason to
hold creator status at all**, because it never creates a market. Give each
agent the narrowest credential its duty needs — trading agents none,
market-creating agents the status, and the price-market factory
(ADR 0029) its own account rather than sharing one. The residual risk is that
a market-creating agent's key can opt in to those abilities on markets it
creates; on testnet, with free popUSD collateral and §7's caps, that is
acceptable, and §3's sunset bounds how long it stays acceptable.

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
- [ ] **P5 — Pregrad fill duty.** Both-sides filling to graduation threshold,
      for organic markets that would otherwise refund. Independent of ADR 0029
      since its markets are born postgrad.
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
- ADR 0029's recurring markets get depth. They no longer need the agents to
  *exist* — the direct-postgrad path removed that dependency — so a bad fill
  window now costs liquidity rather than the market.
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

- ADR 0029 — the recurring price markets these agents give depth to.
- Protocol ADR 0016 — popUSD, which funds the agents.
- Protocol ADR 0014 §4a — why third-party liquidity is the only postgrad depth,
  and the divergence warning P6 must respect.
- Protocol ADR 0015 — the zero-window privilege, a per-market opt-in that
  trusted-creator status permits an account to request (§6).
- ADR 0015 — deployment, where P9 lives.
