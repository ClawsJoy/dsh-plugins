/**
 * `@clawsjoy/dsh-session-persistence-tolerant` — a listing-tolerance decorator
 * over the official jsonl session backend.
 *
 * Host drift handled here (measured 2026-09-22): the seam's listing signature
 * changed between host lines —
 *
 *   host 0.1.0-rc.x : list(signal?: AbortSignal)          -> SessionHeader[]
 *   host 0.1.5-rc.x : list(options?: {signal?: AbortSignal}) -> readonly Snapshot[]  (entries carry .header/.revision)
 *
 * One published plugin must survive both, so `list` is deliberately typed wide
 * (`...args: unknown[]` / `Promise<any>`) and returns **hybrid items**: each
 * item is the header spread out (so old consumers read `.id`) *plus* `header`
 * and `revision` (so new consumers read `.header.id`). The tolerant scan and
 * the fault sink are host-independent; only the item shape adapts.
 *
 * @module
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { scanTolerantRoot, type ScannedHeader, type SessionListFault } from './scan.ts'

export type { ScannedHeader, SessionListFault, TolerantScan } from './scan.ts'
export { parseHeader, readFirstLogLine, scanTolerantRoot } from './scan.ts'

const DISABLE_ENV = 'DSH_SESSION_LIST_TOLERANT'
const SINK_ENV = 'DSH_SESSION_LIST_FAULT_SINK'
const SINK_RELATIVE = join('logs', 'dsh-session-list-faults.jsonl')

/** A host listing item in either host's shape (see the module doc). */
interface HybridItem {
  readonly [key: string]: unknown
  readonly header: ScannedHeader
  readonly revision?: unknown
}

function isAbortSignal(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'aborted' in value && 'throwIfAborted' in value
}

export default class TolerantSessionPersistence extends JsonlSessionPersistence {
  /** Marker for diagnostics; the backend `name` stays the inherited literal. */
  readonly pluginName = 'session-persistence-tolerant'

  // TS-private (no `#`): cordis may invoke the method on a proxy/derived
  // receiver, and a JS private field's brand check would then throw
  // "Receiver must be an instance of class ..." during plugin-tree load.
  // Caught by the scratch-profile smoke test, 2026-09-22.
  private faults: readonly SessionListFault[] = []
  private recordedSignature = ''

  /** Faults surfaced by the most recent listing; empty when everything listed. */
  lastListingFaults(): readonly SessionListFault[] {
    return this.faults
  }

  /**
   * Tolerant listing for either host line. Returns hybrid items; see the module
   * doc for why the signature is wide.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- host seam changed shape between 0.1.0 and 0.1.5
  override async list(...args: unknown[]): Promise<any> {
    if (process.env[DISABLE_ENV] === 'off') return await (super.list as unknown as (...a: unknown[]) => Promise<unknown>)(...args)
    const legacy = isAbortSignal(args[0])

    let surfaced: unknown
    try {
      surfaced = await (super.list as unknown as (...a: unknown[]) => Promise<unknown>)(...args)
    } catch (error) {
      // The official listing refuses to degrade. Salvage what is listable and
      // keep the failure loud when nothing is.
      const scan = await scanTolerantRoot(this.config.root)
      await this.surface(scan.faults)
      if (scan.entries.length === 0) throw error
      const items = await Promise.all(scan.entries.map(async entry =>
        await this.asHybrid(entry.header, await this.revisionOf(entry.header.id))))
      return items
    }

    const scan = await scanTolerantRoot(this.config.root)
    const listed = new Set<string>(toArray(surfaced).map(item => String(headerOf(item).id ?? '')))
    const absent: SessionListFault[] = scan.entries
      .filter(entry => !listed.has(entry.header.id))
      .map(entry => ({
        id: entry.header.id,
        path: entry.path,
        reason: 'present on disk but absent from the listing',
      }))
    await this.surface([...scan.faults, ...absent])
    void legacy
    return toArray(surfaced).map(item => this.asHybrid(headerOf(item), revisionOf(item)))
  }

  /** One item that satisfies both host shapes. */
  private asHybrid(header: ScannedHeader, revision: unknown): HybridItem {
    return { ...header, header, revision }
  }

  /** Best-effort revision for a salvaged session (new hosts use it as cache identity). */
  private async revisionOf(id: string): Promise<unknown> {
    try {
      const reader = (this as unknown as { readStoredRevision?: (id: string) => Promise<unknown> }).readStoredRevision
      if (typeof reader === 'function') return await reader.call(this, id)
    } catch {
      // A missing revision only costs cache identity; it must never fail a listing.
    }
    return undefined
  }

  /** Record a fault set, deduped so a steady fault does not grow the sink. */
  private async surface(faults: readonly SessionListFault[]): Promise<void> {
    this.faults = faults
    if (faults.length === 0) return
    const signature = faults.map(fault => `${fault.id}\u0000${fault.reason}`).sort().join('\u0001')
    if (signature === this.recordedSignature) return
    this.recordedSignature = signature
    try {
      const sink = sinkPath()
      await mkdir(dirname(sink), { recursive: true })
      const stamp = new Date().toISOString()
      const lines = faults
        .map(fault => `${JSON.stringify({ ts: stamp, plugin: 'session-persistence-tolerant', ...fault })}\n`)
        .join('')
      await appendFile(sink, lines, 'utf8')
    } catch {
      // A sink failure must never turn a tolerated skip into a failed listing.
    }
  }
}

/** Normalise a host listing result to an array without trusting its type. */
function toArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Read the header out of either host's item shape. */
function headerOf(item: unknown): ScannedHeader {
  if (typeof item === 'object' && item !== null && 'header' in item) {
    return (item as { header: ScannedHeader }).header
  }
  return item as ScannedHeader
}

/** Read the revision out of the new host's item shape. */
function revisionOf(item: unknown): unknown {
  if (typeof item === 'object' && item !== null && 'revision' in item) {
    return (item as { revision: unknown }).revision
  }
  return undefined
}

/** Resolve the fault sink path. */
export function sinkPath(): string {
  const override = process.env[SINK_ENV]
  if (override !== undefined && override.length > 0) return override
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, SINK_RELATIVE)
}
