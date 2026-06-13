import React from 'react'

/**
 * A YES / NO outcome cell — shows the side label and its buy price in cents.
 * Outlined idle; on hover the border lights to the side color; selected fills
 * with the side color and ink text. Lime = YES, magenta = NO.
 */
export function OutcomeButton({ side = 'yes', price, label, selected = false, onClick, style = {}, ...rest }) {
  const [hover, setHover] = React.useState(false)
  const isYes = side === 'yes'
  const color = isYes ? 'var(--yes)' : 'var(--no)'
  const border = isYes ? 'var(--yes-border)' : 'var(--no-border)'
  const sideLabel = label || (isYes ? 'YES' : 'NO')

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, display: 'flex', flexDirection: 'column', gap: 3,
        alignItems: 'flex-start', textAlign: 'left',
        background: selected ? color : 'var(--surface-raised)',
        border: `1px solid ${selected ? color : (hover ? color : border)}`,
        borderRadius: 'var(--radius-md)', padding: '13px 16px', cursor: 'pointer',
        transition: 'border-color var(--duration-fast) var(--ease-default)',
        ...style
      }}
      {...rest}
    >
      <span style={{
        fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, letterSpacing: '0.06em',
        color: selected ? 'var(--pc-ink)' : color
      }}>{sideLabel}</span>
      <span style={{
        fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26,
        fontVariantNumeric: 'tabular-nums',
        color: selected ? 'var(--pc-ink)' : color
      }}>{price}¢</span>
    </button>
  )
}
