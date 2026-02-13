# IPC Contract

Reference date: 2026-02-11  
Version: v0.1

## Channels

| Channel | Direction | Payload | Response | Purpose |
|---|---|---|---|---|
| `pty:create` | Renderer -> Main (`invoke`) | `{ cwd?, shell?, env?, cols?, rows?, sessionId? }` | `Session` | Create PTY session |
| `pty:write` | Renderer -> Main (`send`) | `{ sessionId, data }` | none | Write stdin to PTY |
| `pty:resize` | Renderer -> Main (`invoke`) | `{ sessionId, cols, rows }` | `Session` | Resize PTY |
| `pty:kill` | Renderer -> Main (`invoke`) | `{ sessionId, reason? }` | `{ killed, reason }` | Stop PTY session |
| `layout:setPreset` | Renderer -> Main (`invoke`) | `{ presetId, options?, sessionDefaults? }` | `LayoutSnapshot` | Rebuild panes/sessions from preset |
| `layout:save` | Renderer -> Main (`invoke`) | `{ presetId?, panes?, gridTracks? }` | `LayoutSnapshot` | Persist current layout |
| `layout:restore` | Renderer -> Main (`invoke`) | none | `{ restored, layout }` | Restore persisted layout |
| `pty:data` | Main -> Renderer (`event`) | `{ sessionId, data }` | - | Stream PTY output |
| `pty:status` | Main -> Renderer (`event`) | `Session` | - | Broadcast session status updates |
| `pty:exit` | Main -> Renderer (`event`) | `{ sessionId, exitCode, signal, status }` | - | Notify session exit |
| `app:renderer-unloading` | Renderer -> Main (`send`) | none | none | Trigger cleanup before reload/close |

## Models

### Session

```json
{
  "id": "session-uuid",
  "cwd": "D:\\project\\vibe-terminal",
  "shell": "pwsh.exe",
  "env": {},
  "cols": 120,
  "rows": 36,
  "status": "running",
  "lastActiveAt": 1739289600000
}
```

### Pane

```json
{
  "id": "pane-uuid",
  "sessionId": "session-uuid",
  "positionIndex": 0,
  "groupId": "row-1"
}
```

### LayoutSnapshot

```json
{
  "presetId": "2x6",
  "panes": [],
  "sessions": [],
  "gridTracks": {
    "columns": [33.33, 33.33, 33.34],
    "rows": [50, 50]
  }
}
```

## Error handling

- Main throws for invalid `presetId` or missing/invalid session targets.
- Renderer catches `invoke` failures and surfaces them in the status line.
- `pty:write` is fire-and-forget; invalid writes are ignored or handled internally in Main.
