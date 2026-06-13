Labeled form field for the Create-market flow and trade panel.

```jsx
<Field label="Question" placeholder="Will ETH flip $5,000 before August?" />
<Field label="Liquidity b" mono suffix="virtual" value={b} onChange={e => setB(e.target.value)}
       hint="Higher b = smoother price, slower to move. Backed by no bankroll." />
<Field label="Resolution criteria" multiline />
```

- Label is mono uppercase; border lights cyan on focus.
- Use `mono` for any numeric/amount field (renders tabular figures) and `suffix` for the unit or token symbol.
- `multiline` gives a textarea (description, resolution criteria).
