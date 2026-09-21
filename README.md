# dsh-plugins

Community plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH).

Every package here is built to survive a DSH upgrade: it binds to a **published
contract** (a service seam or an addressable profile row), declares the host
packages it needs as **peer dependencies**, and is installed into a profile —
never patched into the DSH source tree.

| Package | What it does |
|---|---|
| [`@clawsjoy/dsh-session-persistence-tolerant`](packages/session-persistence-tolerant) | Listing tolerance + fault surfacing for the jsonl session backend: a corrupt or headerless session log stops disappearing silently. |

## Install

```sh
dsh plugin add --profile web @clawsjoy/dsh-session-persistence-tolerant
```

then swap the profile row (see each package's README for its exact patch).

## Development

```sh
pnpm install
pnpm test
```

## License

MIT
