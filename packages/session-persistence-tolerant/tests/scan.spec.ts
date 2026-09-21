/**
 * Unit tests for the tolerant scan.
 *
 * The negative control is the point of this file: `strictList` below is the
 * official listing's shape (first frame only, throw on unreadable, silently
 * `continue` when the first frame is not a header). The same tree that makes
 * `strictList` fail is the tree `scanTolerantRoot` lists and reports.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readFirstLogLine, scanTolerantRoot } from '../src/scan.ts'

const PROJECT = '--work--'

function headerLine(id: string): string {
  return JSON.stringify({
    type: 'session',
    version: 0,
    id,
    createdAt: 1_789_281_233_093,
    cwd: '/work',
    delegationDepth: 0,
    agentPreset: 'code',
  })
}

function eventLine(seq: number): string {
  return JSON.stringify({ type: 'tool/code-dispatch-start', seq, time: 1_789_739_861_632, data: {} })
}

function zstdFrame(text: string): Buffer {
  return zstdCompressSync(Buffer.from(`${text}\n`))
}

async function writeSession(session: string, payload: Buffer, name = 'session.jsonl.zstd'): Promise<string> {
  const dir = join(root, PROJECT, session)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, name), payload)
  return dir
}

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-tolerant-scan-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('readFirstLogLine', () => {
  it('reads the header line out of a zstd artifact', async () => {
    const dir = await writeSession('good', zstdFrame(headerLine('good')))
    expect(await readFirstLogLine(join(dir, 'session.jsonl.zstd'))).toBe(headerLine('good'))
  })

  it('reads the header line out of a plain artifact', async () => {
    const dir = await writeSession('plain', Buffer.from(`${headerLine('plain')}\n`), 'session.jsonl')
    expect(await readFirstLogLine(join(dir, 'session.jsonl'))).toBe(headerLine('plain'))
  })
})

describe('scanTolerantRoot', () => {
  it('lists the readable sessions and reports every skip', async () => {
    await writeSession('good', zstdFrame(headerLine('good')))
    await writeSession('headerless', zstdFrame(eventLine(5_528_588)))
    await writeSession('unreadable', Buffer.from('not a zstd frame at all', 'utf8'))
    await mkdir(join(root, PROJECT, 'no-log'), { recursive: true })

    const scan = await scanTolerantRoot(root)

    expect(scan.entries.map(entry => entry.header.id)).toEqual(['good'])
    const tag = (reason: string): string => {
      if (reason.startsWith('first frame is not a session header')) return 'not-a-header'
      if (reason.startsWith('unreadable session log')) return 'unreadable'
      if (reason.startsWith('no session jsonl artifact')) return 'no-artifact'
      return reason
    }
    expect(scan.faults.map(fault => [fault.id, tag(fault.reason)]).sort()).toEqual([
      ['headerless', 'not-a-header'],
      ['no-log', 'no-artifact'],
      ['unreadable', 'unreadable'],
    ])
  })

  it('returns an empty scan for a missing root instead of throwing', async () => {
    await expect(scanTolerantRoot(join(root, 'absent'))).resolves.toEqual({ entries: [], faults: [] })
  })

  it('negative control: the official shape fails on the same tree', async () => {
    await writeSession('good', zstdFrame(headerLine('good')))
    await writeSession('headerless', zstdFrame(eventLine(5_528_588)))
    await writeSession('unreadable', Buffer.from('not a zstd frame at all', 'utf8'))

    // The official listing's shape: first frame only, throw when unreadable,
    // silently skip when it is not a header.
    const strictList = async (dir: string): Promise<string[]> => {
      const { readdir } = await import('node:fs/promises')
      const listed: string[] = []
      for (const project of await readdir(dir, { withFileTypes: true })) {
        if (!project.isDirectory()) continue
        for (const session of await readdir(join(dir, project.name), { withFileTypes: true })) {
          if (!session.isDirectory()) continue
          const logPath = join(dir, project.name, session.name, 'session.jsonl.zstd')
          const line = await readFirstLogLine(logPath) // throws on an unreadable frame
          const parsed = line === undefined ? undefined : (JSON.parse(line) as { type?: string; id?: string })
          if (parsed?.type !== 'session') continue // silent skip
          listed.push(String(parsed.id))
        }
      }
      return listed
    }

    await expect(strictList(root)).rejects.toThrow()
    const scan = await scanTolerantRoot(root)
    expect(scan.entries.map(entry => entry.header.id)).toEqual(['good'])
    expect(scan.faults).toHaveLength(2)
  })
})
