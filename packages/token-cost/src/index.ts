/**
 * `@clawsjoy/dsh-token-cost` — a `ctx.tokenCost` service with configurable
 * token pricing.
 *
 * Scope, stated honestly: this is the **server half**. It converts recorded
 * token usage into an integer cost (1/10000 ¥) that any consumer can read; a
 * client plugin that renders it in the conversation stats line is a separate
 * slice (the client-module surface), not part of this package.
 *
 * @module
 */
import { Service, type Context } from '@deepseek-ai/cordis'
import { DEFAULT_PRICING, costOf, formatYuan, resolvePricing, type CostResult, type TokenPricing, type TokenUsageLike } from './pricing.ts'

export type { CostResult, TokenPricing, TokenUsageLike } from './pricing.ts'
export { DEFAULT_PRICING, UNITS_PER_YUAN, costOf, formatYuan, resolvePricing } from './pricing.ts'

export interface TokenCostConfig extends Partial<TokenPricing> {}

/** The `ctx.tokenCost` service: pricing plus the conversions built on it. */
export class TokenCost extends Service {
  readonly pricing: TokenPricing

  constructor(ctx: Context, config: TokenCostConfig = {}) {
    super(ctx, 'tokenCost')
    this.pricing = resolvePricing(config)
  }

  /** Cost in 1/10000 ¥ units for one usage record. */
  cost(usage: TokenUsageLike | undefined): CostResult {
    return costOf(usage, this.pricing)
  }

  /** Same, rendered as a ¥ string (four decimals). */
  yuan(usage: TokenUsageLike | undefined): string {
    return formatYuan(this.cost(usage).units)
  }
}

/** Load the service. */
export function apply(ctx: Context, config?: TokenCostConfig): void {
  void new TokenCost(ctx, config)
}
