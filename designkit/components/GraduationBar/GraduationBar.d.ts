import * as React from 'react'

/**
 * Progress toward band-pass graduation (matched liquidity vs target).
 *
 * @startingPoint section="Markets" subtitle="Graduation progress bar" viewport="700x110"
 */
export interface GraduationBarProps {
  /** Matched (path-compatible) liquidity gathered so far, in collateral units. */
  matched: number
  /** The matched-liquidity target required to graduate. */
  target: number
  /** Show the GRADUATION caption + numbers above the bar. @default true */
  showCaption?: boolean
  /** Bar thickness in px. @default 8 */
  height?: number
  style?: React.CSSProperties
}

export function GraduationBar(props: GraduationBarProps): React.ReactElement
