import React from 'react'

/**
 * Pop Charts primary button. Rounded snack-pop corners, magenta fill for the
 * primary action, neon glow optional. Lifts on hover, settles on press.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  glow = variant === 'primary',
  full = false,
  disabled = false,
  leftIcon = null,
  rightIcon = null,
  children,
  style = {},
  ...rest
}) {
  const [hover, setHover] = React.useState(false)
  const [active, setActive] = React.useState(false)

  const sizes = {
    sm: { padding: '9px 14px', fontSize: 13, radius: 'var(--radius-sm)' },
    md: { padding: '14px 20px', fontSize: 16, radius: 'var(--radius-md)' },
    lg: { padding: '17px 26px', fontSize: 18, radius: 'var(--radius-md)' }
  }
  const s = sizes[size] || sizes.md

  const base = {
    fontFamily: 'var(--font-display)',
    fontWeight: variant === 'ghost' ? 600 : 800,
    fontSize: s.fontSize,
    padding: s.padding,
    borderRadius: s.radius,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    width: full ? '100%' : 'auto',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.45 : 1,
    transition: 'transform var(--duration-fast) var(--ease-default), background var(--duration-fast) var(--ease-default), border-color var(--duration-fast) var(--ease-default)',
    transform: !disabled && hover && !active ? 'translateY(-2px)' : 'translateY(0)',
    border: '1px solid transparent',
    whiteSpace: 'nowrap'
  }

  const variants = {
    primary: {
      background: active ? 'var(--accent-pressed)' : 'var(--accent)',
      color: 'var(--accent-content)',
      boxShadow: glow && !disabled ? 'var(--glow-magenta)' : 'none'
    },
    secondary: {
      background: 'transparent',
      color: 'var(--text-primary)',
      borderColor: hover ? 'var(--pc-cyan)' : 'var(--border-strong)'
    },
    ghost: {
      background: hover ? 'var(--surface-hover)' : 'transparent',
      color: 'var(--text-secondary)'
    }
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setActive(false) }}
      onMouseDown={() => setActive(true)}
      onMouseUp={() => setActive(false)}
      style={{ ...base, ...(variants[variant] || variants.primary), ...style }}
      {...rest}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  )
}
