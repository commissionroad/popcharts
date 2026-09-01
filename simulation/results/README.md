# Simulation results

## Pre-graduation withdrawal v1

`pregrad-withdrawal-v1.json` is the first committed result from simulation engine 0.1.0.

Run configuration:

- root seed `12648430` (`0x00c0ffee`);
- 250,000 trials for each scenario and receipt-count cell;
- five scenarios and receipt counts 8, 16, 32, 64, and 128;
- 6,250,000 books and 310,000,000 receipts in total;
- exact integer geometry and matched-cap checks enabled on every trial;
- 32 Rayon threads;
- SHA-256 `3a6ea907dcd5a817c5c8ef5c7d21df311195ff2a55a1c22c5f12a63577c38e1f`.

Reproduce it from the repository root:

```sh
just simulation --trials 250000 --receipts 8,16,32,64,128 --threads 32 --seed 12648430 --output simulation/results/pregrad-withdrawal-v1.json
```

Thread count affects elapsed time and execution metadata only. Trial seeds are derived independently of scheduling, and the test suite verifies identical economic summaries with one and four threads.

## Post-graduation liquidity v1

`postgrad-liquidity-v1.json` compares two-pool concentrated-liquidity configurations with a funded scoring maker under one shared total capital budget.

Run configuration:

- root seed `12648430` (`0x00c0ffee`);
- 50,000 trials for each of six flow scenarios;
- 128 user trades per trial and six venue configurations;
- 1,800,000 venue trials and 230,400,000 user-trade attempts in total;
- normalized matched cap 100, equal-capital budget 10, and fee-only budget 0.5;
- 0.30% LP fee, armed 0.10% protocol fee, 60-tick spacing, and 0.001-to-0.999 pool bounds;
- ideal complete-set keeper arbitrage after every user trade;
- conservation checked after every user trade and keeper pass, with maximum observed absolute error `4.36e-9` normalized units;
- 32 Rayon threads;
- SHA-256 `73bd47614bf4a6bfde7e5daa3aa479dddcfc18803b684681179f5c7743c272fb`.

Reproduce it from the repository root:

```sh
just simulation --experiment postgrad-liquidity --trials 50000 --trades 128 --threads 32 --seed 12648430 --format json --output simulation/results/postgrad-liquidity-v1.json
```
