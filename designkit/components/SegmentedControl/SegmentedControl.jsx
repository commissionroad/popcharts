import React from 'react'

/**
 * Segmented control — a row of mutually-exclusive options inside one rounded
 * track. Use for the YES/NO trade toggle, feed filters, or a Basic/Advanced switch.
 * The selected segment can take an accent color (e.g. lime for YES, magenta for NO).
 */
export function SegmentedControl({ options = [], value, onChange, accentBy, size = 'md', full = false, style = {} }) {
  const dims = size === 'sm'
    ? { fontSize: 12, padY: 7, padX: 12 }
    : { fontSize: 14, padY: 10, padX: 16 }

  return (
    <div style={{
      display: 'inline-flex', gap: 4, padding: 4,
      background: 'var(--surface-raised)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', width: full ? '100%' : 'auto', ...style
    }}>
      {options.map((opt) => {
        const val = typeof opt === 'string' ? opt : opt.value
        const label = typeof opt === 'string' ? opt : opt.label
        const selected = val === value
        const accent = accentBy ? accentBy(val) : 'var(--accent)'
        return (
          <button
            key={val}
            type="button"
            onClick={() => onChange && onChange(val)}
            style={{
              flex: full ? 1 : 'none',
              fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: dims.fontSize,
              padding: `${dims.padY}px ${dims.padX}px`, borderRadius: 'var(--radius-sm)',
              border: '1px solid transparent', cursor: 'pointer',
              transition: 'all var(--duration-fast) var(--ease-default)',
              background: selected ? accent : 'transparent',
              color: selected ? 'var(--pc-ink)' : 'var(--text-secondary)',
              boxShadow: selected ? `0 0 18px ${accent === 'var(--accent)' ? 'rgba(255,46,151,.25)' : 'transparent'}` : 'none'
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
