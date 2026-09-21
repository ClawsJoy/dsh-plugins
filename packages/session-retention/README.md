# @clawsjoy/dsh-session-retention

The DSH jsonl session backend with the **size-cap rotation neutralised by default**.

## Why

DSH's jsonl backend rotates a log that crosses `maxLogBytes` (50 MiB default) by
renaming it aside and re-materialising a **header-only** live file. The live log
therefore continues from a **non-zero seq**, and the session loader refuses such
a log:

```
corrupt session log: seq gap in committed region at line 1
(expected 0, got 5528588)
```

Measured on a real session (2026-09-22): the session stayed **listable but
unopenable** — the worst kind of failure, because nothing in the UI or the logs
explains it. Repair required splicing the archived half back in by hand.

## What this plugin does

It **extends** `JsonlSessionPersistence` and changes exactly one thing: the
`maxLogBytes` handed to the backend.

| | upstream jsonl | this plugin |
|---|---|---|
| size cap | 50 MiB, rotation | **effectively unlimited** (1 TiB) unless you opt in |
| whole-session count cap (`maxSessionsPerProject`) | inherited | **inherited** (safe: prunes whole sessions, never truncates a log) |
| everything else (service key, config schema, create/append/load/repair) | — | inherited |

Opting back into rotation is a deliberate, documented choice: set
`maxLogBytes` explicitly and it is honoured (the log line in `retention.reason`
records that it was an opt-in).

## Install

```sh
dsh plugin add --profile web @clawsjoy/dsh-session-retention
```

```yaml
- id: session-persistence-jsonl
  disabled: true
- insert:
    - id: session-retention
      name: '@clawsjoy/dsh-session-retention'
      config:
        root: !!js dshHomePath('sessions')
        # maxSessionsPerProject: 50    # whole-session pruning (safe)
        # maxLogBytes: 209715200       # opt in to rotation — see "Why" first
```

## Verification

```sh
pnpm test
```

The suite's negative control asserts the upstream default **would** rotate a
65 MiB log — the size that actually broke a session — while this plugin's
resolved cap does not.

## License

MIT
