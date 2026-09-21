/**
 * Tool attribution for shell executions, as pure functions.
 *
 * Upstream DSH (0.1.5-rc.2) does not set `DSH_TOOL_CALL_ID`/`DSH_TOOL_NAME` for
 * tool subprocesses — verified by grep over the tree and by `env` inside a tool
 * call. Without them, a subprocess cannot say which tool call it belongs to, so
 * an egress/observability layer can only guess. This module produces exactly the
 * two values, and the plugin half publishes them through the public
 * `ctx.shellEnv` registry (no core patch).
 *
 * The execution shape is the host's `ToolExecution` (callId, rootCallId, name,
 * arguments, agent, parent, signal, token). It is read **structurally** here so a
 * drift in the host's type brand cannot break the build, and so a missing field
 * degrades to "no attribution" rather than a throw.
 *
 * @module
 */

/** The two environment keys this contributor owns. */
export const TOOL_CALL_ID_KEY = 'DSH_TOOL_CALL_ID'
export const TOOL_NAME_KEY = 'DSH_TOOL_NAME'

/** Longest value we will publish (env limits are real; ids are short). */
export const MAX_VALUE_LENGTH = 200

/** Structural view of the host's execution; every field is optional to read. */
export interface ExecutionLike {
  readonly callId?: unknown
  readonly rootCallId?: unknown
  readonly name?: unknown
}

export interface Attribution {
  readonly toolCallId: string
  readonly toolName: string
  readonly rootCallId?: string
}

/** Sanitize one value: string, trimmed, no NUL/newline, bounded. */
export function sanitizeValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_VALUE_LENGTH) return undefined
  if (trimmed.includes('\u0000') || trimmed.includes('\n') || trimmed.includes('\r')) return undefined
  return trimmed
}

/** The attribution for one execution, or `undefined` when it cannot be attributed. */
export function attributionOf(execution: ExecutionLike | undefined): Attribution | undefined {
  const toolCallId = sanitizeValue(execution?.callId)
  const toolName = sanitizeValue(execution?.name)
  if (toolCallId === undefined || toolName === undefined) return undefined
  const rootCallId = sanitizeValue(execution?.rootCallId)
  return rootCallId === undefined ? { toolCallId, toolName } : { toolCallId, toolName, rootCallId }
}

/** The environment overlay for one execution; empty when unattributable. */
export function attribute(execution: ExecutionLike | undefined): Record<string, string> {
  const attribution = attributionOf(execution)
  if (attribution === undefined) return {}
  return { [TOOL_CALL_ID_KEY]: attribution.toolCallId, [TOOL_NAME_KEY]: attribution.toolName }
}

/** The declaration map a contributor must publish for the keys it may return. */
export function attributionVariables(): Record<string, { description: string }> {
  return {
    [TOOL_CALL_ID_KEY]: { description: 'Identity of the tool call whose subprocess this is (set by the attribution plugin).' },
    [TOOL_NAME_KEY]: { description: 'Name of the tool that spawned this subprocess (set by the attribution plugin).' },
  }
}
