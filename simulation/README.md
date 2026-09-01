# Pop Charts mechanism simulation

This Rust package measures the economic and operational questions left open by whitepaper v0.6 and protocol ADR 0014. It models the shipped unopposed-band withdrawal rule and an equal-capital comparison of the post-graduation venue with a funded bounded-loss scoring maker. It does not model the superseded whole-receipt capped reverse trade.

The engine separates two numeric domains:

- path geometry, widths, matched market cap, opposition, and receipt support use exact signed integer micro-`b` units;
- LMSR path costs use the same stable softplus shape as the production TypeScript implementation, with NO cost defined as the exact width complement of YES cost.

Every release run checks that withdrawing every quoted free band leaves matched market cap unchanged, that free and opposed segments partition every receipt, and that the resulting path equals the signed width of the remaining support. Trials receive independent seeds derived from the root seed and scenario, so changing the Rayon thread count cannot change the economic results. Timing and thread metadata still differ.

## Commands

```sh
just simulation-check
just simulation --trials 100000 --receipts 8,16,32,64,128 --output .local-dev/simulation/report.json
just simulation --experiment postgrad-liquidity --trials 50000 --trades 128 --output .local-dev/simulation/postgrad.json
```

The default output is a human-readable summary. `--output` also writes the complete versioned JSON report. Use `--format json` to print JSON to standard output.

All Cargo caches and build output stay under `.local-dev/` through the root `just` recipes.

## Initial experiment

The first experiment covers five pre-graduation flow models:

- balanced noise;
- momentum-following flow;
- informed flow around a moving latent probability;
- one-sided demand;
- a mixed population.

For each model it reports escrow-weighted and user-weighted withdrawal availability, matched-cap ratio, fragmentation, withdrawal-fee burden, and retractable display movement. Cost figures are normalized to one unit of `b`, so a result stated per `b` scales linearly with the configured market liquidity parameter. It also reports a deterministic pinning grid showing how much complementary capital is needed to lock an extreme-price receipt.

## Post-graduation experiment

The post-graduation engine models the two outcome/collateral pools as one venue with a single total capital budget split between YES and NO at the opening probability. It uses continuous concentrated-liquidity formulas, traverses every active range boundary, charges the current 0.30% LP fee and intended 0.10% protocol fee in input currency, accrues fees to the correct inventory, and runs ideal complete-set arbitrage after every user trade. Every transition checks conservation of outcome and collateral inventory.

The compared inventory shapes are the fee-only broad seed, an equal-capital broad position, the current 25-spacing concentrated backstop shape, 64 one-spacing maker ranges on each side, a 25% broad and 75% maker hybrid, and a funded scoring maker whose capital equals its worst-case binary loss from the opening probability. User order flow and resolution draws are generated once per trial and replayed unchanged through every venue.

The engine deliberately keeps receipt clearing and post-graduation inventory in separate modules. Later contract-rounding fixtures, keeper latency, gas, LP rebalancing, capital withdrawals, and observed order-flow replays can extend the venue experiment without changing the exact pre-graduation geometry.
