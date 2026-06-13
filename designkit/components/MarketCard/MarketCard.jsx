import React from 'react'
import { StatusPill } from '../StatusPill/StatusPill.jsx'
import { OutcomeButton } from '../OutcomeButton/OutcomeButton.jsx'
import { GraduationBar } from '../GraduationBar/GraduationBar.jsx'

const CAT_COLOR = {
  Crypto: 'var(--pc-cyan)', Politics: 'var(--pc-violet)', Sports: 'var(--pc-lime)',
  Culture: 'var(--pc-amber)', Tech: 'var(--pc-cyan)', Econ: 'var(--pc-amber)'
}

/**
 * A market tile for the discovery feed. Composes StatusPill, two OutcomeButtons,
 * and a GraduationBar; footer shows volume and the virtual b. Lifts on hover.
 */
export function MarketCard({ market, onOpen, onPick, picked, style = {} }) {
  const [hover, setHover] = React.useState(false)
  const m = market || {}
  const catColor = CAT_COLOR[m.category] || 'var(--pc-cyan)'
  const isLive = m.status === 'bootstrap' || m.status === 'graduating'
  const fmtVol = (n) => n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${n}`

  return (
    <div
      onClick={() => onOpen && onOpen(m)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--surface-card)',
        border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-lg)', padding: 'var(--pad-card)',
        display: 'flex', flexDirection: 'column', gap: 18, cursor: 'pointer',
        transition: 'border-color var(--duration-fast) var(--ease-default), transform var(--duration-fast) var(--ease-default)',
        transform: hover ? 'translateY(-3px)' : 'translateY(0)', ...style
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em',
          color: catColor, border: `1px solid ${catColor}`, borderRadius: 'var(--radius-pill)',
          padding: '4px 11px', textTransform: 'uppercase'
        }}>{m.category}</span>
        <StatusPill status={m.status} size="sm" />
      </div>

      <div style={{
        fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 22,
        lineHeight: 1.18, color: 'var(--text-primary)', minHeight: 78
      }}>{m.question}</div>

      <div style={{ display: 'flex', gap: 12 }}>
        <OutcomeButton side="yes" price={m.yesPrice} selected={picked === 'yes'}
          onClick={(e) => { e.stopPropagation(); onPick && onPick(m, 'yes') }} />
        <OutcomeButton side="no" price={m.noPrice} selected={picked === 'no'}
          onClick={(e) => { e.stopPropagation(); onPick && onPick(m, 'no') }} />
      </div>

      {isLive && m.target ? (
        <GraduationBar matched={m.matched} target={m.target} height={6} />
      ) : null}

      <div style={{
        display: 'flex', justifyContent: 'space-between', borderTop: '1px solid var(--border-soft)',
        paddingTop: 14, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)'
      }}>
        <span>Vol {fmtVol(m.volume || 0)}</span>
        <span>b = {(m.b || 0).toLocaleString()}</span>
      </div>
    </div>
  )
}
