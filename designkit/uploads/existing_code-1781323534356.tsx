import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  CircleDollarSign,
  Coins,
  Copy,
  Cpu,
  Database,
  Eye,
  Flag,
  Hash,
  Loader2,
  LogOut,
  RefreshCcw,
  Rocket,
  Search,
  Server,
  Wallet
} from 'lucide-react'
import {
  BrowserProvider,
  Contract,
  ContractFactory,
  formatUnits,
  getAddress,
  id,
  isAddress,
  isHexString,
  JsonRpcProvider,
  keccak256,
  parseUnits,
  toUtf8Bytes
} from 'ethers'
import type { ContractTransactionResponse, Eip1193Provider, EventLog, JsonRpcSigner } from 'ethers'
import './App.css'
import {
  ERC20_METADATA_ABI,
  ERC20_TRADE_ABI,
  MARKET_STATUS_LABELS,
  MOCK_ERC20_ABI,
  MOCK_ERC20_BYTECODE,
  PREGRAD_MARKET_MANAGER_ABI
} from './launcher/contracts'
import {
  getMaxBuyExposureLocal,
  getStateAfterBuyLocal,
  quoteBuyExactExposureLocal,
  quoteSpotPriceLocal,
  solveExposureForBudgetLocal
} from './launcher/lmsrQuotes'
import {
  stableStringify,
  type MarketMetadata
} from './launcher/metadata'

type EthereumWithEvents = Eip1193Provider & {
  isMetaMask?: boolean
  isPhantom?: boolean
  on?: (event: string, listener: (...args: unknown[]) => void) => void
  providers?: EthereumWithEvents[]
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    ethereum?: EthereumWithEvents
    phantom?: {
      ethereum?: EthereumWithEvents
    }
  }
}

type LauncherView = 'create' | 'market' | 'markets' | 'portfolio' | 'protocol'

type Notice = {
  detail?: string
  hash?: string
  kind: 'error' | 'info' | 'pending' | 'success'
  title: string
}

type MarketFormState = {
  createdAt: string
  description: string
  expirationTime: string
  expirationTimeZone: string
  marketSeed: string
  outcomeNo: string
  outcomeYes: string
  question: string
  resolutionCriteria: string
  startingNoValue: string
  startingYesValue: string
}

type MarketSeedSource = Omit<MarketFormState, 'expirationTimeZone' | 'marketSeed'>

type CollateralTokenConfig = {
  address: string
  decimals: number
  symbol: string
}

type MockErc20Contract = Contract & {
  mint: (account: string, amount: bigint) => Promise<ContractTransactionResponse>
}

type TokenInfo = {
  decimals: number
  name?: string
  symbol: string
}

type ReadProvider = BrowserProvider | JsonRpcProvider

type OnchainMarketState = {
  collateral: string
  creator: string
  expirationTime: bigint
  metadataHash: string
  qNo: bigint
  qYes: bigint
  receiptAccumulator: string
  receiptCount: bigint
  status: number
  totalEscrowed: bigint
}

type MarketRecordSource = 'event' | 'lookup'

type MarketRecord = {
  blockNumber?: number
  createdTxHash?: string
  marketId: string
  metadata: MarketMetadata | null
  source: MarketRecordSource
  defaultLiquidity: bigint
  graduationMatchedLiquidity: bigint
  matchedLiquidity: bigint
  spotNo?: bigint
  spotYes?: bigint
  state: OnchainMarketState
  token: TokenInfo
}

type TradeSide = 'yes' | 'no'

type MarketLifecycleAction = 'cancel' | 'graduate' | 'resolve-yes' | 'resolve-no'

type MarketLifecycleAuthorities = {
  manager: string
}

type UserMarketPosition = {
  escrowed: bigint
  noExposure: bigint
  yesExposure: bigint
}

type TradeAccountState = {
  allowance: bigint
  balance: bigint
  operationManager: string
  position: UserMarketPosition
}

type TradeQuote = {
  averagePrice: bigint
  budget: bigint
  collateralIn: bigint
  error?: string
  hasAmount: boolean
  maxCost: bigint
  maxExposure: bigint
  minExposureAfterSlippage: bigint
  priceAfter: bigint
  priceBefore: bigint
  priceImpact: bigint
  exposure: bigint
  warning?: string
}

type WalletOption = {
  id: string
  label: string
  provider: EthereumWithEvents
}

type PortfolioSnapshot = {
  account: string
  blockNumber?: number
  ethBalance: bigint
  fakeUsdAddress: string
  fakeUsdBalance: bigint | null
  fakeUsdToken: TokenInfo
}

const managerAddressEnv = import.meta.env.VITE_PREGRAD_MANAGER_ADDRESS as string | undefined
const create3FactoryAddressEnv = import.meta.env.VITE_PREGRAD_CREATE3_FACTORY_ADDRESS as string | undefined
const managerCreate3SaltEnv = import.meta.env.VITE_PREGRAD_MANAGER_CREATE3_SALT as string | undefined
const fakeUsdAddressEnv = import.meta.env.VITE_PREGRAD_FAKE_USD_ADDRESS as string | undefined
const fakeUsdCreate3SaltEnv = import.meta.env.VITE_PREGRAD_FAKE_USD_CREATE3_SALT as string | undefined
const fakeUsdSymbolEnv = (import.meta.env.VITE_PREGRAD_FAKE_USD_SYMBOL as string | undefined) ?? 'pUSD'
const expectedChainIdEnv = ((import.meta.env.VITE_PREGRAD_LOCAL_CHAIN_ID as string | undefined) ?? '').trim()
const localRpcUrlEnv = (import.meta.env.VITE_PREGRAD_LOCAL_RPC_URL as string | undefined) ?? 'http://127.0.0.1:8545'
const defaultFakeCollateralFaucetAmount = '100000'
const defaultEthFaucetAmount = '10'
const defaultMarketDurationMs = 7 * 24 * 60 * 60 * 1000
const defaultCurveLiquidity = parseUnits('5000', 18)
const defaultStartingNoValue = '50'
const defaultStartingYesValue = '50'
const startingValueScale = parseUnits('100', 18)
const sideNo = 1
const sideYes = 0
const tradeSlippageBps = 150n
const tradeWarningImpact = parseUnits('0.05', 18)
const tradeMaxImpact = parseUnits('0.2', 18)
const wad = parseUnits('1', 18)

const defaultQuestion = 'Will PredictFun launch 25 pre-graduation markets this month?'
const commonExpirationTimeZones = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney'
]

const expirationTimeZoneLabels: Record<string, string> = {
  UTC: 'UTC',
  'America/New_York': 'Eastern Time',
  'America/Chicago': 'Central Time',
  'America/Denver': 'Mountain Time',
  'America/Los_Angeles': 'Pacific Time',
  'America/Anchorage': 'Alaska Time',
  'Pacific/Honolulu': 'Hawaii Time',
  'Europe/London': 'London',
  'Europe/Berlin': 'Berlin',
  'Asia/Singapore': 'Singapore',
  'Asia/Tokyo': 'Tokyo',
  'Australia/Sydney': 'Sydney'
}

function makeMarketSeed(source: MarketSeedSource) {
  const seedPayload = {
    createdAt: source.createdAt,
    description: source.description.trim(),
    expirationTime: source.expirationTime.trim(),
    outcomeNo: source.outcomeNo.trim() || 'NO',
    outcomeYes: source.outcomeYes.trim() || 'YES',
    question: source.question.trim(),
    resolutionCriteria: source.resolutionCriteria.trim(),
    startingNoValue: source.startingNoValue.trim() || defaultStartingNoValue,
    startingYesValue: source.startingYesValue.trim() || defaultStartingYesValue
  }
  const suffix = keccak256(toUtf8Bytes(stableStringify(seedPayload))).slice(2, 12)

  return `predictfun:${slugify(source.question)}:${suffix}`
}

const createDefaultCollateralToken = (): CollateralTokenConfig => ({
  address: fakeUsdAddressEnv ?? '',
  decimals: 18,
  symbol: fakeUsdSymbolEnv
})

const createDefaultForm = (): MarketFormState => {
  const expirationTimeZone = getDefaultExpirationTimeZone()
  const base: MarketSeedSource = {
    createdAt: new Date().toISOString(),
    description: 'A pre-graduation prediction market for early liquidity and receipt tracking.',
    expirationTime: toUtcMinuteStorageValue(new Date(Date.now() + defaultMarketDurationMs)),
    outcomeNo: 'NO',
    outcomeYes: 'YES',
    question: defaultQuestion,
    resolutionCriteria:
      'Resolve YES if the stated event is confirmed by the chosen source before the deadline; otherwise resolve NO.',
    startingNoValue: defaultStartingNoValue,
    startingYesValue: defaultStartingYesValue
  }

  return {
    ...base,
    expirationTimeZone,
    marketSeed: makeMarketSeed(base)
  }
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 56)

  return slug || 'market'
}

function padDateTimePart(value: number) {
  return value.toString().padStart(2, '0')
}

function toUtcMinuteStorageValue(date: Date) {
  const minuteTime = Math.floor(date.getTime() / 60_000) * 60_000
  return new Date(minuteTime).toISOString()
}

function getDefaultExpirationTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function getDateTimePartsInTimeZone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone,
    year: 'numeric'
  })
  const parts = formatter.formatToParts(date).reduce<Record<string, string>>((values, part) => {
    if (part.type !== 'literal') {
      values[part.type] = part.value
    }
    return values
  }, {})

  return {
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    month: Number(parts.month),
    second: Number(parts.second),
    year: Number(parts.year)
  }
}

function getTimeZoneOffsetMs(timeZone: string, date: Date) {
  const parts = getDateTimePartsInTimeZone(date, timeZone)
  const timeZoneAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  )

  return timeZoneAsUtc - Math.floor(date.getTime() / 1000) * 1000
}

function parseDateTimeInputParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!match) {
    throw new Error('Trading close time is invalid.')
  }

  const [, year, month, day, hour, minute] = match
  return {
    day: Number(day),
    hour: Number(hour),
    minute: Number(minute),
    month: Number(month),
    year: Number(year)
  }
}

function timeZoneInputValueToUtcStorageValue(value: string, timeZone: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  const parts = parseDateTimeInputParts(trimmed)
  const wallTimeAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
  let offset = getTimeZoneOffsetMs(timeZone, new Date(wallTimeAsUtc))
  let utcTime = wallTimeAsUtc - offset
  const adjustedOffset = getTimeZoneOffsetMs(timeZone, new Date(utcTime))
  if (adjustedOffset !== offset) {
    offset = adjustedOffset
    utcTime = wallTimeAsUtc - offset
  }

  return toUtcMinuteStorageValue(new Date(utcTime))
}

function utcStorageValueToTimeZoneInputValue(value: string, timeZone: string) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) {
    return ''
  }

  const parts = getDateTimePartsInTimeZone(new Date(time), timeZone)
  return `${parts.year}-${padDateTimePart(parts.month)}-${padDateTimePart(parts.day)}T${padDateTimePart(parts.hour)}:${padDateTimePart(parts.minute)}`
}

function formatTimeZoneOffset(timeZone: string, date: Date) {
  try {
    const offsetMinutes = Math.round(getTimeZoneOffsetMs(timeZone, date) / 60_000)
    const sign = offsetMinutes >= 0 ? '+' : '-'
    const absoluteMinutes = Math.abs(offsetMinutes)
    const hours = Math.floor(absoluteMinutes / 60)
    const minutes = absoluteMinutes % 60
    return `UTC${sign}${padDateTimePart(hours)}:${padDateTimePart(minutes)}`
  } catch {
    return timeZone
  }
}

function formatExpirationTimeZoneOption(timeZone: string, date: Date) {
  const label = expirationTimeZoneLabels[timeZone] ?? timeZone.replace(/_/g, ' ')
  return `${label} (${formatTimeZoneOffset(timeZone, date)})`
}

function getExpirationTimeZoneOptions(selectedTimeZone: string) {
  return Array.from(new Set([selectedTimeZone, getDefaultExpirationTimeZone(), ...commonExpirationTimeZones])).filter(
    Boolean
  )
}

function getExpirationTimeZoneOffsetDate(expirationTime: string) {
  const time = new Date(expirationTime).getTime()
  return new Date(Number.isFinite(time) ? time : Date.now())
}

function applyExpirationTimeChange(form: MarketFormState, value: string): MarketFormState {
  return {
    ...form,
    expirationTime: timeZoneInputValueToUtcStorageValue(value, form.expirationTimeZone)
  }
}

function applyExpirationTimeZoneChange(form: MarketFormState, expirationTimeZone: string): MarketFormState {
  const displayedExpirationTime = utcStorageValueToTimeZoneInputValue(form.expirationTime, form.expirationTimeZone)
  if (!displayedExpirationTime) {
    return { ...form, expirationTimeZone }
  }

  return {
    ...form,
    expirationTime: timeZoneInputValueToUtcStorageValue(displayedExpirationTime, expirationTimeZone),
    expirationTimeZone
  }
}

function getMarketIdFromHash() {
  const match = window.location.hash.match(/^#\/markets\/(.+)$/u)
  if (!match) {
    return ''
  }

  try {
    return decodeURIComponent(match[1])
  } catch {
    return match[1]
  }
}

function getInitialView(): LauncherView {
  if (getMarketIdFromHash()) {
    return 'market'
  }

  if (window.location.hash === '#/portfolio') {
    return 'portfolio'
  }

  if (window.location.hash === '#/markets') {
    return 'markets'
  }

  if (window.location.hash === '#/protocol') {
    return 'protocol'
  }

  return 'create'
}

function getInjectedProviderCandidates() {
  const candidates: EthereumWithEvents[] = []

  const addCandidate = (candidate?: EthereumWithEvents) => {
    if (candidate && !candidates.includes(candidate)) {
      candidates.push(candidate)
    }
  }

  window.ethereum?.providers?.forEach(addCandidate)
  addCandidate(window.ethereum)
  addCandidate(window.phantom?.ethereum)

  return candidates
}

function getWalletOptions(): WalletOption[] {
  const candidates = getInjectedProviderCandidates()
  const options: WalletOption[] = []

  const addOption = (id: string, label: string, provider?: EthereumWithEvents) => {
    if (!provider || options.some((option) => option.id === id || option.provider === provider)) {
      return
    }

    options.push({ id, label, provider })
  }

  addOption('metamask', 'MetaMask', candidates.find((candidate) => candidate.isMetaMask))
  addOption(
    'phantom',
    'Phantom',
    window.phantom?.ethereum ?? candidates.find((candidate) => candidate.isPhantom)
  )

  if (options.length === 0) {
    addOption('injected', 'Wallet', window.ethereum)
  }

  return options
}

function getPreferredWalletOptions(options: WalletOption[], walletId?: string) {
  const preferredIds = Array.from(new Set([walletId].filter((id): id is string => Boolean(id))))
  const preferred = preferredIds
    .map((preferredId) => options.find((option) => option.id === preferredId))
    .filter((option): option is WalletOption => Boolean(option))

  return [...preferred, ...options.filter((option) => !preferred.includes(option))]
}

function normalizeAddress(value: string) {
  return getAddress(value.trim())
}

function normalizeMarketId(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Market seed is required.')
  }

  return isHexString(trimmed, 32) ? trimmed : id(trimmed)
}

function makeMetadata(form: MarketFormState): MarketMetadata {
  return {
    createdAt: form.createdAt,
    description: form.description.trim(),
    marketSeed: makeMarketSeed(form),
    outcomeNo: form.outcomeNo.trim() || 'NO',
    outcomeYes: form.outcomeYes.trim() || 'YES',
    question: form.question.trim(),
    resolutionCriteria: form.resolutionCriteria.trim(),
    startingNoValue: form.startingNoValue.trim() || defaultStartingNoValue,
    startingYesValue: form.startingYesValue.trim() || defaultStartingYesValue,
    version: 'predictfun.market.v1'
  }
}

function hashMetadata(metadata: MarketMetadata) {
  return keccak256(toUtf8Bytes(stableStringify(metadata)))
}

function getErrorMessage(error: unknown) {
  const candidate = error as {
    error?: { message?: string }
    info?: { error?: { message?: string } }
    message?: string
    reason?: string
    shortMessage?: string
  }

  return (
    candidate.shortMessage ??
    candidate.reason ??
    candidate.info?.error?.message ??
    candidate.error?.message ??
    candidate.message ??
    'The request failed.'
  )
}

function truncateAddress(address: string, lead = 6, tail = 4) {
  if (address.length <= lead + tail + 3) {
    return address
  }

  return `${address.slice(0, lead)}...${address.slice(-tail)}`
}

function formatDecimalString(value: string, fractionDigits = 4) {
  const [whole, fraction = ''] = value.split('.')
  const trimmedFraction = fraction.slice(0, fractionDigits).replace(/0+$/g, '')
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole
}

function formatTokenAmount(value: bigint, decimals: number, symbol: string, fractionDigits = 4) {
  try {
    return `${formatDecimalString(formatUnits(value, decimals), fractionDigits)} ${symbol}`
  } catch {
    return `${value.toString()} ${symbol}`
  }
}

function parseExpirationTime(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error('Trading close time is required.')
  }

  const time = new Date(trimmed).getTime()
  if (!Number.isFinite(time)) {
    throw new Error('Trading close time is invalid.')
  }

  const expirationTime = Math.floor(time / 1000)
  if (expirationTime <= Math.floor(Date.now() / 1000)) {
    throw new Error('Trading close time must be in the future.')
  }

  return BigInt(expirationTime)
}

function formatUnixTime(value: bigint, timeZone?: string) {
  const seconds = Number(value)
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    return 'Unset'
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
    timeZone,
    timeZoneName: 'short',
    year: 'numeric'
  }).format(new Date(seconds * 1000))
}

function parsePositiveAmount(value: string, decimals: number, symbol: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${symbol} amount is required.`)
  }

  const parsed = parseUnits(trimmed, decimals)
  if (parsed <= 0n) {
    throw new Error(`${symbol} amount must be greater than zero.`)
  }

  return parsed
}

function parseStartingValue(value: string, label: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error(`${label} starting value is required.`)
  }

  const parsed = parseUnits(trimmed, 18)
  if (parsed < 0n || parsed > startingValueScale) {
    throw new Error(`${label} starting value must be between 0 and 100.`)
  }

  return parsed
}

function parseStartingValues(form: MarketFormState) {
  const yesValue = parseStartingValue(form.startingYesValue, 'YES')
  const noValue = parseStartingValue(form.startingNoValue, 'NO')

  if (yesValue + noValue !== startingValueScale) {
    throw new Error('Starting YES and NO values must total 100.')
  }

  return { noValue, yesValue }
}

function getInitialMarketQuantities(form: MarketFormState) {
  const { yesValue } = parseStartingValues(form)
  const signedSkew = (defaultCurveLiquidity * (2n * yesValue - startingValueScale)) / startingValueScale

  return signedSkew >= 0n
    ? { initialQNo: 0n, initialQYes: signedSkew }
    : { initialQNo: -signedSkew, initialQYes: 0n }
}

function formatStartingValue(value: number) {
  return value.toFixed(4).replace(/\.?0+$/u, '') || '0'
}

function getComplementStartingValue(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
    return null
  }

  return formatStartingValue(100 - parsed)
}

function applyStartingValueChange(form: MarketFormState, side: 'no' | 'yes', value: string) {
  const complement = getComplementStartingValue(value)
  if (complement === null) {
    return side === 'yes' ? { ...form, startingYesValue: value } : { ...form, startingNoValue: value }
  }

  return side === 'yes'
    ? { ...form, startingYesValue: value, startingNoValue: complement }
    : { ...form, startingNoValue: value, startingYesValue: complement }
}

function formatStartingValueDisplay(value: string) {
  const trimmed = value.trim()
  return trimmed ? `${trimmed}%` : '-'
}

function formatPercent(value: bigint) {
  const asNumber = Number(formatUnits(value, 18))
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1
  }).format(asNumber * 100)}%`
}

function formatPercentagePointChange(value: bigint) {
  const asNumber = Number(formatUnits(value, 18)) * 100
  const sign = asNumber > 0 ? '+' : ''

  return `${sign}${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  }).format(asNumber)} pts`
}

function formatInputAmount(value: bigint, decimals: number) {
  return formatDecimalString(formatUnits(value, decimals), Math.min(decimals, 6))
}

function getSideLabel(side: TradeSide, market: MarketRecord) {
  return side === 'yes' ? market.metadata?.outcomeYes ?? 'YES' : market.metadata?.outcomeNo ?? 'NO'
}

function getSideIndex(side: TradeSide) {
  return side === 'yes' ? sideYes : sideNo
}

function getLifecycleActionLabel(action: MarketLifecycleAction) {
  if (action === 'cancel') {
    return 'Cancel'
  }

  if (action === 'graduate') {
    return 'Graduate'
  }

  return action === 'resolve-yes' ? 'Resolve YES' : 'Resolve NO'
}

function getLifecycleSuccessTitle(action: MarketLifecycleAction) {
  if (action === 'cancel') {
    return 'Market cancelled'
  }

  if (action === 'graduate') {
    return 'Market graduated'
  }

  return 'Market resolved'
}

function isResolveLifecycleAction(action: MarketLifecycleAction) {
  return action === 'resolve-yes' || action === 'resolve-no'
}

function getLifecycleBusyKey(action: MarketLifecycleAction, marketId: string) {
  return `${action}-market:${marketId}`
}

function minBigInt(left: bigint, right: bigint) {
  return left < right ? left : right
}

function buildTradeQuote(market: MarketRecord, side: TradeSide, amount: string): TradeQuote {
  const hasAmount = amount.trim().length > 0
  const emptyQuote = {
    averagePrice: 0n,
    budget: 0n,
    collateralIn: 0n,
    hasAmount,
    maxCost: 0n,
    maxExposure: 0n,
    minExposureAfterSlippage: 0n,
    priceAfter: quoteSpotPriceLocal(market.state, side, market.defaultLiquidity),
    priceBefore: quoteSpotPriceLocal(market.state, side, market.defaultLiquidity),
    priceImpact: 0n,
    exposure: 0n
  }

  const maxExposure = getMaxBuyExposureLocal(market.state, side, market.defaultLiquidity)
  const maxCost = quoteBuyExactExposureLocal(market.state, side, maxExposure, market.defaultLiquidity)

  if (!hasAmount) {
    return { ...emptyQuote, maxCost, maxExposure }
  }

  let budget: bigint
  try {
    budget = parsePositiveAmount(amount, market.token.decimals, market.token.symbol)
  } catch (error) {
    return {
      ...emptyQuote,
      error: getErrorMessage(error),
      maxCost,
      maxExposure
    }
  }

  if (maxExposure <= 0n || maxCost <= 0n) {
    return {
      ...emptyQuote,
      budget,
      error: 'This side has no remaining curve capacity.',
      maxCost,
      maxExposure
    }
  }

  if (budget > maxCost) {
    return {
      ...emptyQuote,
      budget,
      error: `Maximum ${getSideLabel(side, market)} order is ${formatTokenAmount(maxCost, market.token.decimals, market.token.symbol)}.`,
      maxCost,
      maxExposure
    }
  }

  const exposure = solveExposureForBudgetLocal(market.state, side, budget, market.defaultLiquidity)
  if (exposure <= 0n) {
    return {
      ...emptyQuote,
      budget,
      error: 'Amount is too small to buy any exposure after curve rounding.',
      maxCost,
      maxExposure
    }
  }

  const collateralIn = quoteBuyExactExposureLocal(market.state, side, exposure, market.defaultLiquidity)
  const priceBefore = quoteSpotPriceLocal(market.state, side, market.defaultLiquidity)
  const priceAfter = quoteSpotPriceLocal(getStateAfterBuyLocal(market.state, side, exposure), side, market.defaultLiquidity)
  const priceImpact = priceAfter - priceBefore
  const minExposureAfterSlippage = (exposure * (10_000n - tradeSlippageBps)) / 10_000n
  const warning =
    priceImpact >= tradeWarningImpact
      ? `Price impact is ${formatPercentagePointChange(priceImpact)}.`
      : undefined

  return {
    averagePrice: exposure > 0n ? (collateralIn * wad) / exposure : 0n,
    budget,
    collateralIn,
    hasAmount,
    maxCost,
    maxExposure,
    minExposureAfterSlippage,
    priceAfter,
    priceBefore,
    priceImpact,
    exposure,
    warning
  }
}

function getProgress(total: bigint, target: bigint) {
  if (target <= 0n) {
    return 0
  }

  return Math.min(Number((total * 10000n) / target) / 100, 100)
}

function readMarketState(raw: Record<string, unknown> & Array<unknown>): OnchainMarketState {
  return {
    collateral: String(raw.collateral ?? raw[1]),
    creator: String(raw.creator ?? raw[0]),
    expirationTime: BigInt((raw.expirationTime ?? raw[4]) as bigint | string | number),
    metadataHash: String(raw.metadataHash ?? raw[8]),
    qNo: BigInt((raw.qNo ?? raw[6]) as bigint | string | number),
    qYes: BigInt((raw.qYes ?? raw[5]) as bigint | string | number),
    receiptAccumulator: String(raw.receiptAccumulator ?? raw[9]),
    receiptCount: BigInt((raw.receiptCount ?? raw[3]) as bigint | string | number),
    status: Number(raw.status ?? raw[2]),
    totalEscrowed: BigInt((raw.totalEscrowed ?? raw[7]) as bigint | string | number)
  }
}

function readUserPosition(raw: Record<string, unknown> & Array<unknown>): UserMarketPosition {
  return {
    escrowed: BigInt((raw.escrowed ?? raw[2]) as bigint | string | number),
    noExposure: BigInt((raw.noExposure ?? raw[1]) as bigint | string | number),
    yesExposure: BigInt((raw.yesExposure ?? raw[0]) as bigint | string | number)
  }
}

async function readTokenInfo(provider: ReadProvider, address: string): Promise<TokenInfo> {
  if (!isAddress(address)) {
    return { decimals: 18, symbol: 'TOKEN' }
  }

  const token = new Contract(address, ERC20_METADATA_ABI, provider)
  const [symbol, decimals, name] = await Promise.all([
    token.symbol().catch(() => 'TOKEN'),
    token.decimals().catch(() => 18n),
    token.name().catch(() => undefined)
  ])

  return {
    decimals: Number(decimals),
    name: typeof name === 'string' ? name : undefined,
    symbol: typeof symbol === 'string' ? symbol : 'TOKEN'
  }
}

async function sendLocalDevRpc(provider: BrowserProvider, method: string, params: unknown[]) {
  try {
    return await provider.send(method, params)
  } catch (walletError) {
    try {
      const response = await fetch(localRpcUrlEnv, {
        body: JSON.stringify({
          id: Date.now(),
          jsonrpc: '2.0',
          method,
          params
        }),
        headers: {
          'content-type': 'application/json'
        },
        method: 'POST'
      })
      const payload = (await response.json().catch(() => null)) as { error?: { message?: string }; result?: unknown } | null

      if (!response.ok || payload?.error) {
        throw new Error(payload?.error?.message ?? `${method} failed at ${localRpcUrlEnv}.`)
      }

      return payload?.result
    } catch (rpcError) {
      throw new Error(
        `${method} failed through the wallet and ${localRpcUrlEnv}. Wallet: ${getErrorMessage(walletError)} RPC: ${getErrorMessage(rpcError)}`
      )
    }
  }
}

function isEventLog(log: unknown): log is EventLog {
  return Boolean(log && typeof log === 'object' && 'args' in log)
}

function App() {
  const localReadProvider = useMemo(() => new JsonRpcProvider(localRpcUrlEnv), [])
  const [view, setView] = useState<LauncherView>(getInitialView)
  const [selectedMarketId, setSelectedMarketId] = useState(getMarketIdFromHash)
  const [provider, setProvider] = useState<BrowserProvider | null>(null)
  const [signer, setSigner] = useState<JsonRpcSigner | null>(null)
  const [account, setAccount] = useState('')
  const [chainId, setChainId] = useState<string>('')
  const [managerAddress, setManagerAddress] = useState(managerAddressEnv ?? '')
  const [managerCodeStatus, setManagerCodeStatus] = useState<'empty' | 'ready' | 'unknown' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [form, setForm] = useState<MarketFormState>(createDefaultForm)
  const [fixedCollateralToken, setFixedCollateralToken] =
    useState<CollateralTokenConfig>(createDefaultCollateralToken)
  const [markets, setMarkets] = useState<MarketRecord[]>([])
  const [marketsError, setMarketsError] = useState('')
  const [marketsLoading, setMarketsLoading] = useState(false)
  const [marketDetail, setMarketDetail] = useState<MarketRecord | null>(null)
  const [marketDetailError, setMarketDetailError] = useState('')
  const [marketDetailLoading, setMarketDetailLoading] = useState(false)
  const [scanFromBlock, setScanFromBlock] = useState('0')
  const [manualLookup, setManualLookup] = useState('')
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [marketDetailRefreshNonce, setMarketDetailRefreshNonce] = useState(0)
  const [portfolio, setPortfolio] = useState<PortfolioSnapshot | null>(null)
  const [portfolioError, setPortfolioError] = useState('')
  const [portfolioLoading, setPortfolioLoading] = useState(false)
  const [portfolioMarkets, setPortfolioMarkets] = useState<MarketRecord[]>([])
  const [portfolioMarketsError, setPortfolioMarketsError] = useState('')
  const [portfolioMarketsLoading, setPortfolioMarketsLoading] = useState(false)
  const [portfolioRefreshNonce, setPortfolioRefreshNonce] = useState(0)
  const [marketLifecycleAuthorities, setMarketLifecycleAuthorities] =
    useState<MarketLifecycleAuthorities | null>(null)
  const [fakeCollateralFaucetAmount, setFakeCollateralFaucetAmount] = useState(defaultFakeCollateralFaucetAmount)
  const [ethFaucetAmount, setEthFaucetAmount] = useState(defaultEthFaucetAmount)
  const [walletOptions, setWalletOptions] = useState<WalletOption[]>(getWalletOptions)
  const [connectedWalletId, setConnectedWalletId] = useState('')
  const [tradeAccount, setTradeAccount] = useState<TradeAccountState | null>(null)
  const [tradeAccountError, setTradeAccountError] = useState('')
  const [tradeAccountLoading, setTradeAccountLoading] = useState(false)
  const [tradeAccountRefreshNonce, setTradeAccountRefreshNonce] = useState(0)
  const [tradeAmount, setTradeAmount] = useState('')
  const [tradeSide, setTradeSide] = useState<TradeSide>('yes')

  const managerIsValid = isAddress(managerAddress.trim())
  const checksumManagerAddress = managerIsValid ? normalizeAddress(managerAddress) : ''
  const checksumFakeUsdAddress =
    fakeUsdAddressEnv && isAddress(fakeUsdAddressEnv) ? normalizeAddress(fakeUsdAddressEnv) : ''
  const fixedCollateralIsValid = isAddress(fixedCollateralToken.address.trim())
  const checksumFixedCollateralAddress = fixedCollateralIsValid
    ? normalizeAddress(fixedCollateralToken.address)
    : ''
  const fixedCollateralLabel = checksumFixedCollateralAddress
    ? `${fixedCollateralToken.symbol} ${truncateAddress(checksumFixedCollateralAddress, 10, 8)}`
    : 'VITE_PREGRAD_FAKE_USD_ADDRESS'
  const walletLabel = account ? truncateAddress(account) : 'Connect'
  const chainLabel = chainId ? `Chain ${chainId}` : 'No chain'
  const expectedChainLabel = expectedChainIdEnv ? `Chain ${expectedChainIdEnv}` : 'Unset'
  const chainMismatch = Boolean(account && chainId && expectedChainIdEnv && chainId !== expectedChainIdEnv)
  const chainPillTitle = expectedChainIdEnv
    ? `${chainLabel}. Expected ${expectedChainLabel}.`
    : chainLabel
  const walletActionDisabled = busy === 'wallet-disconnect' || (Boolean(account) && busy !== null)
  const connectedWalletLabel =
    walletOptions.find((walletOption) => walletOption.id === connectedWalletId)?.label ?? 'Wallet'
  const checksumAccount = account && isAddress(account) ? normalizeAddress(account) : ''

  const preview = useMemo(() => {
    try {
      const metadata = makeMetadata(form)
      return {
        marketId: normalizeMarketId(metadata.marketSeed),
        metadata,
        metadataHash: hashMetadata(metadata)
      }
    } catch (error) {
      return {
        error: getErrorMessage(error),
        marketId: '',
        metadata: makeMetadata(form),
        metadataHash: ''
      }
    }
  }, [form])
  const expirationInputValue = useMemo(
    () => utcStorageValueToTimeZoneInputValue(form.expirationTime, form.expirationTimeZone),
    [form.expirationTime, form.expirationTimeZone]
  )
  const expirationTimeZoneOptions = useMemo(
    () => getExpirationTimeZoneOptions(form.expirationTimeZone),
    [form.expirationTimeZone]
  )
  const expirationTimeZoneOffsetDate = useMemo(
    () => getExpirationTimeZoneOffsetDate(form.expirationTime),
    [form.expirationTime]
  )
  const expirationPreview = useMemo(() => {
    try {
      return formatUnixTime(parseExpirationTime(form.expirationTime), form.expirationTimeZone)
    } catch (error) {
      return getErrorMessage(error)
    }
  }, [form.expirationTime, form.expirationTimeZone])
  const expirationUtcPreview = useMemo(() => {
    try {
      return formatUnixTime(parseExpirationTime(form.expirationTime), 'UTC')
    } catch (error) {
      return getErrorMessage(error)
    }
  }, [form.expirationTime])

  useEffect(() => {
    const nextSeed = makeMarketSeed(form)
    if (form.marketSeed !== nextSeed) {
      setForm((current) => ({ ...current, marketSeed: makeMarketSeed(current) }))
    }
  }, [
    form.createdAt,
    form.description,
    form.expirationTime,
    form.marketSeed,
    form.outcomeNo,
    form.outcomeYes,
    form.question,
    form.resolutionCriteria,
    form.startingNoValue,
    form.startingYesValue
  ])

  const resetWalletConnection = useCallback(() => {
    setProvider(null)
    setSigner(null)
    setAccount('')
    setChainId('')
    setManagerCodeStatus(null)
    setMarkets([])
    setMarketDetail(null)
    setTradeAccount(null)
    setTradeAccountError('')
    setTradeAccountLoading(false)
    setPortfolio(null)
    setPortfolioError('')
    setPortfolioLoading(false)
    setPortfolioMarkets([])
    setPortfolioMarketsError('')
    setPortfolioMarketsLoading(false)
    setMarketLifecycleAuthorities(null)
    setConnectedWalletId('')
  }, [])

  const connectWallet = useCallback(async (requestAccounts = true, walletId?: string) => {
    const nextWalletOptions = getWalletOptions()
    setWalletOptions(nextWalletOptions)

    if (nextWalletOptions.length === 0) {
      resetWalletConnection()

      if (requestAccounts) {
        setNotice({
          detail: 'Install MetaMask or Phantom, or enable another EIP-1193 wallet.',
          kind: 'error',
          title: 'Wallet unavailable'
        })
      }
      return
    }

    if (requestAccounts && !walletId && nextWalletOptions.length > 1) {
      setNotice({
        detail: nextWalletOptions.map((walletOption) => walletOption.label).join(' or '),
        kind: 'info',
        title: 'Choose a wallet'
      })
      return
    }

    const walletCandidates = requestAccounts
      ? getPreferredWalletOptions(nextWalletOptions, walletId).slice(0, 1)
      : getPreferredWalletOptions(nextWalletOptions, walletId)

    let lastError: unknown = null

    for (const walletOption of walletCandidates) {
      try {
        const nextProvider = new BrowserProvider(walletOption.provider)
        const accounts = (await nextProvider.send(
          requestAccounts ? 'eth_requestAccounts' : 'eth_accounts',
          []
        )) as string[]

        if (accounts.length === 0) {
          continue
        }

        const network = await nextProvider.getNetwork()
        const nextSigner = await nextProvider.getSigner()

        setProvider(nextProvider)
        setChainId(network.chainId.toString())
        setSigner(nextSigner)
        setConnectedWalletId(walletOption.id)
        setAccount(await nextSigner.getAddress())
        return
      } catch (error) {
        lastError = error

        if (requestAccounts) {
          break
        }
      }
    }

    resetWalletConnection()

    if (!requestAccounts) {
      return
    }

    if (lastError) {
      setNotice({
        detail: getErrorMessage(lastError),
        kind: 'error',
        title: 'Wallet connection failed'
      })
    }
  }, [resetWalletConnection])

  const disconnectWallet = useCallback(async () => {
    setBusy('wallet-disconnect')

    try {
      const walletOption = getWalletOptions().find((option) => option.id === connectedWalletId)
      if (walletOption) {
        try {
          await walletOption.provider.request({
            method: 'wallet_revokePermissions',
            params: [{ eth_accounts: {} }]
          })
        } catch {
          // Wallet permission revocation is optional; local disconnect still keeps this app disconnected.
        }
      }

      resetWalletConnection()
      setNotice({
        detail: 'Use Connect to authorize a wallet again.',
        kind: 'info',
        title: 'Wallet disconnected'
      })
    } finally {
      setBusy(null)
    }
  }, [connectedWalletId, resetWalletConnection])

  useEffect(() => {
    void connectWallet(false)
  }, [connectWallet])

  useEffect(() => {
    const refreshWalletOptions = () => setWalletOptions(getWalletOptions())
    const refreshTimer = window.setTimeout(refreshWalletOptions, 500)

    refreshWalletOptions()
    window.addEventListener('ethereum#initialized', refreshWalletOptions, { once: true })

    return () => {
      window.clearTimeout(refreshTimer)
      window.removeEventListener('ethereum#initialized', refreshWalletOptions)
    }
  }, [])

  useEffect(() => {
    const handleHashChange = () => {
      setSelectedMarketId(getMarketIdFromHash())
      setView(getInitialView())
    }
    window.addEventListener('hashchange', handleHashChange)

    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  useEffect(() => {
    const wallet = walletOptions.find((option) => option.id === connectedWalletId)?.provider
    if (!wallet?.on) {
      return
    }

    const handleAccountsChanged = () => {
      void connectWallet(false, connectedWalletId)
    }

    const handleChainChanged = () => {
      setMarkets([])
      setPortfolioMarkets([])
      setMarketLifecycleAuthorities(null)
      setManagerCodeStatus(null)
      void connectWallet(false, connectedWalletId)
    }

    wallet.on('accountsChanged', handleAccountsChanged)
    wallet.on('chainChanged', handleChainChanged)

    return () => {
      wallet.removeListener?.('accountsChanged', handleAccountsChanged)
      wallet.removeListener?.('chainChanged', handleChainChanged)
    }
  }, [connectWallet, connectedWalletId, walletOptions])

  useEffect(() => {
    const nextHash =
      view === 'market' && selectedMarketId
        ? `#/markets/${encodeURIComponent(selectedMarketId)}`
        : view === 'markets'
        ? '#/markets'
        : view === 'portfolio'
          ? '#/portfolio'
          : view === 'protocol'
            ? '#/protocol'
            : '#/create'
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash)
    }
  }, [selectedMarketId, view])

  useEffect(() => {
    let cancelled = false

    async function checkManagerCode() {
      if (!managerIsValid) {
        setManagerCodeStatus(null)
        return
      }

      try {
        const code = await localReadProvider.getCode(checksumManagerAddress)
        if (!cancelled) {
          setManagerCodeStatus(code === '0x' ? 'empty' : 'ready')
        }
      } catch {
        if (!cancelled) {
          setManagerCodeStatus('unknown')
        }
      }
    }

    void checkManagerCode()

    return () => {
      cancelled = true
    }
  }, [checksumManagerAddress, localReadProvider, managerIsValid])

  const useEnvManagerAddress = useCallback(() => {
    if (!managerAddressEnv) {
      return
    }

    setManagerAddress(managerAddressEnv)
  }, [])

  const useEnvCollateralToken = useCallback(() => {
    if (!fakeUsdAddressEnv) {
      return
    }

    setFixedCollateralToken({
      address: fakeUsdAddressEnv,
      decimals: 18,
      symbol: fakeUsdSymbolEnv
    })
  }, [])

  const getManagerContract = useCallback(
    (runner: ReadProvider | JsonRpcSigner) => {
      if (!managerIsValid) {
        throw new Error('A valid manager address is required.')
      }

      return new Contract(checksumManagerAddress, PREGRAD_MARKET_MANAGER_ABI, runner)
    },
    [checksumManagerAddress, managerIsValid]
  )

  const deployMockToken = async () => {
    if (!signer || !account) {
      await connectWallet()
      return
    }

    setBusy('mock-token')
    setNotice({
      kind: 'pending',
      title: 'Deploying mock collateral'
    })

    try {
      const factory = new ContractFactory(MOCK_ERC20_ABI, MOCK_ERC20_BYTECODE, signer)
      const token = (await factory.deploy('PredictFun USD', 'pUSD', 18)) as MockErc20Contract
      const deployTx = token.deploymentTransaction()

      setNotice({
        detail: 'Waiting for the token deployment transaction.',
        hash: deployTx?.hash,
        kind: 'pending',
        title: 'Mock token transaction sent'
      })

      await token.waitForDeployment()
      const address = await token.getAddress()
      const mintAmount = parseUnits('1000000', 18)
      const mintTx = await token.mint(account, mintAmount)

      setNotice({
        detail: 'Minting pUSD to the connected wallet.',
        hash: mintTx.hash,
        kind: 'pending',
        title: 'Mock token deployed'
      })

      await mintTx.wait()
      setFixedCollateralToken({
        address,
        decimals: 18,
        symbol: 'pUSD'
      })
      setNotice({
        detail: `${truncateAddress(address, 10, 8)} minted ${formatDecimalString(formatUnits(mintAmount, 18))} pUSD.`,
        hash: mintTx.hash,
        kind: 'success',
        title: 'Mock collateral ready'
      })
    } catch (error) {
      setNotice({
        detail: getErrorMessage(error),
        kind: 'error',
        title: 'Mock token deployment failed'
      })
    } finally {
      setBusy(null)
    }
  }

  const mintEnvFakeUsd = async () => {
    if (!signer || !account) {
      await connectWallet()
      return
    }

    if (!fakeUsdAddressEnv || !isAddress(fakeUsdAddressEnv)) {
      setNotice({
        detail: 'Run the local stack deploy script so the fake USD address is available.',
        kind: 'error',
        title: 'Fake USD unavailable'
      })
      return
    }

    setBusy('fake-usd-faucet')

    try {
      const token = new Contract(fakeUsdAddressEnv, MOCK_ERC20_ABI, signer)
      const amount = parsePositiveAmount(fakeCollateralFaucetAmount, 18, fakeUsdSymbolEnv)
      const formattedAmount = formatDecimalString(formatUnits(amount, 18))
      const mintTx = await token.mint(account, amount)

      setNotice({
        detail: `Minting ${formattedAmount} ${fakeUsdSymbolEnv} to ${truncateAddress(account, 10, 8)}.`,
        hash: mintTx.hash,
        kind: 'pending',
        title: 'Faucet transaction sent'
      })

      await mintTx.wait()
      setFixedCollateralToken({
        address: fakeUsdAddressEnv,
        decimals: 18,
        symbol: fakeUsdSymbolEnv
      })
      setNotice({
        detail: `${formattedAmount} ${fakeUsdSymbolEnv} minted to your wallet.`,
        hash: mintTx.hash,
        kind: 'success',
        title: 'Faucet complete'
      })
      setPortfolioRefreshNonce((value) => value + 1)
    } catch (error) {
      setNotice({
        detail: getErrorMessage(error),
        kind: 'error',
        title: 'Faucet failed'
      })
    } finally {
      setBusy(null)
    }
  }

  const fundEthFaucet = async () => {
    if (!provider || !account) {
      await connectWallet()
      return
    }

    setBusy('eth-faucet')

    try {
      const amount = parsePositiveAmount(ethFaucetAmount, 18, 'ETH')
      const currentBalance = await provider.getBalance(account)
      const nextBalance = currentBalance + amount
      const nextBalanceHex = `0x${nextBalance.toString(16)}`
      const methods = ['hardhat_setBalance', 'anvil_setBalance']
      let lastError: unknown

      for (const method of methods) {
        try {
          await sendLocalDevRpc(provider, method, [account, nextBalanceHex])
          lastError = null
          break
        } catch (error) {
          lastError = error
        }
      }

      if (lastError) {
        throw lastError
      }

      setNotice({
        detail: `${formatDecimalString(formatUnits(amount, 18))} ETH added to ${truncateAddress(account, 10, 8)}.`,
        kind: 'success',
        title: 'ETH faucet complete'
      })
      setPortfolioRefreshNonce((value) => value + 1)
    } catch (error) {
      setNotice({
        detail: getErrorMessage(error),
        kind: 'error',
        title: 'ETH faucet failed'
      })
    } finally {
      setBusy(null)
    }
  }

  const createMarket = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (!signer || !provider) {
      await connectWallet()
      return
    }

    if (!managerIsValid) {
      setNotice({
        detail: 'Deploy a manager or paste a manager address first.',
        kind: 'error',
        title: 'Manager required'
      })
      return
    }

    setBusy('create-market')

    try {
      const metadata = makeMetadata(form)
      if (!metadata.question) {
        throw new Error('Market question is required.')
      }

      if (!fixedCollateralIsValid) {
        throw new Error('Configure the fixed collateral token before launching a market.')
      }

      const collateralAddress = checksumFixedCollateralAddress
      const collateralDecimals = fixedCollateralToken.decimals
      if (!Number.isInteger(collateralDecimals) || collateralDecimals < 0 || collateralDecimals > 36) {
        throw new Error('Collateral decimals must be between 0 and 36.')
      }

      const { initialQNo, initialQYes } = getInitialMarketQuantities(form)
      const marketId = normalizeMarketId(metadata.marketSeed)
      const metadataHash = hashMetadata(metadata)
      const expirationTime = parseExpirationTime(form.expirationTime)

      if (chainMismatch) {
        throw new Error(`Wallet is connected to ${chainLabel}; expected ${expectedChainLabel}.`)
      }

      if (managerCodeStatus === 'empty') {
        throw new Error('No contract code exists at the configured manager address.')
      }

      const manager = getManagerContract(signer)
      const tx = await manager.createMarket(
        marketId,
        collateralAddress,
        metadataHash,
        expirationTime,
        initialQYes,
        initialQNo
      )

      setNotice({
        detail: 'Waiting for the market creation transaction.',
        hash: tx.hash,
        kind: 'pending',
        title: 'Market transaction sent'
      })

      await tx.wait()

      setNotice({
        detail: `${metadata.question} is live as ${truncateAddress(marketId, 10, 8)}.`,
        hash: tx.hash,
        kind: 'success',
        title: 'Market launched'
      })
      setView('markets')
      setRefreshNonce((value) => value + 1)
      setForm((current) => {
        const next = {
          ...current,
          createdAt: new Date().toISOString(),
          expirationTime: toUtcMinuteStorageValue(new Date(Date.now() + defaultMarketDurationMs))
        }
        return { ...next, marketSeed: makeMarketSeed(next) }
      })
    } catch (error) {
      setNotice({
        detail: getErrorMessage(error),
        kind: 'error',
        title: 'Market launch failed'
      })
    } finally {
      setBusy(null)
    }
  }

  const readRecord = useCallback(
    async (marketId: string, source: MarketRecordSource, eventMeta?: { blockNumber?: number; txHash?: string }) => {
      const manager = getManagerContract(localReadProvider)
      const [rawState, matchedLiquidityRaw, graduationMatchedLiquidityRaw, defaultLiquidityRaw] =
        await Promise.all([
          manager.getMarket(marketId) as Promise<Record<string, unknown> & Array<unknown>>,
          manager.matchedLiquidity(marketId).catch(() => 0n),
          manager.GRADUATION_MATCHED_LIQUIDITY().catch(() => 0n),
          manager.DEFAULT_LIQUIDITY().catch(() => 0n)
        ])
      const state = readMarketState(rawState)
      const token = await readTokenInfo(localReadProvider, state.collateral)

      let spotYes: bigint | undefined
      let spotNo: bigint | undefined

      if (state.status === 1) {
        try {
          spotYes = BigInt(await manager.quoteSpotPrice(marketId, 0))
          spotNo = BigInt(await manager.quoteSpotPrice(marketId, 1))
        } catch {
          spotYes = undefined
          spotNo = undefined
        }
      }

      return {
        blockNumber: eventMeta?.blockNumber,
        createdTxHash: eventMeta?.txHash,
        defaultLiquidity: BigInt(defaultLiquidityRaw),
        graduationMatchedLiquidity: BigInt(graduationMatchedLiquidityRaw),
        matchedLiquidity: BigInt(matchedLiquidityRaw),
        marketId,
        metadata: null,
        source,
        spotNo,
        spotYes,
        state,
        token
      }
    },
    [getManagerContract, localReadProvider]
  )

  const loadMarkets = useCallback(async () => {
    if (!managerIsValid) {
      return
    }

    setMarketsLoading(true)
    setMarketsError('')

    try {
      const fromBlock = scanFromBlock.trim() ? Number(scanFromBlock) : 0
      if (!Number.isInteger(fromBlock) || fromBlock < 0) {
        throw new Error('From block must be a non-negative integer.')
      }

      const manager = getManagerContract(localReadProvider)
      const logs = await manager.queryFilter(manager.filters.MarketCreated(), fromBlock, 'latest')
      const records = await Promise.all(
        logs.filter(isEventLog).map(async (log) => {
          const marketId = String(log.args.marketId)
          return readRecord(marketId, 'event', {
            blockNumber: log.blockNumber,
            txHash: log.transactionHash
          })
        })
      )

      records.sort((left, right) => (right.blockNumber ?? 0) - (left.blockNumber ?? 0))
      setMarkets(records)
    } catch (error) {
      setMarkets([])
      setMarketsError(getErrorMessage(error))
    } finally {
      setMarketsLoading(false)
    }
  }, [getManagerContract, localReadProvider, managerIsValid, readRecord, scanFromBlock])

  const loadMarketDetail = useCallback(async () => {
    if (!managerIsValid || !selectedMarketId) {
      setMarketDetail(null)
      setMarketDetailError('')
      setMarketDetailLoading(false)
      return
    }

    setMarketDetailLoading(true)
    setMarketDetailError('')

    try {
      const marketId = normalizeMarketId(selectedMarketId)
      const record = await readRecord(marketId, 'lookup')
      setMarketDetail(record)

      if (selectedMarketId !== marketId) {
        setSelectedMarketId(marketId)
      }
    } catch (error) {
      setMarketDetailError(getErrorMessage(error))
    } finally {
      setMarketDetailLoading(false)
    }
  }, [managerIsValid, readRecord, selectedMarketId])

  const loadTradeAccount = useCallback(async () => {
    if (!provider || !account || !marketDetail) {
      setTradeAccount(null)
      setTradeAccountError('')
      setTradeAccountLoading(false)
      return
    }

    setTradeAccountLoading(true)
    setTradeAccountError('')

    try {
      const checksummedAccount = normalizeAddress(account)
      const token = new Contract(marketDetail.state.collateral, ERC20_TRADE_ABI, provider)
      const manager = getManagerContract(provider)
      const [balanceRaw, allowanceRaw, positionRaw, operationManagerRaw] = await Promise.all([
        token.balanceOf(checksummedAccount),
        token.allowance(checksummedAccount, checksumManagerAddress),
        manager.positions(marketDetail.marketId, checksummedAccount) as Promise<Record<string, unknown> & Array<unknown>>,
        manager.manager()
      ])

      setTradeAccount({
        allowance: BigInt(String(allowanceRaw)),
        balance: BigInt(String(balanceRaw)),
        operationManager: normalizeAddress(String(operationManagerRaw)),
        position: readUserPosition(positionRaw)
      })
    } catch (error) {
      setTradeAccount(null)
      setTradeAccountError(getErrorMessage(error))
    } finally {
      setTradeAccountLoading(false)
    }
  }, [account, checksumManagerAddress, getManagerContract, marketDetail, provider])

  const loadPortfolio = useCallback(async () => {
    if (!provider || !account) {
      setPortfolio(null)
      setPortfolioError('')
      setPortfolioLoading(false)
      return
    }

    setPortfolioLoading(true)
    setPortfolioError('')

    try {
      const checksummedAccount = normalizeAddress(account)
      const [ethBalance, blockNumber] = await Promise.all([
        provider.getBalance(checksummedAccount),
        provider.getBlockNumber().catch(() => undefined)
      ])
      let fakeUsdToken: TokenInfo = { decimals: 18, symbol: fakeUsdSymbolEnv }
      let fakeUsdBalance: bigint | null = null

      if (checksumFakeUsdAddress) {
        const token = new Contract(checksumFakeUsdAddress, MOCK_ERC20_ABI, provider)
        const [tokenInfo, rawFakeUsdBalance] = await Promise.all([
          readTokenInfo(provider, checksumFakeUsdAddress),
          token.balanceOf(checksummedAccount)
        ])

        fakeUsdToken = tokenInfo
        fakeUsdBalance = BigInt(String(rawFakeUsdBalance))
      }

      setPortfolio({
        account: checksummedAccount,
        blockNumber,
        ethBalance,
        fakeUsdAddress: checksumFakeUsdAddress,
        fakeUsdBalance,
        fakeUsdToken
      })
    } catch (error) {
      setPortfolioError(getErrorMessage(error))
    } finally {
      setPortfolioLoading(false)
    }
  }, [account, checksumFakeUsdAddress, provider])

  const loadPortfolioMarkets = useCallback(async () => {
    if (!account) {
      setPortfolioMarkets([])
      setPortfolioMarketsError('')
      setPortfolioMarketsLoading(false)
      setMarketLifecycleAuthorities(null)
      return
    }

    if (!managerIsValid) {
      setPortfolioMarkets([])
      setPortfolioMarketsError('Configure a valid manager to load created markets.')
      setPortfolioMarketsLoading(false)
      setMarketLifecycleAuthorities(null)
      return
    }

    setPortfolioMarketsLoading(true)
    setPortfolioMarketsError('')

    try {
      const checksummedAccount = normalizeAddress(account)
      const manager = getManagerContract(localReadProvider)
      const [operationManagerRaw, logs] = await Promise.all([
        manager.manager() as Promise<string>,
        manager.queryFilter(manager.filters.MarketCreated(null, checksummedAccount), 0, 'latest')
      ])
      const records = await Promise.all(
        logs.filter(isEventLog).map((log) =>
          readRecord(String(log.args.marketId), 'event', {
            blockNumber: log.blockNumber,
            txHash: log.transactionHash
          })
        )
      )

      records.sort((left, right) => (right.blockNumber ?? 0) - (left.blockNumber ?? 0))
      setMarketLifecycleAuthorities({
        manager: normalizeAddress(String(operationManagerRaw))
      })
      setPortfolioMarkets(records)
    } catch (error) {
      setPortfolioMarkets([])
      setPortfolioMarketsError(getErrorMessage(error))
      setMarketLifecycleAuthorities(null)
    } finally {
      setPortfolioMarketsLoading(false)
    }
  }, [account, getManagerContract, localReadProvider, managerIsValid, readRecord])

  useEffect(() => {
    if (view === 'markets') {
      void loadMarkets()
    }
  }, [loadMarkets, refreshNonce, view])

  useEffect(() => {
    if (view === 'market') {
      void loadMarketDetail()
    }
  }, [loadMarketDetail, marketDetailRefreshNonce, view])

  useEffect(() => {
    void loadTradeAccount()
  }, [loadTradeAccount, tradeAccountRefreshNonce])

  useEffect(() => {
    if (view === 'portfolio') {
      void loadPortfolio()
      void loadPortfolioMarkets()
    }
  }, [loadPortfolio, loadPortfolioMarkets, portfolioRefreshNonce, view])

  const lookupMarket = async () => {
    if (!managerIsValid) {
      setNotice({
        detail: 'Configure the manager first.',
        kind: 'error',
        title: 'Lookup unavailable'
      })
      return
    }

    setMarketsLoading(true)
    setMarketsError('')

    try {
      const marketId = normalizeMarketId(manualLookup)
      const record = await readRecord(marketId, 'lookup')
      setMarkets((current) => [record, ...current.filter((market) => market.marketId !== marketId)])
      setManualLookup('')
    } catch (error) {
      setMarketsError(getErrorMessage(error))
    } finally {
      setMarketsLoading(false)
    }
  }

  const openMarketDetail = (marketId: string) => {
    setSelectedMarketId(marketId)
    setMarketDetail(
      markets.find((market) => market.marketId === marketId) ??
      portfolioMarkets.find((market) => market.marketId === marketId) ??
      null
    )
    setMarketDetailError('')
    setTradeAmount('')
    setTradeAccount(null)
    setView('market')
  }

  const backToMarkets = () => {
    setSelectedMarketId('')
    setMarketDetail(null)
    setMarketDetailError('')
    setView('markets')
  }

  const setTradeAmountFromLimit = (percentage: bigint) => {
    if (!marketDetail || tradeSpendLimit <= 0n) {
      return
    }

    const amount = (tradeSpendLimit * percentage) / 100n
    setTradeAmount(formatInputAmount(amount, marketDetail.token.decimals))
  }

  const approveTradeCollateral = async () => {
    if (!signer || !account) {
      await connectWallet()
      return
    }

    if (!marketDetail || !tradeQuote) {
      return
    }

    setBusy('trade-approve')

    try {
      const token = new Contract(marketDetail.state.collateral, ERC20_TRADE_ABI, signer)
      const tx = await token.approve(checksumManagerAddress, tradeQuote.budget)

      setNotice({
        detail: `Approving ${formatTokenAmount(tradeQuote.budget, marketDetail.token.decimals, marketDetail.token.symbol)} for trading.`,
        hash: tx.hash,
        kind: 'pending',
        title: 'Approval transaction sent'
      })

      await tx.wait()
      setNotice({
        detail: `${marketDetail.token.symbol} allowance is ready for this order.`,
        hash: tx.hash,
        kind: 'success',
        title: 'Approval complete'
      })
      setTradeAccountRefreshNonce((value) => value + 1)
    } catch (error) {
      setNotice({
        detail: getErrorMessage(error),
        kind: 'error',
        title: 'Approval failed'
      })
    } finally {
      setBusy(null)
    }
  }

  const submitTrade = async () => {
    if (!signer || !account) {
      await connectWallet()
      return
    }

    if (!marketDetail || !tradeQuote || tradeBlockingReason) {
      return
    }

    setBusy('trade-submit')

    try {
      const manager = getManagerContract(signer)
      const payloadHash = id(
        stableStringify({
          account: checksumAccount,
          budget: tradeQuote.budget.toString(),
          marketId: marketDetail.marketId,
          side: tradeSide,
          source: 'predictfun.launcher.trade-box',
          submittedAt: new Date().toISOString()
        })
      )
      const tx = await manager.buyWithBudgetFor(
        checksumAccount,
        marketDetail.marketId,
        getSideIndex(tradeSide),
        tradeQuote.budget,
        tradeQuote.minExposureAfterSlippage,
        payloadHash
      )

      setNotice({
        detail: `Buying ${getSideLabel(tradeSide, marketDetail)} with up to ${formatTokenAmount(
          tradeQuote.budget,
          marketDetail.token.decimals,
          marketDetail.token.symbol
        )}.`,
        hash: tx.hash,
        kind: 'pending',
        title: 'Trade transaction sent'
      })

      await tx.wait()
      setNotice({
        detail: `${getSideLabel(tradeSide, marketDetail)} receipt recorded.`,
        hash: tx.hash,
        kind: 'success',
        title: 'Trade complete'
      })
      setTradeAmount('')
      setMarketDetailRefreshNonce((value) => value + 1)
      setTradeAccountRefreshNonce((value) => value + 1)
      setPortfolioRefreshNonce((value) => value + 1)
      setRefreshNonce((value) => value + 1)
    } catch (error) {
      setNotice({
        detail: getErrorMessage(error),
        kind: 'error',
        title: 'Trade failed'
      })
    } finally {
      setBusy(null)
    }
  }

  const handleTradePrimary = async () => {
    if (!account) {
      await connectWallet()
      return
    }

    if (tradeNeedsApproval) {
      await approveTradeCollateral()
      return
    }

    await submitTrade()
  }

  const getLifecycleActionBlocker = useCallback(
    (market: MarketRecord, action: MarketLifecycleAction) => {
      if (!account || !checksumAccount) {
        return 'Connect a wallet to manage created markets.'
      }

      if (!managerIsValid) {
        return 'Configure a valid manager first.'
      }

      if (chainMismatch) {
        return `Wallet is connected to ${chainLabel}; expected ${expectedChainLabel}.`
      }

      if (managerCodeStatus === 'empty') {
        return 'No contract code exists at the configured manager address.'
      }

      if (!marketLifecycleAuthorities) {
        return 'Manager roles are still loading.'
      }

      const creator = normalizeAddress(market.state.creator)
      const isOperationManager = checksumAccount === marketLifecycleAuthorities.manager
      const isCreator = checksumAccount === creator

      if (action === 'graduate') {
        if (!isOperationManager) {
          return 'Connected wallet is not the operation manager.'
        }

        return market.state.status === 1 ? '' : 'Market is not active.'
      }

      if (!isOperationManager && !isCreator) {
        return 'Connected wallet is not the market creator or operation manager.'
      }

      if (action === 'cancel') {
        return market.state.status === 1 ? '' : 'Market is not active.'
      }

      if (isResolveLifecycleAction(action)) {
        return market.state.status === 2 ? '' : 'Market is not graduated.'
      }

      return ''
    },
    [
      account,
      chainLabel,
      chainMismatch,
      checksumAccount,
      expectedChainLabel,
      managerCodeStatus,
      managerIsValid,
      marketLifecycleAuthorities
    ]
  )

  const executeMarketLifecycle = useCallback(
    async (market: MarketRecord, action: MarketLifecycleAction) => {
      if (!signer || !account) {
        await connectWallet()
        return
      }

      const blocker = getLifecycleActionBlocker(market, action)
      const label = getLifecycleActionLabel(action)
      if (blocker) {
        setNotice({
          detail: blocker,
          kind: 'error',
          title: `${label} unavailable`
        })
        return
      }

      const busyKey = getLifecycleBusyKey(action, market.marketId)
      setBusy(busyKey)

      try {
        const manager = getManagerContract(signer)
        const payloadHash = id(
          stableStringify({
            account: checksumAccount,
            action,
            marketId: market.marketId,
            matchedLiquidity: market.matchedLiquidity.toString(),
            receiptAccumulator: market.state.receiptAccumulator,
            source: 'predictfun.launcher.portfolio',
            submittedAt: new Date().toISOString(),
            totalEscrowed: market.state.totalEscrowed.toString()
          })
        )
        let tx: ContractTransactionResponse
        if (action === 'cancel') {
          tx = await manager.cancelMarket(market.marketId, payloadHash)
        } else if (action === 'graduate') {
          tx = await manager.graduateMarket(market.marketId, payloadHash)
        } else {
          tx = await manager.resolveMarket(
            market.marketId,
            action === 'resolve-yes' ? sideYes : sideNo,
            payloadHash
          )
        }

        setNotice({
          detail: `${label} submitted for ${truncateAddress(market.marketId, 10, 8)}.`,
          hash: tx.hash,
          kind: 'pending',
          title: `${label} transaction sent`
        })

        await tx.wait()

        setNotice({
          detail: `${market.metadata?.question ?? truncateAddress(market.marketId, 10, 8)} updated on-chain.`,
          hash: tx.hash,
          kind: 'success',
          title: getLifecycleSuccessTitle(action)
        })
        setPortfolioRefreshNonce((value) => value + 1)
        setRefreshNonce((value) => value + 1)
        if (selectedMarketId === market.marketId) {
          setMarketDetailRefreshNonce((value) => value + 1)
        }
      } catch (error) {
        setNotice({
          detail: getErrorMessage(error),
          kind: 'error',
          title: `${label} failed`
        })
      } finally {
        setBusy(null)
      }
    },
    [
      account,
      checksumAccount,
      connectWallet,
      getLifecycleActionBlocker,
      getManagerContract,
      selectedMarketId,
      signer
    ]
  )

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setNotice({
        detail: value,
        kind: 'success',
        title: `${label} copied`
      })
    } catch (error) {
      setNotice({
        detail: getErrorMessage(error),
        kind: 'error',
        title: 'Copy failed'
      })
    }
  }

  const renderWalletConnectButtons = (compact = false) => {
    const buttonClassName = compact ? 'primary compact wallet-option-button' : 'primary wallet-option-button'

    if (walletOptions.length === 0) {
      return (
        <button
          className={buttonClassName}
          disabled={busy === 'wallet-disconnect'}
          onClick={() => void connectWallet()}
          title="Connect wallet"
          type="button"
        >
          <Wallet aria-hidden="true" size={17} />
          <span>Connect</span>
        </button>
      )
    }

    return (
      <div className="wallet-option-group">
        {walletOptions.map((walletOption) => (
          <button
            className={buttonClassName}
            disabled={busy === 'wallet-disconnect'}
            key={walletOption.id}
            onClick={() => void connectWallet(true, walletOption.id)}
            title={`Connect ${walletOption.label}`}
            type="button"
          >
            <Wallet aria-hidden="true" size={17} />
            <span>{walletOptions.length === 1 ? `Connect ${walletOption.label}` : walletOption.label}</span>
          </button>
        ))}
      </div>
    )
  }

  const portfolioEthValue = portfolio
    ? formatTokenAmount(portfolio.ethBalance, 18, 'ETH', 6)
    : portfolioLoading
      ? 'Loading'
      : '-'
  const portfolioFakeUsdValue =
    portfolio?.fakeUsdBalance !== null && portfolio?.fakeUsdBalance !== undefined
      ? formatTokenAmount(
          portfolio.fakeUsdBalance,
          portfolio.fakeUsdToken.decimals,
          portfolio.fakeUsdToken.symbol,
          4
        )
      : checksumFakeUsdAddress
        ? portfolioLoading
          ? 'Loading'
          : '-'
        : 'Token unset'
  const portfolioFakeUsdAddressLabel = portfolio?.fakeUsdAddress
    ? truncateAddress(portfolio.fakeUsdAddress, 10, 8)
    : checksumFakeUsdAddress
      ? truncateAddress(checksumFakeUsdAddress, 10, 8)
      : 'VITE_PREGRAD_FAKE_USD_ADDRESS'
  const portfolioRefreshing = portfolioLoading || portfolioMarketsLoading
  const tradeQuote = useMemo(
    () => (marketDetail ? buildTradeQuote(marketDetail, tradeSide, tradeAmount) : null),
    [marketDetail, tradeAmount, tradeSide]
  )
  const marketTradingOpen = marketDetail
    ? marketDetail.state.status === 1 && Date.now() < Number(marketDetail.state.expirationTime) * 1000
    : false
  const tradeSpendLimit =
    tradeQuote && tradeAccount ? minBigInt(tradeAccount.balance, tradeQuote.maxCost) : tradeQuote?.maxCost ?? 0n
  const tradeNeedsApproval =
    Boolean(tradeQuote?.hasAmount && tradeAccount && tradeQuote.budget > tradeAccount.allowance)
  const tradeOperationManagerMismatch =
    Boolean(checksumAccount && tradeAccount?.operationManager && checksumAccount !== tradeAccount.operationManager)
  const tradeBlockingReason = (() => {
    if (!marketDetail || !tradeQuote) {
      return 'Market unavailable.'
    }

    if (!marketTradingOpen) {
      return marketDetail.state.status === 1 ? 'Trading is closed.' : 'Market is not active.'
    }

    if (!tradeQuote.hasAmount) {
      return 'Enter an amount.'
    }

    if (tradeQuote.error) {
      return tradeQuote.error
    }

    if (chainMismatch) {
      return `Wallet is connected to ${chainLabel}; expected ${expectedChainLabel}.`
    }

    if (managerCodeStatus === 'empty') {
      return 'No contract code exists at the configured manager address.'
    }

    if (tradeAccountLoading) {
      return 'Balances loading.'
    }

    if (!tradeAccount) {
      return account ? 'Balances unavailable.' : ''
    }

    if (tradeQuote.budget > tradeAccount.balance) {
      return `Insufficient ${marketDetail.token.symbol} balance.`
    }

    if (tradeQuote.priceImpact >= tradeMaxImpact) {
      return `Price impact is above ${formatPercentagePointChange(tradeMaxImpact)}.`
    }

    if (tradeOperationManagerMismatch) {
      return 'Connected wallet is not the operation manager.'
    }

    return ''
  })()
  const tradePrimaryDisabled = account
    ? busy !== null ||
      Boolean(tradeBlockingReason) ||
      (tradeNeedsApproval
        ? false
        : Boolean(!tradeAccount || !tradeQuote || tradeQuote.budget > tradeAccount.allowance))
    : busy === 'wallet-disconnect'
  const tradePrimaryLabel = !account
    ? 'Connect wallet'
    : tradeNeedsApproval
      ? `Approve ${marketDetail?.token.symbol ?? 'token'}`
      : `Buy ${marketDetail ? getSideLabel(tradeSide, marketDetail) : 'exposure'}`

  return (
    <div className="launcher-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <img src="/predictfun-mark.svg" alt="PredictFun" />
          <div>
            <strong>PredictFun</strong>
            <span>Market launcher</span>
          </div>
        </div>

        <nav className="view-tabs" aria-label="Market launcher pages">
          <button
            className={view === 'create' ? 'active' : ''}
            onClick={() => setView('create')}
            title="Create market"
            type="button"
          >
            <Rocket aria-hidden="true" size={17} />
            <span>Create</span>
          </button>
          <button
            className={view === 'markets' || view === 'market' ? 'active' : ''}
            onClick={() => setView('markets')}
            title="View markets"
            type="button"
          >
            <Eye aria-hidden="true" size={17} />
            <span>Markets</span>
          </button>
          <button
            className={view === 'portfolio' ? 'active' : ''}
            onClick={() => setView('portfolio')}
            title="Wallet portfolio"
            type="button"
          >
            <Coins aria-hidden="true" size={17} />
            <span>Portfolio</span>
          </button>
          <button
            className={view === 'protocol' ? 'active' : ''}
            onClick={() => setView('protocol')}
            title="Protocol setup"
            type="button"
          >
            <Cpu aria-hidden="true" size={17} />
            <span>Protocol</span>
          </button>
        </nav>

        <div className="wallet-cluster">
          <span
            aria-label={chainMismatch ? `${chainLabel}; expected ${expectedChainLabel}` : chainLabel}
            className={chainMismatch ? 'chain-pill chain-pill-mismatch' : 'chain-pill'}
            title={chainPillTitle}
          >
            {chainMismatch ? <AlertCircle aria-hidden="true" size={15} /> : null}
            <span>{chainMismatch ? `Wrong chain ${chainId}` : chainLabel}</span>
          </span>
          {account ? (
            <span className="account-pill" title={account}>
              <Wallet aria-hidden="true" size={15} />
              <span>{connectedWalletLabel} {walletLabel}</span>
            </span>
          ) : null}
          {account ? (
            <button
              className="compact danger"
              disabled={walletActionDisabled}
              onClick={() => void disconnectWallet()}
              title="Disconnect wallet"
              type="button"
            >
              {busy === 'wallet-disconnect' ? (
                <Loader2 aria-hidden="true" className="spin" size={17} />
              ) : (
                <LogOut aria-hidden="true" size={17} />
              )}
              <span>Disconnect</span>
            </button>
          ) : (
            renderWalletConnectButtons(true)
          )}
        </div>
      </header>

      <main className="launcher-main">
        {notice ? <NoticeBanner notice={notice} /> : null}

        {view === 'create' ? (
          <form className="creator-layout" onSubmit={(event) => void createMarket(event)}>
            <section className="workspace-panel">
              <div className="section-heading">
                <Rocket aria-hidden="true" size={20} />
                <h1>Create Market</h1>
              </div>

              <div className="field-stack">
                <label>
                  <span>Question</span>
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, question: event.target.value }))}
                    value={form.question}
                  />
                </label>

                <label>
                  <span>Description</span>
                  <textarea
                    onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                    rows={3}
                    value={form.description}
                  />
                </label>

                <label>
                  <span>Resolution criteria</span>
                  <textarea
                    onChange={(event) =>
                      setForm((current) => ({ ...current, resolutionCriteria: event.target.value }))
                    }
                    rows={4}
                    value={form.resolutionCriteria}
                  />
                </label>
              </div>

              <div className="field-grid two">
                <label>
                  <span>YES label</span>
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, outcomeYes: event.target.value }))}
                    value={form.outcomeYes}
                  />
                </label>
                <label>
                  <span>NO label</span>
                  <input
                    onChange={(event) => setForm((current) => ({ ...current, outcomeNo: event.target.value }))}
                    value={form.outcomeNo}
                  />
                </label>
              </div>

              <div className="field-grid two">
                <label>
                  <span>Starting YES</span>
                  <input
                    inputMode="decimal"
                    onChange={(event) =>
                      setForm((current) => applyStartingValueChange(current, 'yes', event.target.value))
                    }
                    value={form.startingYesValue}
                  />
                </label>
                <label>
                  <span>Starting NO</span>
                  <input
                    inputMode="decimal"
                    onChange={(event) =>
                      setForm((current) => applyStartingValueChange(current, 'no', event.target.value))
                    }
                    value={form.startingNoValue}
                  />
                </label>
              </div>

              <div className="field-grid expiration-grid">
                <label>
                  <span>Trading closes</span>
                  <input
                    onChange={(event) =>
                      setForm((current) => applyExpirationTimeChange(current, event.target.value))
                    }
                    type="datetime-local"
                    value={expirationInputValue}
                  />
                </label>
                <label>
                  <span>Timezone</span>
                  <select
                    onChange={(event) =>
                      setForm((current) => applyExpirationTimeZoneChange(current, event.target.value))
                    }
                    value={form.expirationTimeZone}
                  >
                    {expirationTimeZoneOptions.map((timeZone) => (
                      <option key={timeZone} value={timeZone}>
                        {formatExpirationTimeZoneOption(timeZone, expirationTimeZoneOffsetDate)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="field-stack">
                <label>
                  <span>Market seed</span>
                  <div className="input-with-action">
                    <input
                      readOnly
                      value={form.marketSeed}
                    />
                    <button
                      onClick={() => {
                        const createdAt = new Date().toISOString()
                        setForm((current) => {
                          const next = { ...current, createdAt }
                          return { ...next, marketSeed: makeMarketSeed(next) }
                        })
                      }}
                      title="Regenerate seed"
                      type="button"
                    >
                      <Hash aria-hidden="true" size={16} />
                    </button>
                  </div>
                </label>
              </div>

              <div className="submit-row">
                <button
                  className="primary"
                  disabled={busy !== null || !managerIsValid || !account || !fixedCollateralIsValid}
                  title={fixedCollateralIsValid ? 'Launch market' : 'Configure fixed collateral token'}
                  type="submit"
                >
                  {busy === 'create-market' ? <Loader2 aria-hidden="true" className="spin" size={17} /> : <Rocket aria-hidden="true" size={17} />}
                  <span>Launch market</span>
                </button>
              </div>
            </section>

            <aside className="workspace-panel preview-panel">
              <div className="section-heading">
                <Hash aria-hidden="true" size={20} />
                <h2>Commit Preview</h2>
              </div>
              <PreviewRow label="Market ID" value={preview.marketId || preview.error || 'Invalid seed'} />
              <PreviewRow label="Metadata hash" value={preview.metadataHash || 'Pending'} />
              <PreviewRow label="Fixed collateral" value={fixedCollateralLabel} />
              <PreviewRow label="Trading closes" value={expirationPreview} />
              <PreviewRow label="UTC close" value={expirationUtcPreview} />
              <PreviewRow
                label="Starting values"
                value={`${formatStartingValueDisplay(form.startingYesValue)} / ${formatStartingValueDisplay(form.startingNoValue)}`}
              />
              <div className="preview-outcomes">
                <span>{form.outcomeYes || 'YES'}</span>
                <span>{form.outcomeNo || 'NO'}</span>
              </div>
            </aside>
          </form>
        ) : view === 'portfolio' ? (
          <section className="portfolio-layout">
            <div className="portfolio-toolbar">
              <div className="section-heading">
                <Coins aria-hidden="true" size={20} />
                <h1>Portfolio</h1>
              </div>
              <div className="toolbar-controls">
                <button
                  disabled={portfolioRefreshing || !provider || !account}
                  onClick={() => setPortfolioRefreshNonce((value) => value + 1)}
                  title="Refresh portfolio"
                  type="button"
                >
                  {portfolioRefreshing ? (
                    <Loader2 aria-hidden="true" className="spin" size={16} />
                  ) : (
                    <RefreshCcw aria-hidden="true" size={16} />
                  )}
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            {!account ? (
              <div className="empty-state portfolio-empty">
                <Wallet aria-hidden="true" size={22} />
                <span>Wallet not connected</span>
                {renderWalletConnectButtons()}
              </div>
            ) : null}

            {account && portfolioError ? (
              <div className="inline-error">
                <AlertCircle aria-hidden="true" size={18} />
                <span>{portfolioError}</span>
              </div>
            ) : null}

            {account ? (
              <>
                <div className="portfolio-grid">
                  <article className="asset-card">
                    <div className="asset-card-header">
                      <Wallet aria-hidden="true" size={20} />
                      <span>ETH</span>
                    </div>
                    <strong>{portfolioEthValue}</strong>
                    <code>Native balance</code>
                  </article>

                  <article className="asset-card">
                    <div className="asset-card-header">
                      <CircleDollarSign aria-hidden="true" size={20} />
                      <span>Fake USDC</span>
                    </div>
                    <strong>{portfolioFakeUsdValue}</strong>
                    <code>{portfolioFakeUsdAddressLabel}</code>
                  </article>
                </div>

                <section className="workspace-panel portfolio-details">
                  <div className="section-heading">
                    <Wallet aria-hidden="true" size={20} />
                    <h2>Wallet</h2>
                  </div>
                  <PreviewRow label="Account" value={portfolio?.account ?? account} />
                  <PreviewRow label="Network" value={chainLabel} />
                  <PreviewRow
                    label="Fake USDC token"
                    value={portfolio?.fakeUsdAddress || checksumFakeUsdAddress || 'Unset'}
                  />
                  <PreviewRow label="Last block" value={portfolio?.blockNumber?.toString() ?? 'Pending'} />
                </section>

                <section className="workspace-panel portfolio-created-markets">
                  <div className="section-heading">
                    <Rocket aria-hidden="true" size={20} />
                    <h2>Created Markets</h2>
                  </div>

                  {portfolioMarketsError ? (
                    <div className="inline-error">
                      <AlertCircle aria-hidden="true" size={18} />
                      <span>{portfolioMarketsError}</span>
                    </div>
                  ) : null}

                  <div className="market-list">
                    {portfolioMarketsLoading && portfolioMarkets.length === 0 ? (
                      <div className="empty-state">
                        <Loader2 aria-hidden="true" className="spin" size={22} />
                        <span>Loading created markets</span>
                      </div>
                    ) : null}

                    {!portfolioMarketsLoading && portfolioMarkets.length === 0 && !portfolioMarketsError ? (
                      <div className="empty-state">
                        <Database aria-hidden="true" size={22} />
                        <span>No created markets found</span>
                      </div>
                    ) : null}

                    {portfolioMarkets.map((market) => {
                      const lifecycleActions =
                        market.state.status === 1
                          ? ([
                              { action: 'cancel', className: 'compact danger' },
                              { action: 'graduate', className: 'compact primary' }
                            ] satisfies Array<{ action: MarketLifecycleAction; className: string }>)
                          : market.state.status === 2
                            ? ([
                                { action: 'resolve-yes', className: 'compact primary' },
                                { action: 'resolve-no', className: 'compact danger' }
                              ] satisfies Array<{ action: MarketLifecycleAction; className: string }>)
                            : []

                      return (
                        <MarketCard
                          actionSlot={
                            <div className="market-lifecycle-actions">
                              {lifecycleActions.map(({ action, className }) => {
                                const blocker = getLifecycleActionBlocker(market, action)
                                const isBusy = busy === getLifecycleBusyKey(action, market.marketId)
                                const label = getLifecycleActionLabel(action)
                                const Icon =
                                  action === 'cancel'
                                    ? Ban
                                    : isResolveLifecycleAction(action)
                                      ? CheckCircle2
                                      : Flag

                                return (
                                  <button
                                    className={className}
                                    disabled={busy !== null || Boolean(blocker)}
                                    key={action}
                                    onClick={(event) => {
                                      event.stopPropagation()
                                      void executeMarketLifecycle(market, action)
                                    }}
                                    title={blocker || `${label} market`}
                                    type="button"
                                  >
                                    {isBusy ? (
                                      <Loader2 aria-hidden="true" className="spin" size={16} />
                                    ) : (
                                      <Icon aria-hidden="true" size={16} />
                                    )}
                                    <span>{label}</span>
                                  </button>
                                )
                              })}
                            </div>
                          }
                          key={`${market.marketId}-${market.source}`}
                          market={market}
                          onCopyMarketId={(marketId) => void copyText(marketId, 'Market ID')}
                          onOpen={openMarketDetail}
                        />
                      )
                    })}
                  </div>
                </section>
              </>
            ) : null}
          </section>
        ) : view === 'market' ? (
          <section className="market-page-layout">
            <div className="market-page-toolbar">
              <button
                onClick={backToMarkets}
                title="Back to markets"
                type="button"
              >
                <ArrowLeft aria-hidden="true" size={16} />
                <span>Markets</span>
              </button>
              <button
                disabled={marketDetailLoading || !managerIsValid || !selectedMarketId}
                onClick={() => void loadMarketDetail()}
                title="Refresh market"
                type="button"
              >
                {marketDetailLoading ? (
                  <Loader2 aria-hidden="true" className="spin" size={16} />
                ) : (
                  <RefreshCcw aria-hidden="true" size={16} />
                )}
                <span>Refresh</span>
              </button>
            </div>

            {marketDetailError ? (
              <div className="inline-error">
                <AlertCircle aria-hidden="true" size={18} />
                <span>{marketDetailError}</span>
              </div>
            ) : null}

            {marketDetailLoading && !marketDetail ? (
              <div className="empty-state">
                <Loader2 aria-hidden="true" className="spin" size={22} />
                <span>Loading market</span>
              </div>
            ) : null}

            {!marketDetailLoading && !marketDetail && !marketDetailError ? (
              <div className="empty-state">
                <Database aria-hidden="true" size={22} />
                <span>Market unavailable</span>
              </div>
            ) : null}

            {marketDetail ? (
              <div className="market-detail-grid">
                <article className="workspace-panel market-detail-panel">
                  <div className="market-detail-heading">
                    <span className={`status-badge status-${MARKET_STATUS_LABELS[marketDetail.state.status]?.toLowerCase() ?? 'unknown'}`}>
                      {MARKET_STATUS_LABELS[marketDetail.state.status] ?? 'Unknown'}
                    </span>
                    <h1>{marketDetail.metadata?.question ?? truncateAddress(marketDetail.marketId, 12, 10)}</h1>
                    {marketDetail.metadata?.description ? <p>{marketDetail.metadata.description}</p> : null}
                  </div>

                  <div className="outcome-price-grid">
                    <button
                      className={tradeSide === 'yes' ? 'active' : ''}
                      onClick={() => setTradeSide('yes')}
                      title={`Select ${getSideLabel('yes', marketDetail)}`}
                      type="button"
                    >
                      <span>{getSideLabel('yes', marketDetail)}</span>
                      <strong>{marketDetail.spotYes ? formatPercent(marketDetail.spotYes) : '-'}</strong>
                    </button>
                    <button
                      className={tradeSide === 'no' ? 'active' : ''}
                      onClick={() => setTradeSide('no')}
                      title={`Select ${getSideLabel('no', marketDetail)}`}
                      type="button"
                    >
                      <span>{getSideLabel('no', marketDetail)}</span>
                      <strong>{marketDetail.spotNo ? formatPercent(marketDetail.spotNo) : '-'}</strong>
                    </button>
                  </div>

                  <div className="market-metrics market-detail-metrics">
                    <Metric
                      label="Escrowed"
                      value={formatTokenAmount(
                        marketDetail.state.totalEscrowed,
                        marketDetail.token.decimals,
                        marketDetail.token.symbol
                      )}
                    />
                    <Metric
                      label="Matched"
                      value={formatTokenAmount(
                        marketDetail.matchedLiquidity,
                        marketDetail.token.decimals,
                        marketDetail.token.symbol
                      )}
                    />
                    <Metric
                      label="Target"
                      value={formatTokenAmount(
                        marketDetail.graduationMatchedLiquidity,
                        marketDetail.token.decimals,
                        marketDetail.token.symbol
                      )}
                    />
                    <Metric label="Closes" value={formatUnixTime(marketDetail.state.expirationTime)} />
                    <Metric
                      label="YES exposure"
                      value={formatTokenAmount(
                        marketDetail.state.qYes,
                        marketDetail.token.decimals,
                        getSideLabel('yes', marketDetail)
                      )}
                    />
                    <Metric
                      label="NO exposure"
                      value={formatTokenAmount(
                        marketDetail.state.qNo,
                        marketDetail.token.decimals,
                        getSideLabel('no', marketDetail)
                      )}
                    />
                  </div>

                  <div className="progress-track" aria-label="Graduation progress">
                    <span
                      style={{
                        width: `${getProgress(
                          marketDetail.matchedLiquidity,
                          marketDetail.graduationMatchedLiquidity
                        )}%`
                      }}
                    />
                  </div>

                  {marketDetail.metadata?.resolutionCriteria ? (
                    <div className="market-rules">
                      <span>Resolution</span>
                      <p>{marketDetail.metadata.resolutionCriteria}</p>
                    </div>
                  ) : null}

                  <dl className="market-details market-detail-facts">
                    <div>
                      <dt>Market ID</dt>
                      <dd>{truncateAddress(marketDetail.marketId, 10, 8)}</dd>
                    </div>
                    <div>
                      <dt>Creator</dt>
                      <dd>{truncateAddress(marketDetail.state.creator, 10, 8)}</dd>
                    </div>
                    <div>
                      <dt>Collateral</dt>
                      <dd>{truncateAddress(marketDetail.state.collateral, 10, 8)}</dd>
                    </div>
                    <div>
                      <dt>Receipts</dt>
                      <dd>{marketDetail.state.receiptCount.toString()}</dd>
                    </div>
                    <div>
                      <dt>Metadata</dt>
                      <dd>{truncateAddress(marketDetail.state.metadataHash, 10, 8)}</dd>
                    </div>
                    <div>
                      <dt>Accumulator</dt>
                      <dd>{truncateAddress(marketDetail.state.receiptAccumulator, 10, 8)}</dd>
                    </div>
                  </dl>
                </article>

                <aside className="workspace-panel trade-panel">
                  <div className="section-heading">
                    <CircleDollarSign aria-hidden="true" size={20} />
                    <h2>Trade</h2>
                  </div>

                  <div className="trade-side-toggle" role="group" aria-label="Trade outcome">
                    <button
                      className={tradeSide === 'yes' ? 'active' : ''}
                      onClick={() => setTradeSide('yes')}
                      title={`Buy ${getSideLabel('yes', marketDetail)}`}
                      type="button"
                    >
                      <span>{getSideLabel('yes', marketDetail)}</span>
                      <strong>{marketDetail.spotYes ? formatPercent(marketDetail.spotYes) : '-'}</strong>
                    </button>
                    <button
                      className={tradeSide === 'no' ? 'active' : ''}
                      onClick={() => setTradeSide('no')}
                      title={`Buy ${getSideLabel('no', marketDetail)}`}
                      type="button"
                    >
                      <span>{getSideLabel('no', marketDetail)}</span>
                      <strong>{marketDetail.spotNo ? formatPercent(marketDetail.spotNo) : '-'}</strong>
                    </button>
                  </div>

                  <label className="trade-amount-field">
                    <span>Amount</span>
                    <div className="trade-input-shell">
                      <input
                        inputMode="decimal"
                        onChange={(event) => setTradeAmount(event.target.value)}
                        placeholder="0.00"
                        value={tradeAmount}
                      />
                      <span>{marketDetail.token.symbol}</span>
                    </div>
                  </label>

                  <div className="quick-fill-row">
                    <button
                      disabled={!account || tradeSpendLimit <= 0n}
                      onClick={() => setTradeAmountFromLimit(25n)}
                      title="Use 25 percent"
                      type="button"
                    >
                      25%
                    </button>
                    <button
                      disabled={!account || tradeSpendLimit <= 0n}
                      onClick={() => setTradeAmountFromLimit(50n)}
                      title="Use 50 percent"
                      type="button"
                    >
                      50%
                    </button>
                    <button
                      disabled={!account || tradeSpendLimit <= 0n}
                      onClick={() => setTradeAmountFromLimit(100n)}
                      title="Use maximum"
                      type="button"
                    >
                      Max
                    </button>
                  </div>

                  <div className="trade-quote-table">
                    <div>
                      <span>Available</span>
                      <strong>
                        {tradeAccount
                          ? formatTokenAmount(tradeAccount.balance, marketDetail.token.decimals, marketDetail.token.symbol)
                          : tradeAccountLoading
                            ? 'Loading'
                            : account
                              ? '-'
                              : 'Connect'}
                      </strong>
                    </div>
                    <div>
                      <span>Allowance</span>
                      <strong>
                        {tradeAccount
                          ? formatTokenAmount(
                              tradeAccount.allowance,
                              marketDetail.token.decimals,
                              marketDetail.token.symbol
                            )
                          : tradeAccountLoading
                            ? 'Loading'
                            : '-'}
                      </strong>
                    </div>
                    <div>
                      <span>Est. exposure</span>
                      <strong>
                        {tradeQuote?.exposure
                          ? formatTokenAmount(
                              tradeQuote.exposure,
                              marketDetail.token.decimals,
                              getSideLabel(tradeSide, marketDetail)
                            )
                          : '-'}
                      </strong>
                    </div>
                    <div>
                      <span>Avg price</span>
                      <strong>{tradeQuote?.averagePrice ? formatPercent(tradeQuote.averagePrice) : '-'}</strong>
                    </div>
                    <div className={tradeQuote && tradeQuote.priceImpact >= tradeWarningImpact ? 'impact-warn' : ''}>
                      <span>Price impact</span>
                      <strong>
                        {tradeQuote?.hasAmount && !tradeQuote.error
                          ? formatPercentagePointChange(tradeQuote.priceImpact)
                          : '-'}
                      </strong>
                    </div>
                    <div>
                      <span>New price</span>
                      <strong>
                        {tradeQuote?.hasAmount && !tradeQuote.error ? formatPercent(tradeQuote.priceAfter) : '-'}
                      </strong>
                    </div>
                    <div>
                      <span>Min exposure</span>
                      <strong>
                        {tradeQuote?.minExposureAfterSlippage
                          ? formatTokenAmount(
                              tradeQuote.minExposureAfterSlippage,
                              marketDetail.token.decimals,
                              getSideLabel(tradeSide, marketDetail)
                            )
                          : '-'}
                      </strong>
                    </div>
                    <div>
                      <span>Position</span>
                      <strong>
                        {tradeAccount
                          ? formatTokenAmount(
                              tradeSide === 'yes'
                                ? tradeAccount.position.yesExposure
                                : tradeAccount.position.noExposure,
                              marketDetail.token.decimals,
                              getSideLabel(tradeSide, marketDetail)
                            )
                          : '-'}
                      </strong>
                    </div>
                  </div>

                  {tradeAccountError ? (
                    <div className="inline-error trade-inline-message">
                      <AlertCircle aria-hidden="true" size={16} />
                      <span>{tradeAccountError}</span>
                    </div>
                  ) : null}

                  {tradeQuote?.warning && !tradeBlockingReason ? (
                    <div className="status-line warn trade-inline-message">
                      <AlertCircle aria-hidden="true" size={15} />
                      <span>{tradeQuote.warning}</span>
                    </div>
                  ) : null}

                  {account && tradeBlockingReason ? (
                    <div className="status-line muted trade-inline-message">
                      <AlertCircle aria-hidden="true" size={15} />
                      <span>{tradeBlockingReason}</span>
                    </div>
                  ) : null}

                  <button
                    className="primary trade-submit-button"
                    disabled={tradePrimaryDisabled}
                    onClick={() => void handleTradePrimary()}
                    title={tradePrimaryLabel}
                    type="button"
                  >
                    {busy === 'trade-submit' || busy === 'trade-approve' ? (
                      <Loader2 aria-hidden="true" className="spin" size={17} />
                    ) : tradeNeedsApproval ? (
                      <CheckCircle2 aria-hidden="true" size={17} />
                    ) : (
                      <CircleDollarSign aria-hidden="true" size={17} />
                    )}
                    <span>{tradePrimaryLabel}</span>
                  </button>
                </aside>
              </div>
            ) : null}
          </section>
        ) : view === 'markets' ? (
          <section className="markets-layout">
            <div className="markets-toolbar">
              <div className="section-heading">
                <Eye aria-hidden="true" size={20} />
                <h1>Markets</h1>
              </div>
              <div className="toolbar-controls">
                <label>
                  <span>From block</span>
                  <input
                    inputMode="numeric"
                    onChange={(event) => setScanFromBlock(event.target.value)}
                    value={scanFromBlock}
                  />
                </label>
                <button
                  disabled={marketsLoading || !managerIsValid}
                  onClick={() => void loadMarkets()}
                  title="Refresh markets"
                  type="button"
                >
                  {marketsLoading ? <Loader2 aria-hidden="true" className="spin" size={16} /> : <RefreshCcw aria-hidden="true" size={16} />}
                  <span>Refresh</span>
                </button>
              </div>
            </div>

            <div className="manual-lookup">
              <input
                onChange={(event) => setManualLookup(event.target.value)}
                placeholder="Market ID or seed"
                value={manualLookup}
              />
              <button
                disabled={marketsLoading || !manualLookup.trim() || !managerIsValid}
                onClick={() => void lookupMarket()}
                title="Find market"
                type="button"
              >
                <Search aria-hidden="true" size={16} />
                <span>Find</span>
              </button>
            </div>

            {marketsError ? (
              <div className="inline-error">
                <AlertCircle aria-hidden="true" size={18} />
                <span>{marketsError}</span>
              </div>
            ) : null}

            <div className="market-list">
              {marketsLoading && markets.length === 0 ? (
                <div className="empty-state">
                  <Loader2 aria-hidden="true" className="spin" size={22} />
                  <span>Loading markets</span>
                </div>
              ) : null}

              {!marketsLoading && markets.length === 0 ? (
                <div className="empty-state">
                  <Database aria-hidden="true" size={22} />
                  <span>No markets found</span>
                </div>
              ) : null}

              {markets.map((market) => (
                <MarketCard
                  key={`${market.marketId}-${market.source}`}
                  market={market}
                  onCopyMarketId={(marketId) => void copyText(marketId, 'Market ID')}
                  onOpen={openMarketDetail}
                />
              ))}
            </div>
          </section>
        ) : (
          <section className="protocol-layout">
            <div className="workspace-panel protocol-panel protocol-panel-wide">
              <div className="section-heading">
                <Server aria-hidden="true" size={20} />
                <h1>Protocol</h1>
              </div>

              <div className="protocol-status-grid">
                <PreviewRow label="Manager" value={checksumManagerAddress || 'Unset'} />
                <PreviewRow label="CREATE3 factory" value={create3FactoryAddressEnv || 'Unset'} />
                <PreviewRow label="Manager salt" value={managerCreate3SaltEnv || 'Unset'} />
                <PreviewRow label="Fake USD" value={fakeUsdAddressEnv || 'Unset'} />
                <PreviewRow label="Fake USD salt" value={fakeUsdCreate3SaltEnv || 'Unset'} />
              </div>

              <div className="field-stack protocol-manager-control">
                <label>
                  <span>Manager contract address</span>
                  <input
                    autoComplete="off"
                    onChange={(event) => setManagerAddress(event.target.value)}
                    placeholder={managerAddressEnv || '0x...'}
                    value={managerAddress}
                  />
                </label>
                <div className="button-row">
                  <button
                    disabled={!managerAddressEnv}
                    onClick={useEnvManagerAddress}
                    title="Reset to manager from env"
                    type="button"
                  >
                    <RefreshCcw aria-hidden="true" size={16} />
                    <span>Reset</span>
                  </button>
                  <button
                    disabled={!checksumManagerAddress}
                    onClick={() => void copyText(checksumManagerAddress, 'Manager address')}
                    title="Copy manager address"
                    type="button"
                  >
                    <Copy aria-hidden="true" size={16} />
                    <span>Copy</span>
                  </button>
                </div>
                <StatusLine status={managerCodeStatus} valid={managerIsValid} />
              </div>
            </div>

            <div className="workspace-panel protocol-panel">
              <div className="section-heading">
                <Coins aria-hidden="true" size={20} />
                <h2>Collateral</h2>
              </div>
              <PreviewRow label="Market token" value={fixedCollateralLabel} />
              <PreviewRow label="Env token" value={checksumFakeUsdAddress || 'Unset'} />
              <div className="button-row">
                <button
                  disabled={!fakeUsdAddressEnv}
                  onClick={useEnvCollateralToken}
                  title="Use fake USD from env"
                  type="button"
                >
                  <RefreshCcw aria-hidden="true" size={16} />
                  <span>Use env token</span>
                </button>
                <button
                  disabled={busy !== null}
                  onClick={() => void deployMockToken()}
                  title="Deploy mock collateral"
                  type="button"
                >
                  {busy === 'mock-token' ? <Loader2 aria-hidden="true" className="spin" size={16} /> : <CircleDollarSign aria-hidden="true" size={16} />}
                  <span>Deploy and mint</span>
                </button>
              </div>
            </div>

            <div className="workspace-panel protocol-panel">
              <div className="section-heading">
                <CircleDollarSign aria-hidden="true" size={20} />
                <h2>Faucets</h2>
              </div>
              <div className="faucet-grid">
                <label>
                  <span>Fake collateral</span>
                  <input
                    inputMode="decimal"
                    onChange={(event) => setFakeCollateralFaucetAmount(event.target.value)}
                    value={fakeCollateralFaucetAmount}
                  />
                </label>
                <button
                  disabled={busy !== null || !fakeUsdAddressEnv}
                  onClick={() => void mintEnvFakeUsd()}
                  title="Mint fake USD to wallet"
                  type="button"
                >
                  {busy === 'fake-usd-faucet' ? <Loader2 aria-hidden="true" className="spin" size={16} /> : <CircleDollarSign aria-hidden="true" size={16} />}
                  <span>Mint {fakeUsdSymbolEnv}</span>
                </button>
                <label>
                  <span>ETH</span>
                  <input
                    inputMode="decimal"
                    onChange={(event) => setEthFaucetAmount(event.target.value)}
                    value={ethFaucetAmount}
                  />
                </label>
                <button
                  disabled={busy !== null}
                  onClick={() => void fundEthFaucet()}
                  title="Fund wallet with local ETH"
                  type="button"
                >
                  {busy === 'eth-faucet' ? <Loader2 aria-hidden="true" className="spin" size={16} /> : <Wallet aria-hidden="true" size={16} />}
                  <span>Fund ETH</span>
                </button>
              </div>
            </div>

            <div className="workspace-panel protocol-panel">
              <div className="section-heading">
                <Wallet aria-hidden="true" size={20} />
                <h2>Wallet</h2>
              </div>
              <PreviewRow label="Account" value={account || 'Not connected'} />
              <PreviewRow label="Network" value={chainLabel} />
              <PreviewRow label="Expected network" value={expectedChainLabel} />
              <PreviewRow
                label="Wallet"
                value={
                  account
                    ? connectedWalletLabel
                    : walletOptions.map((walletOption) => walletOption.label).join(' / ') || 'Not detected'
                }
              />
              {account ? (
                <button
                  className="danger"
                  disabled={walletActionDisabled}
                  onClick={() => void disconnectWallet()}
                  title="Disconnect wallet"
                  type="button"
                >
                  {busy === 'wallet-disconnect' ? (
                    <Loader2 aria-hidden="true" className="spin" size={17} />
                  ) : (
                    <LogOut aria-hidden="true" size={17} />
                  )}
                  <span>Disconnect wallet</span>
                </button>
              ) : (
                renderWalletConnectButtons()
              )}
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function MarketCard({
  actionSlot,
  market,
  onCopyMarketId,
  onOpen
}: {
  actionSlot?: ReactNode
  market: MarketRecord
  onCopyMarketId: (marketId: string) => void
  onOpen: (marketId: string) => void
}) {
  const statusLabel = MARKET_STATUS_LABELS[market.state.status] ?? 'Unknown'

  return (
    <article
      className="market-card market-card-clickable"
      onClick={() => onOpen(market.marketId)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen(market.marketId)
        }
      }}
      role="button"
      tabIndex={0}
    >
      <div className="market-card-header">
        <div>
          <span className={`status-badge status-${statusLabel.toLowerCase()}`}>
            {statusLabel}
          </span>
          <h2>{market.metadata?.question ?? truncateAddress(market.marketId, 12, 10)}</h2>
        </div>
        <div
          className="market-card-actions"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {actionSlot}
          <button
            onClick={() => onCopyMarketId(market.marketId)}
            title="Copy market ID"
            type="button"
          >
            <Copy aria-hidden="true" size={16} />
          </button>
        </div>
      </div>

      {market.metadata?.description ? <p>{market.metadata.description}</p> : null}

      <div className="market-metrics">
        <Metric
          label="Escrowed"
          value={formatTokenAmount(market.state.totalEscrowed, market.token.decimals, market.token.symbol)}
        />
        <Metric
          label="Matched"
          value={formatTokenAmount(market.matchedLiquidity, market.token.decimals, market.token.symbol)}
        />
        <Metric
          label="Target"
          value={formatTokenAmount(market.graduationMatchedLiquidity, market.token.decimals, market.token.symbol)}
        />
        <Metric label="Closes" value={formatUnixTime(market.state.expirationTime)} />
        <Metric
          label="YES exposure"
          value={formatTokenAmount(
            market.state.qYes,
            market.token.decimals,
            market.metadata?.outcomeYes ?? 'YES'
          )}
        />
        <Metric
          label="NO exposure"
          value={formatTokenAmount(
            market.state.qNo,
            market.token.decimals,
            market.metadata?.outcomeNo ?? 'NO'
          )}
        />
        <Metric label="YES price" value={market.spotYes ? formatPercent(market.spotYes) : '-'} />
        <Metric label="NO price" value={market.spotNo ? formatPercent(market.spotNo) : '-'} />
      </div>

      <div className="progress-track" aria-label="Graduation progress">
        <span
          style={{
            width: `${getProgress(market.matchedLiquidity, market.graduationMatchedLiquidity)}%`
          }}
        />
      </div>

      <dl className="market-details">
        <div>
          <dt>Creator</dt>
          <dd>{truncateAddress(market.state.creator, 10, 8)}</dd>
        </div>
        <div>
          <dt>Collateral</dt>
          <dd>{truncateAddress(market.state.collateral, 10, 8)}</dd>
        </div>
        <div>
          <dt>Receipts</dt>
          <dd>{market.state.receiptCount.toString()}</dd>
        </div>
        <div>
          <dt>Trading closes</dt>
          <dd>{formatUnixTime(market.state.expirationTime)}</dd>
        </div>
        <div>
          <dt>Block</dt>
          <dd>{market.blockNumber ?? 'Lookup'}</dd>
        </div>
        <div>
          <dt>Metadata</dt>
          <dd>{truncateAddress(market.state.metadataHash, 10, 8)}</dd>
        </div>
        <div>
          <dt>Accumulator</dt>
          <dd>{truncateAddress(market.state.receiptAccumulator, 10, 8)}</dd>
        </div>
      </dl>
    </article>
  )
}

function StatusLine({
  status,
  valid
}: {
  status: 'empty' | 'ready' | 'unknown' | null
  valid: boolean
}) {
  if (!valid) {
    return (
      <div className="status-line muted">
        <AlertCircle aria-hidden="true" size={15} />
        <span>Manager unset</span>
      </div>
    )
  }

  if (status === 'ready') {
    return (
      <div className="status-line ok">
        <CheckCircle2 aria-hidden="true" size={15} />
        <span>Contract detected</span>
      </div>
    )
  }

  if (status === 'empty') {
    return (
      <div className="status-line warn">
        <AlertCircle aria-hidden="true" size={15} />
        <span>No code at address</span>
      </div>
    )
  }

  return (
    <div className="status-line muted">
      <Loader2 aria-hidden="true" className="spin" size={15} />
      <span>Checking manager</span>
    </div>
  )
}

function NoticeBanner({ notice }: { notice: Notice }) {
  const Icon = notice.kind === 'error' ? AlertCircle : notice.kind === 'success' ? CheckCircle2 : Loader2

  return (
    <section className={`notice notice-${notice.kind}`} aria-live="polite">
      <Icon aria-hidden="true" className={notice.kind === 'pending' ? 'spin' : ''} size={18} />
      <div>
        <strong>{notice.title}</strong>
        {notice.detail ? <span>{notice.detail}</span> : null}
        {notice.hash ? <code>{truncateAddress(notice.hash, 12, 10)}</code> : null}
      </div>
    </section>
  )
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="preview-row">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default App
