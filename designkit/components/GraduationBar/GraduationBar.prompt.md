Shows a market's progress toward graduation — the matched (path-compatible) liquidity vs the clearing target.

```jsx
<GraduationBar matched={356000} target={482000} />
```

- **Amber** while filling; flips to **lime** + lime glow once `matched ≥ target` ("Ready to graduate").
- This is *matched* liquidity (YES & NO demand that crossed the same bands), not raw volume — keep the caption wording accurate to the mechanism.
- Put it on every bootstrap/graduating market card and at the top of the graduation/clearing view.
