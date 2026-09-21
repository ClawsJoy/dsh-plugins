/**
 * Settings resolution for the egress observer, as pure functions.
 *
 * @module
 */

export interface EgressObserverConfig {
  /** 'attributed' (default) records only pids carrying DSH_TOOL_CALL_ID; 'all' also records unattributed ones. */
  readonly mode?: 'attributed' | 'all'
  /** Sampler interval in ms (default 1000). */
  readonly intervalMs?: number
  /** JSONL sink path; defaults to `$DSH_HOME/logs/dsh-egress.jsonl`. */
  readonly sink?: string
  /** Hard off switch for environments where /proc scanning is unwanted. */
  readonly enabled?: boolean
}

export interface ResolvedSettings {
  readonly enabled: boolean
  readonly mode: 'attributed' | 'all'
  readonly intervalMs: number
  readonly sink: string
}

export const DEFAULT_INTERVAL_MS = 1000

/** Resolve settings defensively: a bad value falls back, never throws. */
export function resolveSettings(config: EgressObserverConfig = {}, defaults: { home: string } = { home: '' }): ResolvedSettings {
  const interval = config.intervalMs
  const intervalMs = typeof interval === 'number' && Number.isFinite(interval) && interval >= 100
    ? Math.floor(interval)
    : DEFAULT_INTERVAL_MS
  const sink = typeof config.sink === 'string' && config.sink.length > 0
    ? config.sink
    : `${defaults.home.replace(/\/+$/, '')}/logs/dsh-egress.jsonl`
  return {
    enabled: config.enabled !== false && process.platform === 'linux',
    mode: config.mode === 'all' ? 'all' : 'attributed',
    intervalMs,
    sink,
  }
}

/** Whether an observation belongs in the sink, given the mode. */
export function shouldRecord(mode: 'attributed' | 'all', record: { readonly callId?: string }): boolean {
  if (mode === 'all') return true
  return record.callId !== undefined && record.callId.length > 0
}
