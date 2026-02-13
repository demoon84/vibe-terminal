# Session and Pane State Machines

Reference date: 2026-02-11

## 1) Session machine

States:

- `creating`
- `running`
- `stopping`
- `stopped`
- `recovering`
- `errored`

Transitions:

1. `creating -> running` when PTY spawn succeeds.
2. `creating -> errored` when PTY spawn fails.
3. `running -> stopping` on `pty:kill`, window close, reload, or app shutdown.
4. `stopping -> stopped` on PTY `onExit` after managed cleanup.
5. `running -> errored` on unexpected PTY exit.
6. `stopped -> recovering` when restore starts.
7. `errored -> recovering` when recovery is attempted.
8. `recovering -> running` when recovery spawn succeeds.
9. `recovering -> errored` when recovery spawn fails.

Rules:

- `lastActiveAt` is updated on write/data/resize activity.
- Shared cleanup routine is called on `window-close`, `before-quit`, and `renderer-unloading`.

## 2) Pane machine

Pane is a UI container linked to a session.

States:

- `unbound` (`sessionId = null`)
- `bound` (`sessionId != null`)
- `detached` (bound session exited with `stopped` or `errored`)

Transitions:

1. `unbound -> bound` when preset/restore assigns a session.
2. `bound -> detached` when bound session exits.
3. `detached -> bound` when a new/recovered session is attached.
4. `bound -> unbound` on explicit unbind/delete flows (extension point).

Pane data model baseline:

- `Pane { id, sessionId, positionIndex, groupId }`

## 3) Window and session lifecycle

Startup:

1. Try `layout:restore`.
2. If no saved layout, apply default preset (`1x4`).
3. Preset can be switched at runtime (`1x2`, `1x4`, `2x6`, `2x8`, `3x12`).

Close/reload:

1. Renderer `beforeunload` sends `app:renderer-unloading`.
2. Main runs cleanup routine (`cleanupAll`).
3. PTY processes are terminated before teardown to prevent orphan PTYs.

Restore:

1. Load persisted `LayoutSnapshot`.
2. Recreate sessions from session snapshots per pane.
3. Use fallback new sessions if recovery fails for specific panes.
