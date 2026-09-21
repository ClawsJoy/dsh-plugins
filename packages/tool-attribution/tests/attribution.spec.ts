/**
 * Unit tests for tool attribution.
 *
 * The negative control is the point: without a call id (or with a poisoned one)
 * **no** environment variable is produced, so a downstream observer can never
 * mis-attribute a connection to the wrong tool call.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_VALUE_LENGTH,
  TOOL_CALL_ID_KEY,
  TOOL_NAME_KEY,
  attribute,
  attributionOf,
  attributionVariables,
  sanitizeValue,
} from '../src/attribution.ts'

describe('sanitizeValue', () => {
  it('trims and keeps ordinary values', () => {
    expect(sanitizeValue('  bash  ')).toBe('bash')
  })

  it('rejects empty, oversized, and control-character values', () => {
    expect(sanitizeValue('')).toBeUndefined()
    expect(sanitizeValue('   ')).toBeUndefined()
    expect(sanitizeValue(undefined)).toBeUndefined()
    expect(sanitizeValue(42)).toBeUndefined()
    expect(sanitizeValue('a'.repeat(MAX_VALUE_LENGTH + 1))).toBeUndefined()
    expect(sanitizeValue('bad\u0000value')).toBeUndefined()
    expect(sanitizeValue('line\nbreak')).toBeUndefined()
  })
})

describe('attribute', () => {
  it('publishes both keys for a normal execution', () => {
    expect(attribute({ callId: 'call_00_abc', name: 'bash', rootCallId: 'call_00_abc' })).toEqual({
      [TOOL_CALL_ID_KEY]: 'call_00_abc',
      [TOOL_NAME_KEY]: 'bash',
    })
  })

  it('negative control: no call id or no name yields an empty overlay', () => {
    expect(attribute({ name: 'bash' })).toEqual({})
    expect(attribute({ callId: 'call_00_abc' })).toEqual({})
    expect(attribute(undefined)).toEqual({})
    expect(attribute({ callId: '   ', name: 'bash' })).toEqual({})
  })

  it('never publishes an undeclared key', () => {
    const declared = Object.keys(attributionVariables())
    for (const key of Object.keys(attribute({ callId: 'c', name: 'bash' }))) {
      expect(declared).toContain(key)
    }
  })
})

describe('attributionOf', () => {
  it('keeps rootCallId only when it is usable', () => {
    expect(attributionOf({ callId: 'c', name: 'bash', rootCallId: 'r' })).toEqual({ toolCallId: 'c', toolName: 'bash', rootCallId: 'r' })
    expect(attributionOf({ callId: 'c', name: 'bash', rootCallId: '' })).toEqual({ toolCallId: 'c', toolName: 'bash' })
  })
})
