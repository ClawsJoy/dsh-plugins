/**
 * `@clawsjoy/dsh-session-persistence-tolerant` — a listing-tolerance decorator
 * over the official jsonl session backend.
 *
 * What it changes, and what it deliberately does not:
 *
 * - It **inherits** `JsonlSessionPersistence` and overrides only the listing
 *   path, so every other behaviour (create, append, load, repair, the service
 *   key, the config schema) stays exactly the official one. Upstream changes to
 *   those paths arrive for free; only the listing contract has to keep holding.
 * - On a successful listing it surfaces what the official code skipped
 *   silently — an artifact whose first frame is not a session header.
 * - When the official listing throws, it salvages every listable session by
 *   walking the root itself, and reports the rest instead of failing the whole
 *   listing.
 *
 * Faults are reported two ways: `listFaults()` on the service instance, and an
 * append-only JSONL sink (deduped per fault set) so a vanished conversation
 * leaves a trace even when nobody asks.
 *
 * Install (profile row swap; the official row is disabled, not modified):
 *
 * ```yaml
 * - id: session-persistence-jsonl
 *   disabled: true
 * - insert:
 *     - id: session-persistence-tolerant
 *       name: '@clawsjoy/dsh-session-persistence-tolerant'
 *       config:
 *         root: !!js dshHomePath('sessions')
 * ```
 *
 * Environment (optional): `DSH_SESSION_LIST_FAULT_SINK` overrides the sink
 * path, `DSH_SESSION_LIST_TOLERANT=off` restores the official behaviour
 * exactly (the negative control, usable in production).
 *
 * @module
 */
import { appendFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import { scanTolerantRoot, type ScannedHeader, type SessionListFault } from './scan.ts'

export type { ScannedHeader, SessionListFault, TolerantScan } from './scan.ts'
export { parseHeader, readFirstLogLine, scanTolerantRoot } from './scan.ts'

/** Set to `off` to delegate every listing to the official implementation. */
const DISABLE_ENV = 'DSH_SESSION_LIST_TOLERANT'
/** Overrides the fault sink path. */
const SINK_ENV = 'DSH_SESSION_LIST_FAULT_SINK'
/** Sink location relative to the Harness home. */
const SINK_RELATIVE = join('logs', 'dsh-session-list-faults.jsonl')

/**
 * The jsonl backend with a listing that degrades per session instead of
 * failing whole, and that reports what it had to skip.
 */
export default class TolerantSessionPersistence extends JsonlSessionPersistence {
  /**
   * Marker for diagnostics. The backend `name` is deliberately inherited: the
   * base types it as a literal, and a host without this plugin's sibling
   * patches must not see a different label.
   */
  readonly pluginName = 'session-persistence-tolerant'

  #faults: readonly SessionListFault[] = []
  #recordedSignature = ''

  /**
   * Faults surfaced by the most recent listing; empty when everything listed.
   * Named to stay independent of the base class: a host whose jsonl backend
   * already ships its own `listFaults()` (and one that does not) both compile.
   */
  lastListingFaults(): readonly SessionListFault[] {
    return this.#faults
  }

  override async list(signal?: AbortSignal): Promise<SessionHeader[]> {
    if (process.env[DISABLE_ENV] === 'off') return await super.list(signal)

    let listed: SessionHeader[]
    try {
      listed = await super.list(signal)
    } catch (error) {
      // The official listing refuses to degrade. Salvage what is listable and
      // keep the failure loud when nothing is.
      const scan = await scanTolerantRoot(this.config.root)
      await this.#surface(scan.faults)
      if (scan.entries.length === 0) throw error
      return scan.entries.map(entry => entry.header as unknown as SessionHeader)
    }

    const scan = await scanTolerantRoot(this.config.root)
    const listedIds = new Set<string>(listed.map(header => header.id))
    const absent: SessionListFault[] = scan.entries
      .filter(entry => !listedIds.has(entry.header.id))
      .map(entry => ({
        id: entry.header.id,
        path: entry.path,
        reason: 'present on disk but absent from the listing',
      }))
    await this.#surface([...scan.faults, ...absent])
    return listed
  }

  /** Record a fault set, deduped so a steady fault does not grow the sink. */
  async #surface(faults: readonly SessionListFault[]): Promise<void> {
    this.#faults = faults
    if (faults.length === 0) return
    const signature = faults.map(fault => `${fault.id}\u0000${fault.reason}`).sort().join('\u0001')
    if (signature === this.#recordedSignature) return
    this.#recordedSignature = signature
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

/** Resolve the fault sink path. */
export function sinkPath(): string {
  const override = process.env[SINK_ENV]
  if (override !== undefined && override.length > 0) return override
  const home = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return join(home, SINK_RELATIVE)
}
