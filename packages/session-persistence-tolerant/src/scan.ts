/**
 * Dependency-free tolerance scan of a jsonl session root.
 *
 * Why it exists: the official jsonl listing reads only each artifact's first
 * frame, and it (a) throws when a frame cannot be read, while (b) silently
 * `continue`s when the first frame is not a session header. A conversation can
 * therefore leave the sidebar with no error and no trace anywhere.
 *
 * This module knows exactly two things about the on-disk layout — that a root
 * holds `<project>/<session>/session.jsonl[.zstd]`, and that a session
 * artifact's first decompressed line is the session header. The session id and
 * cwd are read *from the file*, never derived from the directory name, so a
 * change to the directory naming scheme cannot break the scan.
 *
 * @module
 */
import { open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** One artifact the scan could not list. */
export interface SessionListFault {
  /** Session directory name, or the project directory name when no session directory exists. */
  readonly id: string
  /** Absolute path of the unlistable artifact or directory. */
  readonly path: string
  /** Human-readable reason, stable enough to dedupe on. */
  readonly reason: string
}

/** Structural subset of a session header; the host types the rest. */
export interface ScannedHeader {
  readonly type: 'session'
  readonly id: string
  readonly cwd?: string
  readonly createdAt?: number
  readonly [key: string]: unknown
}

/** One listable session artifact found by the scan. */
export interface ScannedEntry {
  readonly header: ScannedHeader
  /** Absolute path of the artifact the header was read from. */
  readonly path: string
}

export interface TolerantScan {
  readonly entries: readonly ScannedEntry[]
  readonly faults: readonly SessionListFault[]
}

/** Chunk sizes tried, in order, when decoding an artifact's first frame. */
const HEADER_READ_ATTEMPTS = [8 * 1024, 256 * 1024] as const

/** Artifact names a session directory may hold, most specific first. */
const LOG_NAMES = ['session.jsonl.zstd', 'session.jsonl'] as const

/**
 * First logical line of a session artifact, without decoding the whole log.
 * Returns `undefined` for an empty artifact.
 */
export async function readFirstLogLine(logPath: string): Promise<string | undefined> {
  const handle = await open(logPath, 'r')
  try {
    let lastError: unknown
    for (const attempt of HEADER_READ_ATTEMPTS) {
      const buffer = Buffer.alloc(attempt)
      const { bytesRead } = await handle.read(buffer, 0, attempt, 0)
      if (bytesRead === 0) return undefined
      const slice = buffer.subarray(0, bytesRead)
      let text: string
      try {
        text = logPath.endsWith('.zstd')
          ? zstdDecompressSync(slice).toString('utf8')
          : slice.toString('utf8')
      } catch (error) {
        // A frame that does not fit this chunk is retried larger; the caller
        // turns a final failure into a fault rather than an absent session.
        lastError = error
        continue
      }
      const newline = text.indexOf('\n')
      return newline === -1 ? text : text.slice(0, newline)
    }
    throw lastError instanceof Error ? lastError : new Error('no readable header frame')
  } finally {
    await handle.close()
  }
}

/**
 * List every session under `root`, skipping unlistable artifacts instead of
 * letting one of them fail the whole listing, and reporting each skip.
 */
export async function scanTolerantRoot(root: string): Promise<TolerantScan> {
  const entries: ScannedEntry[] = []
  const faults: SessionListFault[] = []
  for (const project of await listDirectoryNames(root)) {
    const projectPath = join(root, project)
    for (const session of await listDirectoryNames(projectPath)) {
      const sessionPath = join(projectPath, session)
      const logName = await findLogName(sessionPath)
      if (logName === undefined) {
        faults.push({ id: session, path: sessionPath, reason: 'no session jsonl artifact in directory' })
        continue
      }
      const logPath = join(sessionPath, logName)
      let first: string | undefined
      try {
        first = await readFirstLogLine(logPath)
      } catch (error) {
        faults.push({ id: session, path: logPath, reason: `unreadable session log: ${describe(error)}` })
        continue
      }
      if (first === undefined) {
        faults.push({ id: session, path: logPath, reason: 'empty session log' })
        continue
      }
      const header = parseHeader(first)
      if (header === undefined) {
        faults.push({
          id: session,
          path: logPath,
          reason: `first frame is not a session header (${describeFirstFrame(first)})`,
        })
        continue
      }
      entries.push({ header, path: logPath })
    }
  }
  return { entries, faults }
}

/** Parse a header line, or return `undefined` when the line is not one. */
export function parseHeader(line: string): ScannedHeader | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const candidate = parsed as { type?: unknown; id?: unknown }
  if (candidate.type !== 'session' || typeof candidate.id !== 'string') return undefined
  return parsed as ScannedHeader
}

async function listDirectoryNames(path: string): Promise<string[]> {
  try {
    const dirents = await readdir(path, { withFileTypes: true })
    return dirents
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

async function findLogName(sessionPath: string): Promise<string | undefined> {
  let names: string[]
  try {
    names = await readdir(sessionPath)
  } catch {
    return undefined
  }
  const present = new Set(names)
  return LOG_NAMES.find(name => present.has(name))
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === undefined ? `${error.name}: ${error.message}` : `${code}: ${error.message}`
  }
  return String(error)
}

function describeFirstFrame(line: string): string {
  const parsed = safeParse(line)
  const type = parsed === undefined ? 'unparsed' : String((parsed as { type?: unknown }).type ?? 'no type field')
  return `type=${type}, ${line.length} chars`
}

function safeParse(line: string): unknown {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}
