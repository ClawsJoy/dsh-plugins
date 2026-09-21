/**
 * `@clawsjoy/dsh-tool-attribution` — publishes `DSH_TOOL_CALL_ID` and
 * `DSH_TOOL_NAME` for every shell tool execution, through the public
 * `ctx.shellEnv` registry.
 *
 * Why a plugin rather than a core patch: the values are exactly what an
 * egress/observability layer needs to attribute a connection to a tool call, and
 * the registry is a supported contribution point (`register({name, variables,
 * resolve})`, keys validated as `DSH_[A-Z0-9_]+`, undeclared keys rejected by
 * the host). Nothing here touches `subprocess-local` or `shell-env` internals,
 * so both can move independently.
 *
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import { attribute, attributionVariables, type ExecutionLike } from './attribution.ts'

export type { Attribution, ExecutionLike } from './attribution.ts'
export { TOOL_CALL_ID_KEY, TOOL_NAME_KEY, attribute, attributionOf, attributionVariables, sanitizeValue } from './attribution.ts'

/** Contributor name used in diagnostics and duplicate detection. */
export const CONTRIBUTOR_NAME = 'clawsjoy-tool-attribution'

/** Minimal structural view of the registry (the host type lives in @deepseek-ai/dsh-shell). */
interface ShellEnvRegistryLike {
  register(contributor: {
    name: string
    variables: Record<string, { description: string }>
    resolve(execution: ExecutionLike): Record<string, string>
  }): unknown
}

/** Register the attribution contributor on `ctx.shellEnv`. */
export function apply(ctx: Context): void {
  ctx.inject(['shellEnv'], (shellCtx) => {
    const registry = (shellCtx as unknown as { shellEnv: ShellEnvRegistryLike }).shellEnv
    registry.register({
      name: CONTRIBUTOR_NAME,
      variables: attributionVariables(),
      resolve: execution => attribute(execution),
    })
  })
}
