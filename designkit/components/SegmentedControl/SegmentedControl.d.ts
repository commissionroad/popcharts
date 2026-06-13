import * as React from 'react'

export type SegmentOption = string | { value: string; label: React.ReactNode }

/**
 * Mutually-exclusive segmented toggle inside one rounded track.
 *
 * @startingPoint section="Core" subtitle="Segmented toggle (YES/NO, tabs)" viewport="700x120"
 */
export interface SegmentedControlProps {
  options: SegmentOption[]
  /** Currently-selected value. */
  value: string
  onChange?: (value: string) => void
  /** Return an accent color (CSS value) for a given option value — e.g. lime for YES. */
  accentBy?: (value: string) => string
  /** @default "md" */
  size?: 'sm' | 'md'
  /** Stretch segments to fill width. @default false */
  full?: boolean
  style?: React.CSSProperties
}

export function SegmentedControl(props: SegmentedControlProps): React.ReactElement
