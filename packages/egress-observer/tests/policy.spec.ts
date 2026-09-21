/**
 * Unit tests for setting resolution and the record predicate.
 *
 * Negative controls: a non-Linux platform or `enabled: false` starts nothing,
 * and `attributed` mode never records an ownerless connection.
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_INTERVAL_MS, resolveSettings, shouldRecord } from '../src/policy.ts'

describe('resolveSettings', () => {
  it('falls back on a bad interval and builds the sink from the home', () => {
    const settings = resolveSettings({ intervalMs: 1, sink: '' }, { home: '/home/u/.dsh' })
    expect(settings.intervalMs).toBe(DEFAULT_INTERVAL_MS)
    expect(settings.sink).toBe('/home/u/.dsh/logs/dsh-egress.jsonl')
    expect(settings.mode).toBe('attributed')
  })

  it('accepts an explicit sink and mode', () => {
    const settings = resolveSettings({ intervalMs: 250, sink: '/tmp/e.jsonl', mode: 'all' }, { home: '/x' })
    expect(settings.intervalMs).toBe(250)
    expect(settings.sink).toBe('/tmp/e.jsonl')
    expect(settings.mode).toBe('all')
  })

  it('negative control: enabled:false disables the sampler', () => {
    expect(resolveSettings({ enabled: false }, { home: '/x' }).enabled).toBe(false)
  })
})

describe('shouldRecord', () => {
  it('attributed mode needs a call id', () => {
    expect(shouldRecord('attributed', { callId: 'c' })).toBe(true)
    expect(shouldRecord('attributed', {})).toBe(false)
    expect(shouldRecord('attributed', { callId: '' })).toBe(false)
  })

  it('all mode records ownerless connections too', () => {
    expect(shouldRecord('all', {})).toBe(true)
  })
})
