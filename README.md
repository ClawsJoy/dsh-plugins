# dsh-plugins

Community plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

Every package here is built to survive a DSH upgrade: it binds to a **published
contract** (a service seam or an addressable profile row), declares the host
packages it needs as **peer dependencies**, and is installed into a profile —
never patched into the DSH source tree.

| Package | What it does |
|---|---|
| [`@clawsjoy/dsh-session-persistence-tolerant`](packages/session-persistence-tolerant) | Listing tolerance + fault surfacing for the jsonl session backend: a corrupt or headerless session log stops disappearing silently. |
| [`@clawsjoy/dsh-session-retention`](packages/session-retention) | Keeps session logs whole: the size cap is opt-in because a rotated log cannot be loaded (`seq gap in committed region`). |
| [`@clawsjoy/dsh-tool-attribution`](packages/tool-attribution) | Publishes `DSH_TOOL_CALL_ID`/`DSH_TOOL_NAME` for shell executions through the public `ctx.shellEnv` registry. |
| [`@clawsjoy/dsh-token-cost`](packages/token-cost) | A `ctx.tokenCost` service with configurable pricing (1/10000 ¥ units) and an honest `fullyPriced` flag. |
| [`@clawsjoy/dsh-egress-observer`](packages/egress-observer) | Record-only egress observation attributed by `DSH_TOOL_CALL_ID` (Linux /proc; never blocks, never prevents a connection). |

## Install

```sh
dsh plugin --profile web add @clawsjoy/dsh-session-persistence-tolerant
```

then swap the profile row (see each package's README for its exact patch).

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
```

Adding or changing a package means the lockfile must be regenerated and
committed, or CI's frozen install fails:

```sh
pnpm install --lockfile-only   # resolves without touching node_modules
```

## License

MIT
