# @clawsjoy/dsh-egress-observer

Record-only egress observation for tool subprocesses, attributed by
`DSH_TOOL_CALL_ID`.

## Why this shape

Upstream's `ctx.subprocess.spawn` returns a handle with **no pid and no socket
events**, so a plugin cannot see a child's connections from inside. The kernel
can: this plugin extends the local subprocess runtime, overrides `spawn`, and
starts a bounded sampler that

1. finds pids whose `/proc/<pid>/environ` carries the call's
   `DSH_TOOL_CALL_ID` (what [`@clawsjoy/dsh-tool-attribution`](../tool-attribution)
   publishes),
2. maps those pids' socket descriptors to `/proc/net/tcp{,6}` rows,
3. appends each **new** remote to a JSONL sink and nothing else.

It never blocks the spawn, never throws into the tool path, and never prevents a
connection: **a record, not a fence.**

## Honest limits

- **Linux only** (/proc). Elsewhere it starts nothing.
- **Best-effort**: a connection shorter than the sampling interval can be missed.
- Records `ESTABLISHED`/`SYN_SENT`-class rows; `LISTEN` rows are the sampling
  host's own and are skipped.
- `mode: 'attributed'` (default) records only attributed children; `mode: 'all'`
  also records unattributed egress, without inventing an owner.

## Install

```sh
dsh plugin --profile web add @clawsjoy/dsh-egress-observer
```

No row is disabled: the observer adds a sampler, it does not replace the
subprocess service.

```yaml
- insert:
    - id: egress-observer
      name: '@clawsjoy/dsh-egress-observer'
      config:
        mode: attributed        # or 'all'
        intervalMs: 1000
        # sink: /home/you/.dsh/logs/dsh-egress.jsonl
```

Pair it with [`@clawsjoy/dsh-tool-attribution`](../tool-attribution) — that is
what puts `DSH_TOOL_CALL_ID` into the child's environment so a connection has an
owner at all.

## Verification

```sh
pnpm test                    # pure /proc parsing, dedupe, attribution
node tests/smoke.mjs         # real child + real /proc: attributed egress recorded
```

## License

MIT
