import * as React from 'react'

/**
 * The Pop Charts logo. Glyph is inline SVG (no asset path needed).
 *
 * @startingPoint section="Brand" subtitle="Logo lockup, wordmark, glyph, app tile" viewport="700x160"
 */
export interface LogoProps {
  /** @default "lockup" */
  variant?: 'lockup' | 'wordmark' | 'glyph' | 'tile'
  /** Glyph/wordmark size in px (tile uses it as the tile edge). @default 34 */
  size?: number
  /** Single-color (all-white) treatment for low-contrast or single-ink contexts. @default false */
  mono?: boolean
  style?: React.CSSProperties
}

export function Logo(props: LogoProps): React.ReactElement

export interface PopChartsGlyphProps { size?: number; mono?: boolean }
export function PopChartsGlyph(props: PopChartsGlyphProps): React.ReactElement
