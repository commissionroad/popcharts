Segmented toggle for mutually-exclusive choices — the YES/NO trade side, feed sort tabs, or a Basic/Advanced switch in Create.

```jsx
const [side, setSide] = React.useState('yes')

<SegmentedControl
  full
  options={[{ value: 'yes', label: 'YES' }, { value: 'no', label: 'NO' }]}
  value={side}
  onChange={setSide}
  accentBy={(v) => (v === 'yes' ? 'var(--yes)' : 'var(--no)')}
/>
```

- Pass `accentBy` to color the selected segment per option (lime YES / magenta NO). Without it, the selected segment is magenta.
- `full` makes segments share width — use for the trade toggle and mobile.
- Keep option counts to 2–4; for many/long options use a Select instead.
