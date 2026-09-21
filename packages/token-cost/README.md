# @clawsjoy/dsh-token-cost

A `ctx.tokenCost` service converting recorded token usage into cost, with
**configurable** pricing.

## Why configurable

The patch this replaces hard-coded DeepSeek's shared-key rates (input
¥0.001/1K, output ¥0.002/1K, reasoning ¥0.004/1K) and an integer unit of
1/10000 ¥. Prices change, and a self-hoster may be on different rates, so the
table is configuration with those defaults and an explicit unit.

## API

```ts
ctx.tokenCost.cost({ inputTokens, outputTokens, reasoningTokens, cacheReadTokens })
// -> { units: 70, fullyPriced: false }      units = 1/10000 ¥
ctx.tokenCost.yuan(usage)                    // -> "0.0070"
```

`fullyPriced: false` means at least one token bucket had no price — the total is
a floor, not a lie.

## Scope (honest)

This is the **server half**. Rendering cost in the conversation stats line is a
separate **client** plugin (the client-module surface); it is not part of this
package yet.

## Install

```sh
dsh plugin --profile web add @clawsjoy/dsh-token-cost
```

```yaml
- insert:
    - id: token-cost
      name: '@clawsjoy/dsh-token-cost'
      config:
        input: 0.001
        output: 0.002
        reasoning: 0.004
        cachedInput: 0
```

## Verification

```sh
pnpm test
```

## License

MIT
