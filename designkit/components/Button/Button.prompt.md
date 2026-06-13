The Pop Charts button — use for any tappable action; magenta primary carries the one main action per view.

```jsx
import { Rocket } from 'lucide-react'

<Button variant="primary" leftIcon={<Rocket size={18} />}>Pop a market</Button>
<Button variant="secondary">Browse markets</Button>
<Button variant="ghost" size="sm">Cancel</Button>
```

- **variant** — `primary` (magenta fill + glow, one per view), `secondary` (outline, border→cyan on hover), `ghost` (low-emphasis).
- **size** — `sm` / `md` / `lg`. **full** stretches to container width (mobile CTAs).
- Label sets in Unbounded 800. Pass Lucide icons via `leftIcon` / `rightIcon`. Don't recolor the icon unless it's a status accent.
