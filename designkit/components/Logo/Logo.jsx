import React from 'react'

/** The Pop Charts pastry-tile + chart-arrow glyph. Inline so it needs no asset path. */
export function PopChartsGlyph({ size = 64, mono = false }) {
  const arrow = mono ? '#fff' : '#FF2E97'
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" fill="none" style={{ display: 'block' }} aria-hidden="true">
      <g transform="rotate(-7 62 58)">
        <rect x="33" y="18" width="60" height="76" rx="16" stroke="#fff" strokeWidth="6" />
        {!mono && (
          <g strokeWidth="5" strokeLinecap="round">
            <line x1="45" y1="31" x2="51" y2="29" stroke="#FF2E97" />
            <line x1="61" y1="27" x2="68" y2="29" stroke="#1FE0FF" />
            <line x1="77" y1="33" x2="82" y2="39" stroke="#C6FF3D" />
            <line x1="43" y1="47" x2="48" y2="52" stroke="#FFB020" />
            <line x1="79" y1="55" x2="85" y2="53" stroke="#B85CFF" />
          </g>
        )}
      </g>
      <g stroke="#fff" strokeWidth="4.5" strokeLinecap="round" opacity="0.5">
        <line x1="46" y1="78" x2="46" y2="92" /><line x1="58" y1="72" x2="58" y2="92" /><line x1="70" y1="80" x2="70" y2="92" />
      </g>
      <path d="M39 90 L53 73 L65 81 L92 49" stroke={arrow} strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M76 47 L95 45 L93 64" stroke={arrow} strokeWidth="8.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Pop Charts logo. variant: "lockup" (glyph + wordmark), "wordmark", "glyph",
 * or "tile" (glyph on a dark app-icon tile). Wordmark is Unbounded 800, "Charts" magenta.
 */
export function Logo({ variant = 'lockup', size = 34, mono = false, style = {} }) {
  const wordSize = size * 1.08
  const word = (
    <span style={{
      fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: wordSize,
      letterSpacing: '-0.02em', lineHeight: 0.9
    }}>
      <span style={{ color: '#fff' }}>Pop</span>
      <span style={{ color: mono ? '#fff' : 'var(--pc-magenta)' }}>Charts</span>
    </span>
  )

  if (variant === 'wordmark') return <div style={style}>{word}</div>
  if (variant === 'glyph') return <div style={style}><PopChartsGlyph size={size} mono={mono} /></div>
  if (variant === 'tile') {
    return (
      <div style={{
        width: size, height: size, borderRadius: 'var(--radius-xl)',
        background: 'linear-gradient(150deg,#1A1A22,#0B0B0F)', border: '1px solid var(--border-strong)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: 'var(--shadow-tile)', ...style
      }}>
        <PopChartsGlyph size={size * 0.66} mono={mono} />
      </div>
    )
  }
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.4, ...style }}>
      <PopChartsGlyph size={size} mono={mono} />
      {word}
    </div>
  )
}
