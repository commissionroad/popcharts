import * as React from 'react'

/**
 * Labeled text field with mono uppercase label, optional hint and trailing suffix.
 *
 * @startingPoint section="Forms" subtitle="Labeled input / textarea" viewport="700x180"
 */
export interface FieldProps {
  /** Mono uppercase label above the input. */
  label?: string
  /** Helper text below the input. */
  hint?: string
  value?: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  placeholder?: string
  /** @default "text" */
  type?: string
  /** Render a textarea instead of an input. @default false */
  multiline?: boolean
  /** Trailing unit/token label inside the field (e.g. "pUSD", "%"). */
  suffix?: React.ReactNode
  /** Use the mono font + tabular figures (for amounts / the b value). @default false */
  mono?: boolean
  id?: string
  style?: React.CSSProperties
}

export function Field(props: FieldProps): React.ReactElement
