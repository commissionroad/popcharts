import React from 'react'

/**
 * A labeled form field — mono uppercase label, rounded dark input, optional
 * hint and trailing suffix (unit / token symbol). Set multiline for a textarea.
 */
export function Field({
  label, hint, value, onChange, placeholder, type = 'text',
  multiline = false, suffix = null, mono = false, id, style = {}, ...rest
}) {
  const [focus, setFocus] = React.useState(false)
  const inputStyle = {
    width: '100%', background: 'transparent', border: 'none', outline: 'none',
    color: 'var(--text-primary)', fontSize: 15,
    fontFamily: mono ? 'var(--font-mono)' : 'var(--font-sans)',
    fontVariantNumeric: mono ? 'tabular-nums' : 'normal', resize: 'vertical'
  }

  return (
    <label htmlFor={id} style={{ display: 'flex', flexDirection: 'column', gap: 8, ...style }}>
      {label && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-secondary)'
        }}>{label}</span>
      )}
      <div style={{
        display: 'flex', alignItems: multiline ? 'flex-start' : 'center', gap: 10,
        background: 'var(--surface-raised)',
        border: `1px solid ${focus ? 'var(--pc-cyan)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)', padding: multiline ? '12px 14px' : '0 14px',
        height: multiline ? 'auto' : 46,
        transition: 'border-color var(--duration-fast) var(--ease-default)'
      }}>
        {multiline ? (
          <textarea id={id} rows={4} value={value} placeholder={placeholder}
            onChange={onChange} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
            style={inputStyle} {...rest} />
        ) : (
          <input id={id} type={type} value={value} placeholder={placeholder}
            onChange={onChange} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
            style={inputStyle} {...rest} />
        )}
        {suffix && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)',
            whiteSpace: 'nowrap'
          }}>{suffix}</span>
        )}
      </div>
      {hint && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>{hint}</span>
      )}
    </label>
  )
}
