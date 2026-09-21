/**
 * The sampling loop, with the filesystem injected so it is unit-testable.
 *
 * @module
 */
import { appendFile, mkdir, readFile, readdir, readlink } from 'node:fs/promises'
import { dirname } from 'node:path'
import { attributionFromEnviron, dedupeRecords, parseProcNet, recordKey, socketInodesFromTargets, type EgressRecord } from './sockets.ts'
import { shouldRecord, type ResolvedSettings } from './policy.ts'

/** The filesystem surface the sampler needs; the real one is the default. */
export interface ProcFs {
  readdir(path: string): Promise<string[]>
  readlink(path: string): Promise<string>
  readFile(path: string, encoding: 'utf8' | 'latin1'): Promise<string>
  appendFile(path: string, data: string): Promise<void>
  mkdir(path: string): Promise<void>
  dirname(path: string): string
}

/** Real /proc + sink writer. */
export const realProcFs: ProcFs = {
  readdir: async path => await readdir(path),
  readlink: async path => await readlink(path),
  readFile: async (path, encoding) => await readFile(path, encoding),
  appendFile: async (path, data) => { await appendFile(path, data, 'utf8') },
  mkdir: async path => { await mkdir(path, { recursive: true }) },
  dirname,
}

/** One sampler's state: dedupe set plus the settings it obeys. */
export class EgressSampler {
  private readonly seen = new Set<string>()

  constructor(
    private readonly settings: ResolvedSettings,
    private readonly fs: ProcFs = realProcFs,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** Sample once. Never throws: a failure simply yields no records this tick. */
  async sampleOnce(): Promise<EgressRecord[]> {
    try {
      const table = await this.socketTable()
      if (table.length === 0) return []
      const records: EgressRecord[] = []
      for (const name of await this.fs.readdir('/proc')) {
        if (!/^\d+$/.test(name)) continue
        const pid = Number(name)
        const attribution = await this.attributionOf(pid)
        const inodes = await this.socketInodes(pid)
        if (inodes.size === 0) continue
        for (const entry of table) {
          if (!inodes.has(entry.inode) || entry.state === 'LISTEN') continue
          const record: EgressRecord = {
            ...(attribution.callId === undefined ? {} : { callId: attribution.callId }),
            ...(attribution.toolName === undefined ? {} : { toolName: attribution.toolName }),
            pid, remote: entry.remote, state: entry.state,
          }
          if (shouldRecord(this.settings.mode, record)) records.push(record)
        }
      }
      const fresh = dedupeRecords(records, this.seen)
      if (fresh.length === 0) return []
      for (const record of fresh) this.seen.add(recordKey(record))
      await this.append(fresh)
      return fresh
    } catch {
      return []
    }
  }

  private async attributionOf(pid: number): Promise<{ callId?: string; toolName?: string }> {
    try { return attributionFromEnviron(await this.fs.readFile(`/proc/${String(pid)}/environ`, 'latin1')) } catch { return {} }
  }

  private async socketInodes(pid: number): Promise<Set<string>> {
    try {
      const fds = await this.fs.readdir(`/proc/${String(pid)}/fd`)
      const targets = await Promise.all(fds.map(async fd => {
        try { return await this.fs.readlink(`/proc/${String(pid)}/fd/${fd}`) } catch { return '' }
      }))
      return new Set(socketInodesFromTargets(targets))
    } catch { return new Set() }
  }

  private async socketTable(): Promise<ReturnType<typeof parseProcNet>> {
    const out: ReturnType<typeof parseProcNet> = []
    for (const [file, family] of [['/proc/net/tcp', 'v4'], ['/proc/net/tcp6', 'v6']] as const) {
      try { out.push(...parseProcNet(await this.fs.readFile(file, 'utf8'), family)) } catch { /* optional */ }
    }
    return out
  }

  private async append(records: readonly EgressRecord[]): Promise<void> {
    await this.fs.mkdir(this.fs.dirname(this.settings.sink))
    const stamp = this.now()
    await this.fs.appendFile(this.settings.sink, records
      .map(record => `${JSON.stringify({ ts: stamp, plugin: 'egress-observer', ...record })}\n`).join(''))
  }
}
