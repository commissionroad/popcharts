import React from 'react'

const STATUS = {
  bootstrap:  { label: 'Bootstrap',  color: 'var(--status-bootstrap)',  pulse: true },
  graduating: { label: 'Graduating', color: 'var(--status-graduating)', pulse: true },
  graduated:  { label: 'Graduated',  color: 'var(--status-graduated)',  pulse: false },
  resolved:   { label: 'Resolved',   color: 'var(--status-resolved)',   pulse: false },
  refunded:   { label: 'Refunded',   color: 'var(--status-refunded)',   pulse: false }
}

/**
 * Lifecycle status pill — outlined, mono caps, with a leading dot that pulses
 * while the market is live (bootstrap / graduating).
 */
export function StatusPill({ status = 'bootstrap', label, size = 'md', style = {}, ...rest }) {
  const s = STATUS[status] || STATUS.bootstrap
  const dims = size === 'sm'
    ? { fontSize: 10, padding: '3px 9px', dot: 6 }
    : { fontSize: 11, padding: '5px 12px', dot: 7 }

  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 7,
        fontFamily: 'var(--font-mono)', fontSize: dims.fontSize, fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
        color: s.color, border: `1px solid ${s.color}`,
        borderRadius: 'var(--radius-pill)', padding: dims.padding,
        ...style
      }}
      {...rest}
    >
      <span style={{
        width: dims.dot, height: dims.dot, borderRadius: '999px',
        background: 'currentColor',
        animation: s.pulse ? 'pc-pulse 1.8s ease-in-out infinite' : 'none'
      }} />
      {label || s.label}
      <style>{'@keyframes pc-pulse{0%,100%{opacity:.45}50%{opacity:1}}'}</style>
    </span>
  )
}
