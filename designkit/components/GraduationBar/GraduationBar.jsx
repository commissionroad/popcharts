import React from 'react'

/**
 * Graduation progress — how much path-compatible matched liquidity a market has
 * gathered toward its clearing target. Amber while filling, lime once it tips
 * over 100% (ready to graduate to CTF complete sets).
 */
export function GraduationBar({ matched = 0, target = 1, showCaption = true, height = 8, style = {} }) {
  const pct = target > 0 ? Math.min((matched / target) * 100, 100) : 0
  const ready = pct >= 100
  const color = ready ? 'var(--status-graduated)' : 'var(--status-graduating)'
  const fmt = (n) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n.toFixed(0)}`

  return (
    <div style={style}>
      {showCaption && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
          fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 7
        }}>
          <span style={{ color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
            {ready ? 'READY TO GRADUATE' : 'GRADUATION'}
          </span>
          <span style={{ color }}>
            {fmt(matched)} <span style={{ color: 'var(--text-muted)' }}>/ {fmt(target)} matched</span>
          </span>
        </div>
      )}
      <div style={{
        height, background: 'var(--surface-raised)', borderRadius: 'var(--radius-pill)',
        overflow: 'hidden', border: '1px solid var(--border)'
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', background: color,
          borderRadius: 'var(--radius-pill)',
          boxShadow: ready ? 'var(--glow-lime)' : 'var(--glow-amber)',
          transition: 'width var(--duration-normal) var(--ease-default)'
        }} />
      </div>
    </div>
  )
}
