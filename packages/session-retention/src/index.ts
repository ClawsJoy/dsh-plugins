/**
 * `@clawsjoy/dsh-session-retention` — the jsonl session backend with the
 * size-cap rotation neutralised by default.
 *
 * It **extends** `JsonlSessionPersistence` and changes exactly one thing: the
 * `maxLogBytes` it hands to the backend. Everything else (service key, config
 * schema, create/append/load/repair, the safe per-project **whole-session**
 * count cap) is inherited, so upstream improvements arrive for free.
 *
 * Install (profile row swap; the official row is disabled, never modified):
 *
 * ```yaml
 * - id: session-persistence-jsonl
 *   disabled: true
 * - insert:
 *     - id: session-retention
 *       name: '@clawsjoy/dsh-session-retention'
 *       config:
 *         root: !!js dshHomePath('sessions')
 *         # maxSessionsPerProject: 50     # whole-session pruning (safe)
 *         # maxLogBytes: 209715200        # opt-in only; see README
 * ```
 *
 * @module
 */
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { resolveRetention, withSafeRetention, type RetentionConfig, type RetentionDecision } from './policy.ts'

export type { RetentionConfig, RetentionDecision } from './policy.ts'
export { BASE_DEFAULT_MAX_LOG_BYTES, UNLIMITED_LOG_BYTES, baseDefaultWouldRotate, resolveRetention, withSafeRetention } from './policy.ts'

export default class RetentionSafeSessionPersistence extends JsonlSessionPersistence {
  /** Marker for diagnostics; the backend `name` stays the inherited literal. */
  readonly pluginName = 'session-retention'

  /** What this instance decided about truncation (for logs/diagnostics). */
  readonly retention: RetentionDecision

  constructor(
    ctx: ConstructorParameters<typeof JsonlSessionPersistence>[0],
    config: ConstructorParameters<typeof JsonlSessionPersistence>[1] & RetentionConfig,
  ) {
    // The only behavioural change: the cap handed to the backend. The host config
    // (root, packChunks, …) rides through untouched; only maxLogBytes is resolved.
    super(ctx, withSafeRetention(config))
    this.retention = resolveRetention(config)
  }
}
