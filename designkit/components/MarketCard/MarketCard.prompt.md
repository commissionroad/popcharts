The market tile for the discovery feed. Composes StatusPill + two OutcomeButtons + GraduationBar — don't rebuild those inside it.

```jsx
<MarketCard
  market={{
    category: 'Crypto', status: 'graduating',
    question: 'Will ETH flip $5,000 before August?',
    yesPrice: 64, noPrice: 36, volume: 482300, b: 5000,
    matched: 356000, target: 482000
  }}
  onOpen={(m) => goToMarket(m)}
  onPick={(m, side) => openTrade(m, side)}
/>
```

- The graduation bar only shows while the market is live (`bootstrap` / `graduating`).
- Footer is mono: volume + the virtual `b`. Category chip is color-keyed.
- Lay cards out in a responsive grid (min ~320px columns); the card has no fixed width.
