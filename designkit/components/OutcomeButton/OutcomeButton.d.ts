import * as React from 'react'

/**
 * A YES / NO outcome price cell. Pair two inside a market card or trade panel.
 *
 * @startingPoint section="Markets" subtitle="YES / NO outcome price cell" viewport="700x140"
 */
export interface OutcomeButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Which side. @default "yes" */
  side?: 'yes' | 'no'
  /** Buy price in cents (the number before the ¢). */
  price: number
  /** Override the side label (defaults to YES/NO; use for custom outcomes). */
  label?: string
  /** Filled/selected state. @default false */
  selected?: boolean
}

export function OutcomeButton(props: OutcomeButtonProps): React.ReactElement
