# @clawsjoy/dsh-tool-attribution

Publishes `DSH_TOOL_CALL_ID` and `DSH_TOOL_NAME` for every shell tool
execution, through the public `ctx.shellEnv` registry.

## Why

Upstream DSH (0.1.5-rc.2) does **not** set those variables for tool
subprocesses (verified: no reference in the tree; `env` inside a tool call shows
nothing). Without them a subprocess cannot say which tool call it belongs to, so
any egress or observability layer can only guess — and a guessed attribution is
worse than none, because it looks authoritative.

## What it does

```ts
ctx.shellEnv.register({
  name: 'clawsjoy-tool-attribution',
  variables: { DSH_TOOL_CALL_ID: {...}, DSH_TOOL_NAME: {...} },
  resolve: execution => attribute(execution),   // {} when unattributable
})
```

- Reads the host's `ToolExecution` **structurally** (`callId`, `name`,
  `rootCallId`) so a host type change cannot break the build;
- Sanitizes values (trimmed, no NUL/newline, bounded) and **publishes nothing**
  when the identity is unusable — the negative control;
- Touches no `subprocess-local`/`shell-env` internals: the registry validates
  keys and rejects undeclared ones.

## Install

```sh
dsh plugin add --profile web @clawsjoy/dsh-tool-attribution
```

```yaml
- insert:
    - id: tool-attribution
      name: '@clawsjoy/dsh-tool-attribution'
```

## Verification

```sh
pnpm test
```

## License

MIT
