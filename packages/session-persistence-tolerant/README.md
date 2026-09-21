# @clawsjoy/dsh-session-persistence-tolerant

A listing-tolerance decorator over DSH's official jsonl session backend
(`@deepseek-ai/dsh-session-persistence-jsonl`).

## The problem

DSH's session listing reads only each artifact's **first frame**:

- a frame it cannot decode is **rethrown** — one damaged log fails the whole
  listing (and on the boot path, `WorkspaceRegistry` lists during plugin init,
  so a failed listing is a failed plugin-tree load);
- a first frame that is not a session header is **silently skipped** — the
  conversation leaves the sidebar with no error, no log line, no counter.

Both are invisible in practice: the only symptom is "a conversation is
missing".

## What this plugin does

It **extends** `JsonlSessionPersistence` and overrides the listing path only.
Create / append / load / repair / the service key / the config schema all stay
the official implementation, so upstream changes to those paths arrive for
free.

- On a successful listing, it diffs the listing against a tolerant scan of the
  root and reports every artifact that was skipped silently.
- When the listing throws, it salvages every listable session instead of
  returning nothing.
- Faults surface two ways: `listFaults()` on the service instance, and an
  append-only JSONL sink (deduped per fault set) so a vanished conversation
  leaves a trace even when nobody asks.

The scan reads the session id and cwd **from the artifact**, and only assumes
`<root>/<project>/<session>/session.jsonl[.zstd]` plus "first decompressed
line is the header" — so a change to the directory-naming scheme does not break
it.

## Install

Published on npm as [`@clawsjoy/dsh-session-persistence-tolerant`](https://www.npmjs.com/package/@clawsjoy/dsh-session-persistence-tolerant)
(MIT, no runtime dependencies):

```sh
dsh plugin --profile web add @clawsjoy/dsh-session-persistence-tolerant
```

Installing straight from this repository works too, so nothing here depends on a
registry release:

```sh
dsh plugin --profile web add github:ClawsJoy/dsh-plugins#path:packages/session-persistence-tolerant
```

Swap the official row for this one in `~/.dsh/profiles/web/cordis.patch.yml`
(the row is disabled, never modified):

```yaml
- id: session-persistence-jsonl
  disabled: true
- insert:
    - id: session-persistence-tolerant
      name: '@clawsjoy/dsh-session-persistence-tolerant'
      config:
        root: !!js dshHomePath('sessions')
```

The `config` is the official backend's schema, unchanged.

## Environment

| Variable | Effect |
|---|---|
| `DSH_SESSION_LIST_FAULT_SINK` | Overrides the fault sink path (default `$DSH_HOME/logs/dsh-session-list-faults.jsonl`). |
| `DSH_SESSION_LIST_TOLERANT=off` | Restores the official behaviour exactly — the production negative control. |

## Verification

```sh
pnpm test
```

The suite includes the negative control: the same artifact tree that makes the
official listing shape throw is the tree this plugin lists and reports.

## License

MIT
