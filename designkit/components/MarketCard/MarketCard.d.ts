import * as React from 'react'

export interface Market {
  id?: string
  category: 'Crypto' | 'Politics' | 'Sports' | 'Culture' | 'Tech' | 'Econ' | string
  question: string
  status: 'bootstrap' | 'graduating' | 'graduated' | 'resolved' | 'refunded'
  /** YES buy price in cents. */
  yesPrice: number
  /** NO buy price in cents. */
  noPrice: number
  /** Total volume in collateral units. */
  volume?: number
  /** Virtual LMSR liquidity parameter b. */
  b?: number
  /** Matched (path-compatible) liquidity so far. */
  matched?: number
  /** Graduation target. */
  target?: number
}

/**
 * Discovery-feed market tile. Composes StatusPill, OutcomeButton, GraduationBar.
 *
 * @startingPoint section="Markets" subtitle="Discovery-feed market card" viewport="560x420"
 */
export interface MarketCardProps {
  market: Market
  /** Card click → open market detail. */
  onOpen?: (m: Market) => void
  /** YES/NO cell click. */
  onPick?: (m: Market, side: 'yes' | 'no') => void
  /** Which side is selected, if any. */
  picked?: 'yes' | 'no'
  style?: React.CSSProperties
}

export function MarketCard(props: MarketCardProps): React.ReactElement
