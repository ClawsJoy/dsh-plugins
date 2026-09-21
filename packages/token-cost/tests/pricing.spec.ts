/**
 * Unit tests for token pricing.
 *
 * Negative controls: unpriced buckets are flagged rather than silently free, and
 * bogus rates fall back to the defaults instead of producing NaN costs.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRICING, UNITS_PER_YUAN, costOf, formatYuan, resolvePricing } from '../src/pricing.ts'

describe('costOf', () => {
  it('matches the shipped defaults for a known usage', () => {
    // 1K input @0.001 + 1K output @0.002 + 1K reasoning @0.004 = 0.007¥ = 70 units
    const { units, fullyPriced } = costOf({ inputTokens: 1000, outputTokens: 1000, reasoningTokens: 1000 })
    expect(units).toBe(70)
    // No cache reads were reported, so nothing was left unpriced.
    expect(fullyPriced).toBe(true)
  })

  it('scales with the configured rates', () => {
    const doubled = costOf({ inputTokens: 1000 }, { ...DEFAULT_PRICING, input: 0.002 })
    expect(doubled.units).toBe(20)
  })

  it('negative control: tokens in an unpriced bucket are reported, not silently free', () => {
    const result = costOf({ cacheReadTokens: 5000 }, { ...DEFAULT_PRICING, cachedInput: 0 })
    expect(result.units).toBe(0)
    expect(result.fullyPriced).toBe(false)
    const priced = costOf({ cacheReadTokens: 5000 }, { ...DEFAULT_PRICING, cachedInput: 0.0001 })
    expect(priced.units).toBe(5)
  })

  it('is zero for zero/absent usage', () => {
    expect(costOf(undefined).units).toBe(0)
    expect(costOf({ inputTokens: 0 }).units).toBe(0)
    expect(costOf({ inputTokens: Number.NaN }).units).toBe(0)
  })
})

describe('resolvePricing', () => {
  it('falls back per field on bogus rates', () => {
    const resolved = resolvePricing({ input: -1, output: Number.NaN, reasoning: 0 })
    expect(resolved.input).toBe(DEFAULT_PRICING.input)
    expect(resolved.output).toBe(DEFAULT_PRICING.output)
    expect(resolved.reasoning).toBe(0)
  })
})

describe('formatYuan', () => {
  it('renders units as ¥ with four decimals', () => {
    expect(formatYuan(UNITS_PER_YUAN)).toBe('1.0000')
    expect(formatYuan(70)).toBe('0.0070')
  })
})
