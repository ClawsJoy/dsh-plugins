/**
 * `@clawsjoy/dsh-egress-observer` — record-only egress observation for tool
 * subprocesses, attributed by `DSH_TOOL_CALL_ID`.
 *
 * Shape and why: upstream's `ctx.subprocess` seam exposes **no pid and no socket
 * events**, and replacing it means extending a host class whose constructor and
 * config shape are host-private (tried; the 0.1.5 types do not even declare the
 * method the way the base suggests). So this plugin does not touch the subprocess
 * service at all: it runs a **background sampler** over Linux /proc, finds pids
 * whose environment carries the call's `DSH_TOOL_CALL_ID` (published by
 * `@clawsjoy/dsh-tool-attribution`), maps their socket descriptors to
 * `/proc/net/tcp{,6}` rows, and appends each new remote to a JSONL sink once.
 *
 * Properties that matter: no host internals, no dependency on a host class, no
 * blocking, never throws into the tool path, never prevents a connection. It is a
 * record, not a fence — and a best-effort one (a connection shorter than the
 * interval can be missed).
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import { EgressSampler, realProcFs, type ProcFs } from './sampler.ts'
import { resolveSettings, type EgressObserverConfig } from './policy.ts'

export type { EgressObserverConfig, ResolvedSettings } from './policy.ts'
export { DEFAULT_INTERVAL_MS, resolveSettings, shouldRecord } from './policy.ts'
export { EgressSampler, realProcFs } from './sampler.ts'
export type { ProcFs } from './sampler.ts'
export type { EgressRecord } from './sockets.ts'
export * from './sockets.ts'

/** Start the sampler; returns a disposer (also wired to context disposal). */
export function startSampler(config: EgressObserverConfig = {}, fs: ProcFs = realProcFs): () => void {
  const settings = resolveSettings(config, { home: process.env['DSH_HOME'] ?? '' })
  if (!settings.enabled) return () => {}
  const sampler = new EgressSampler(settings, fs)
  const timer = setInterval(() => { void sampler.sampleOnce() }, settings.intervalMs)
  timer.unref?.()
  return () => { clearInterval(timer) }
}

/** Load the observer. `ctx.effect` takes the returned disposer and runs it on unload. */
export function apply(ctx: Context, config?: EgressObserverConfig): void {
  ctx.effect(() => startSampler(config), 'egress-observer: sampler')
}
