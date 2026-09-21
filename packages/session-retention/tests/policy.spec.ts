/**
 * Unit tests for the retention policy.
 *
 * The negative control is the point: the upstream default (50 MiB) would rotate
 * a 65 MiB log — the very log size we repaired by hand — while this plugin's
 * resolved cap does not.
 */
import { describe, expect, it } from 'vitest'
import {
  BASE_DEFAULT_MAX_LOG_BYTES,
  UNLIMITED_LOG_BYTES,
  baseDefaultWouldRotate,
  resolveRetention,
  withSafeRetention,
} from '../src/policy.ts'

const SIXTY_FIVE_MIB = 65 * 1024 * 1024

describe('resolveRetention', () => {
  it('defaults to effectively unlimited and marks it as a default', () => {
    const decision = resolveRetention({ root: '/sessions' })
    expect(decision.maxLogBytes).toBe(UNLIMITED_LOG_BYTES)
    expect(decision.truncationOptIn).toBe(false)
    expect(decision.reason).toContain('seq gap')
  })

  it('honours an explicit cap and marks it as opt-in', () => {
    const decision = resolveRetention({ maxLogBytes: 200 * 1024 * 1024 })
    expect(decision.maxLogBytes).toBe(200 * 1024 * 1024)
    expect(decision.truncationOptIn).toBe(true)
  })

  it('ignores nonsense caps instead of silently truncating', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const decision = resolveRetention({ maxLogBytes: bad })
      expect(decision.maxLogBytes).toBe(UNLIMITED_LOG_BYTES)
      expect(decision.truncationOptIn).toBe(false)
    }
  })

  it('negative control: the upstream default would rotate our repaired log, ours does not', () => {
    expect(baseDefaultWouldRotate(SIXTY_FIVE_MIB)).toBe(true)
    const ours = resolveRetention({ root: '/sessions' })
    expect(SIXTY_FIVE_MIB > ours.maxLogBytes).toBe(false)
    expect(BASE_DEFAULT_MAX_LOG_BYTES).toBe(50 * 1024 * 1024)
  })
})

describe('withSafeRetention', () => {
  it('does not mutate the caller config and keeps the rest of it', () => {
    const input = { root: '/sessions', maxSessionsPerProject: 50 }
    const out = withSafeRetention(input)
    expect(out.root).toBe('/sessions')
    expect(out.maxSessionsPerProject).toBe(50)
    expect(out.maxLogBytes).toBe(UNLIMITED_LOG_BYTES)
    expect('maxLogBytes' in input).toBe(false)
  })
})
