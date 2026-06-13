A YES / NO outcome price cell. Always pair two in a row (they flex equally).

```jsx
<div style={{ display: 'flex', gap: 12 }}>
  <OutcomeButton side="yes" price={64} selected={pick === 'yes'} onClick={() => setPick('yes')} />
  <OutcomeButton side="no"  price={36} selected={pick === 'no'}  onClick={() => setPick('no')} />
</div>
```

- Lime = YES, magenta = NO; the price renders in Unbounded with the cent sign and tabular figures.
- Idle is outlined; hover lights the border to the side color; `selected` fills the cell.
- For non-binary custom labels, pass `label` (e.g. "OVER" / "UNDER").
