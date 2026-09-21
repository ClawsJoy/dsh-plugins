/**
 * Unit tests for the /proc observation primitives.
 *
 * Negative controls: malformed /proc lines are skipped rather than guessed at,
 * and a child without DSH_TOOL_CALL_ID is never attributed.
 */
import { describe, expect, it } from 'vitest'
import {
  attributionFromEnviron, dedupeRecords, hexToIpv4, hexToIpv6, parseAddressPair, parseProcNet,
  recordKey, socketInodesFromTargets,
} from '../src/sockets.ts'

const V4 = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345 1 0000000000000000 100 0 0 10 0',
  '   1: 0100007F:C350 5DB8D822:01BB 01 00000000:00000000 00:00000000 00000000  1000        0 67890 1 0000000000000000 20 4 30 10 -1',
  'garbage line without enough fields',
].join('\n')

describe('hex decoding', () => {
  it('decodes little-endian IPv4', () => {
    expect(hexToIpv4('0100007F')).toBe('127.0.0.1')
    expect(hexToIpv4('5DB8D822')).toBe('34.216.184.93')
    expect(hexToIpv4('nope')).toBeUndefined()
  })

  it('decodes IPv6 with zero compression', () => {
    // /proc/net/tcp6 writes ::1 as four little-endian 32-bit words.
    expect(hexToIpv6('00000000000000000000000001000000')).toBe('::1')
    expect(hexToIpv6('short')).toBeUndefined()
  })

  it('parses address pairs and rejects junk', () => {
    expect(parseAddressPair('0100007F:1F90', 'v4')).toEqual({ ip: '127.0.0.1', port: 8080 })
    expect(parseAddressPair('zz:1F90', 'v4')).toBeUndefined()
  })
})

describe('parseProcNet', () => {
  it('keeps valid rows and skips malformed ones', () => {
    const entries = parseProcNet(V4, 'v4')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ inode: '12345', local: '127.0.0.1:8080', remote: '0.0.0.0:0', state: 'LISTEN' })
    expect(entries[1]).toMatchObject({ inode: '67890', remote: '34.216.184.93:443', state: 'ESTABLISHED' })
  })
})

describe('socketInodesFromTargets', () => {
  it('extracts socket inodes and ignores everything else', () => {
    expect(socketInodesFromTargets(['socket:[12345]', '/dev/null', 'pipe:[7]', 'socket:[9]'])).toEqual(['12345', '9'])
  })
})

describe('attributionFromEnviron', () => {
  it('reads the trusted attribution variables', () => {
    const blob = ['PATH=/usr/bin', 'DSH_TOOL_CALL_ID=call_00_x', 'DSH_TOOL_NAME=bash', ''].join('\u0000')
    expect(attributionFromEnviron(blob)).toEqual({ callId: 'call_00_x', toolName: 'bash' })
  })

  it('negative control: an un-attributed child yields no call id', () => {
    expect(attributionFromEnviron('PATH=/usr/bin\u0000HOME=/root\u0000')).toEqual({})
  })
})

describe('dedupeRecords', () => {
  it('writes a steady connection once', () => {
    const record = { callId: 'c', pid: 1, remote: '34.216.184.93:443', state: 'ESTABLISHED' }
    const fresh = dedupeRecords([record, record], new Set())
    expect(fresh).toHaveLength(1)
    const seen = new Set([recordKey(record)])
    expect(dedupeRecords([record], seen)).toHaveLength(0)
  })
})
