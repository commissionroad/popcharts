import * as React from 'react'

/**
 * Pop Charts button — magenta primary, outline secondary, ghost.
 *
 * @startingPoint section="Core" subtitle="Primary / secondary / ghost button" viewport="700x150"
 */
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. @default "primary" */
  variant?: 'primary' | 'secondary' | 'ghost'
  /** @default "md" */
  size?: 'sm' | 'md' | 'lg'
  /** Neon glow behind the button. @default true for primary */
  glow?: boolean
  /** Stretch to container width. @default false */
  full?: boolean
  disabled?: boolean
  /** Icon node rendered before the label (e.g. a Lucide <Rocket/>). */
  leftIcon?: React.ReactNode
  /** Icon node rendered after the label (e.g. an arrow). */
  rightIcon?: React.ReactNode
  children?: React.ReactNode
}

export function Button(props: ButtonProps): React.ReactElement
