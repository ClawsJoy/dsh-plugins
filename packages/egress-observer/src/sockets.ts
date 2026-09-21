/**
 * Linux-only egress observation primitives, as pure functions over /proc text.
 *
 * Why Linux /proc and not a hook: the upstream seam (`ctx.subprocess.spawn`)
 * exposes no pid and no socket events, so a plugin cannot see a child's
 * connections from inside the process it spawns. What a plugin *can* do is ask
 * the kernel what the attributed pids are doing, which keeps the observation
 * layer outside the child's critical path (record-only) and outside the host's
 * internals (no fork of `subprocess-local`).
 *
 * Everything here is a pure function over text/strings so it is unit-testable
 * without root, without a live child, and without a cordis context.
 *
 * @module
 */

export interface SocketEntry {
  /** Hex inode shared by /proc/net/tcp and /proc/<pid>/fd. */
  readonly inode: string
  /** '127.0.0.1:54321' */
  readonly local: string
  /** '93.184.216.34:443' */
  readonly remote: string
  /** TCP state name when known (ESTABLISHED/SYN_SENT/...), else the raw hex. */
  readonly state: string
}

const TCP_STATES: Record<string, string> = {
  '01': 'ESTABLISHED', '02': 'SYN_SENT', '03': 'SYN_RECV', '04': 'FIN_WAIT1', '05': 'FIN_WAIT2',
  '06': 'TIME_WAIT', '07': 'CLOSE', '08': 'CLOSE_WAIT', '09': 'LAST_ACK', '0A': 'LISTEN', '0B': 'CLOSING',
}

/** Little-endian hex IPv4 (as /proc/net/tcp writes it) to dotted quad. */
export function hexToIpv4(hex: string): string | undefined {
  if (!/^[0-9A-Fa-f]{8}$/.test(hex)) return undefined
  const bytes = [hex.slice(6, 8), hex.slice(4, 6), hex.slice(2, 4), hex.slice(0, 2)]
  return bytes.map(b => String(parseInt(b, 16))).join('.')
}

/**
 * 32 hex chars (4 little-endian 32-bit words, the /proc/net/tcp6 form) to a
 * compressed IPv6 string. Each word is byte-reversed and split into the two
 * 16-bit groups it represents.
 */
export function hexToIpv6(hex: string): string | undefined {
  if (!/^[0-9A-Fa-f]{32}$/.test(hex)) return undefined
  const words: string[] = []
  for (let i = 0; i < 4; i += 1) {
    const chunk = hex.slice(i * 8, i * 8 + 8)
    const bigEndian = [chunk.slice(6, 8), chunk.slice(4, 6), chunk.slice(2, 4), chunk.slice(0, 2)].join('')
    words.push(bigEndian.slice(0, 4), bigEndian.slice(4, 8))
  }
  // Compress the longest run of zero groups, the usual textual form.
  const nums = words.map(w => parseInt(w, 16))
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0
  nums.forEach((n, i) => {
    if (n === 0) { if (curStart < 0) curStart = i; curLen += 1; if (curLen > bestLen) { bestLen = curLen; bestStart = curStart } }
    else { curStart = -1; curLen = 0 }
  })
  const parts = words.map(w => w.replace(/^0{1,3}/, '') || '0')
  if (bestLen >= 2) {
    const head = parts.slice(0, bestStart).join(':')
    const tail = parts.slice(bestStart + bestLen).join(':')
    const text = tail.length === 0 ? `${head}::` : `${head}::${tail}`
    return text.replace(/^::/, '::').replace(/^:::/, '::')
  }
  return parts.join(':')
}

interface AddressPair { ip: string; port: number }

/** Parse '0100007F:1F90' (or the 32-hex v6 form) into address and port. */
export function parseAddressPair(field: string, family: 'v4' | 'v6'): AddressPair | undefined {
  const [hexIp, hexPort] = field.split(':')
  if (hexIp === undefined || hexPort === undefined) return undefined
  const ip = family === 'v4' ? hexToIpv4(hexIp) : hexToIpv6(hexIp)
  if (ip === undefined) return undefined
  const port = parseInt(hexPort, 16)
  if (!Number.isFinite(port)) return undefined
  return { ip, port }
}

/** Parse one /proc/net/tcp[6] document into inode-keyed socket entries. */
export function parseProcNet(text: string, family: 'v4' | 'v6' = 'v4'): SocketEntry[] {
  const out: SocketEntry[] = []
  for (const rawLine of text.split('\n').slice(1)) {
    const fields = rawLine.trim().split(/\s+/)
    if (fields.length < 10) continue
    const [, localField, remoteField, stateField, , , , , , inodeField] = fields
    const local = localField === undefined ? undefined : parseAddressPair(localField, family)
    const remote = remoteField === undefined ? undefined : parseAddressPair(remoteField, family)
    const inode = inodeField
    if (local === undefined || remote === undefined || inode === undefined || !/^\d+$/.test(inode)) continue
    out.push({
      inode,
      local: `${local.ip}:${String(local.port)}`,
      remote: `${remote.ip}:${String(remote.port)}`,
      state: TCP_STATES[stateField ?? ''] ?? stateField ?? 'UNKNOWN',
    })
  }
  return out
}

/** Socket inodes referenced by one /proc/<pid>/fd listing (readlink targets). */
export function socketInodesFromTargets(targets: readonly string[]): string[] {
  const out: string[] = []
  for (const target of targets) {
    const match = /^socket:\[(\d+)\]$/.exec(target.trim())
    if (match?.[1] !== undefined) out.push(match[1])
  }
  return out
}

/** Read `DSH_TOOL_CALL_ID`/`DSH_TOOL_NAME` out of a NUL-separated /proc/<pid>/environ blob. */
export function attributionFromEnviron(environ: string): { callId?: string; toolName?: string } {
  const result: { callId?: string; toolName?: string } = {}
  for (const entry of environ.split('\u0000')) {
    const [key, ...rest] = entry.split('=')
    const value = rest.join('=')
    if (key === 'DSH_TOOL_CALL_ID' && value !== '' && result.callId === undefined) result.callId = value
    if (key === 'DSH_TOOL_NAME' && value !== '' && result.toolName === undefined) result.toolName = value
  }
  return result
}

/** One observation line; `attributed` is false only in `mode: 'all'`. */
export interface EgressRecord {
  readonly callId?: string
  readonly toolName?: string
  readonly pid: number
  readonly remote: string
  readonly state: string
}

/** Deduplicate records by (callId, pid, remote) so a steady connection is written once. */
export function dedupeRecords(records: readonly EgressRecord[], seen: ReadonlySet<string>): EgressRecord[] {
  const fresh: EgressRecord[] = []
  // Also dedupe within the batch: one sample can surface the same remote through
  // more than one descriptor (e.g. a v4 and a v6 row), and it is still one fact.
  const batch = new Set<string>()
  for (const record of records) {
    const key = recordKey(record)
    if (seen.has(key) || batch.has(key)) continue
    batch.add(key)
    fresh.push(record)
  }
  return fresh
}

/** Stable key for one record (exported so callers dedupe across samples). */
export function recordKey(record: EgressRecord): string {
  return `${record.callId ?? '-'}|${String(record.pid)}|${record.remote}`
}
