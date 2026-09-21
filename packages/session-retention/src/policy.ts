/**
 * The retention policy this plugin enforces, as pure functions.
 *
 * Why it exists (measured 2026-09-22, DSH 0.1.0-rc.5): the jsonl backend's size
 * cap rotates a log by renaming it aside and re-materialising a header-only live
 * file, so the live log then starts at a **non-zero seq**. The session loader
 * requires the committed region to start at seq 0 and refuses such a log:
 *
 *   corrupt session log: seq gap in committed region at line 1
 *   (expected 0, got 5528588)
 *
 * A rotated session is therefore listable but **unopenable**. Until a format
 * with a real checkpoint exists, the only safe retention is: keep every log
 * whole, and optionally prune **whole sessions** (which is what the upstream
 * per-project count cap already does).
 *
 * @module
 */

/** Default cap: effectively "never rotate" (1 TiB). */
export const UNLIMITED_LOG_BYTES = 1024 ** 4

/** Base defaults this plugin overrides (upstream jsonl backend). */
export const BASE_DEFAULT_MAX_LOG_BYTES = 50 * 1024 * 1024

export interface RetentionConfig {
  readonly maxLogBytes?: number
  readonly maxSessionsPerProject?: number
  readonly [key: string]: unknown
}

export interface RetentionDecision {
  /** The cap this plugin will hand to the backend. */
  readonly maxLogBytes: number
  /** True when the operator explicitly opted into truncation. */
  readonly truncationOptIn: boolean
  /** Why, in one line, for logs and diagnostics. */
  readonly reason: string
}

/**
 * Resolve the safe cap. An explicit `maxLogBytes` is honoured (**opt-in** to the
 * rotation hazard, e.g. after the format grows a checkpoint); otherwise the cap
 * is effectively unlimited.
 */
export function resolveRetention(config: RetentionConfig | undefined): RetentionDecision {
  const configured = config?.maxLogBytes
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return {
      maxLogBytes: configured,
      truncationOptIn: true,
      reason: `explicit maxLogBytes=${String(configured)} honoured (rotation becomes the operator's choice)`,
    }
  }
  return {
    maxLogBytes: UNLIMITED_LOG_BYTES,
    truncationOptIn: false,
    reason: 'default: keep every session log whole; a rotated log cannot be loaded (seq gap)',
  }
}

/** Would the *base* default have rotated a log of this size? (the hazard being avoided) */
export function baseDefaultWouldRotate(sizeBytes: number): boolean {
  return sizeBytes > BASE_DEFAULT_MAX_LOG_BYTES
}

/** Apply the resolved cap to a config object without mutating the caller's. */
export function withSafeRetention<T extends RetentionConfig>(config: T | undefined): T & { maxLogBytes: number } {
  const decision = resolveRetention(config)
  return { ...(config ?? ({} as T)), maxLogBytes: decision.maxLogBytes }
}
