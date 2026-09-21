/**
 * Token→cost conversion with configurable pricing, as pure functions.
 *
 * The local patch this replaces hard-coded DeepSeek's shared-key rates and an
 * integer unit of 1/10000 ¥ (the projection field was named `costYuanWan`).
 * Hard-coded prices rot: they change, and a self-hoster may be on different
 * rates. Here the table is configuration with the same defaults, the unit is
 * explicit, and an unpriced bucket is reported rather than silently costed as
 * zero.
 *
 * @module
 */

/** Integer units per 1 ¥: 1 unit = 1/10000 ¥ (the historical `costYuanWan`). */
export const UNITS_PER_YUAN = 10_000

/** Prices are ¥ per 1000 tokens. */
export interface TokenPricing {
  readonly input: number
  readonly output: number
  readonly reasoning: number
  /** Cached-input reads are usually cheaper; 0 means "not separately priced". */
  readonly cachedInput: number
}

/** The defaults this plugin ships (¥/1K, shared-key DeepSeek rates as of 2026-09). */
export const DEFAULT_PRICING: TokenPricing = {
  input: 0.001,
  output: 0.002,
  reasoning: 0.004,
  cachedInput: 0,
}

export interface TokenUsageLike {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly reasoningTokens?: number
  readonly cacheReadTokens?: number
}

export interface CostResult {
  /** Total in 1/10000 ¥ units. */
  readonly units: number
  /** False when at least one token bucket had no price (the total is a floor). */
  readonly fullyPriced: boolean
}

/** Merge a partial config over the defaults, rejecting non-finite/negative rates. */
export function resolvePricing(partial?: Partial<TokenPricing> | undefined): TokenPricing {
  const pick = (value: number | undefined, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
  return {
    input: pick(partial?.input, DEFAULT_PRICING.input),
    output: pick(partial?.output, DEFAULT_PRICING.output),
    reasoning: pick(partial?.reasoning, DEFAULT_PRICING.reasoning),
    cachedInput: pick(partial?.cachedInput, DEFAULT_PRICING.cachedInput),
  }
}

/** Cost in 1/10000 ¥ units, rounded half-up per bucket so totals stay integral. */
export function costOf(usage: TokenUsageLike | undefined, pricing: TokenPricing = DEFAULT_PRICING): CostResult {
  const buckets: readonly (readonly [number, number])[] = [
    [usage?.inputTokens ?? 0, pricing.input],
    [usage?.outputTokens ?? 0, pricing.output],
    [usage?.reasoningTokens ?? 0, pricing.reasoning],
    [usage?.cacheReadTokens ?? 0, pricing.cachedInput],
  ]
  let units = 0
  let fullyPriced = true
  for (const [tokens, rate] of buckets) {
    if (!Number.isFinite(tokens) || tokens <= 0) continue
    if (rate <= 0) {
      // A bucket with tokens but no price is not "free": report it as unpriced.
      if (rate === 0) fullyPriced = false
      continue
    }
    units += Math.round((tokens / 1000) * rate * UNITS_PER_YUAN)
  }
  return { units, fullyPriced }
}

/** Render units as a fixed-point ¥ string (display helper, no locale surprises). */
export function formatYuan(units: number): string {
  return (units / UNITS_PER_YUAN).toFixed(4)
}
