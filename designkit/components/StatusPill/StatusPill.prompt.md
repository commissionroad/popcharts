The market lifecycle status pill — show one on every market card and detail header so the trader always knows the stage.

```jsx
<StatusPill status="bootstrap" />     {/* cyan, dot pulses — virtual LMSR live */}
<StatusPill status="graduating" />    {/* amber, dot pulses — opposing demand forming */}
<StatusPill status="graduated" />     {/* lime — cleared to CTF complete sets */}
<StatusPill status="resolved" />      {/* violet — outcome settled */}
<StatusPill status="refunded" />      {/* fog — cancelled/expired, refunded */}
```

- The leading dot **pulses** only while live (`bootstrap`, `graduating`).
- Colors come straight from the `--status-*` tokens; don't override them.
- Use `size="sm"` inside dense feed cards.
