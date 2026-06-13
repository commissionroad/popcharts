import * as React from 'react'

/**
 * Market lifecycle status pill: Bootstrap → Graduating → Graduated → Resolved (or Refunded).
 *
 * @startingPoint section="Markets" subtitle="Lifecycle status pill" viewport="700x120"
 */
export interface StatusPillProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Where the market is in its lifecycle. @default "bootstrap" */
  status?: 'bootstrap' | 'graduating' | 'graduated' | 'resolved' | 'refunded'
  /** Override the default label text. */
  label?: string
  /** @default "md" */
  size?: 'sm' | 'md'
}

export function StatusPill(props: StatusPillProps): React.ReactElement
