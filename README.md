# vibe-terminal-layout-system

4-agent terminal orchestration app focused on uninterrupted multi-task workflows.

## Electron Scaffold (New)

This repository now includes an Electron app skeleton for multi-pane terminal sessions:

- Main process: window lifecycle, PTY process lifecycle, IPC routing.
- Renderer process: preset-based pane UI, keyboard input forwarding, output rendering.
- Session lifecycle guardrails: cleanup on window close/reload to prevent orphan PTYs.
- Layout lifecycle: preset switching (`1x2`, `1x4`, `2x6`, `2x8`, `3x12`) and restore/save flow.

### Electron Runtime

```bash
npm install
npm run electron:start
npm run electron:dev
```

`electron:dev` watches `src/main` and restarts Electron when main process files change.

### Key Files

- `src/main/main.js`
- `src/main/session-manager.js`
- `src/main/layout-manager.js`
- `src/main/ipc-router.js`
- `src/preload/preload.js`
- `src/renderer/index.html`
- `src/renderer/renderer.js`
- `docs/ipc-contract.md`
- `docs/state-machines.md`

## Delivered Scope

- `4-Agent UX`
  - Fixed panels for `Agent A/B/C/D`
  - Panel status: `running` / `stopped`
  - Global controls: `Start All`, `Stop All`
  - Per-panel controls: `Start`, `Stop`, `Restart`
  - Output search (panel-level count + browser find)
  - Direct PTY input per panel

- `Workset presets`
  - Save/load by name
  - Saved fields per panel:
    - `cwd`
    - startup command
    - environment variables
    - label
    - `autoRestart`
    - terminal size (`cols`, `rows`)
    - running flag

- `Session resilience`
  - PTY crash detection
  - Optional auto restart after crash

- `Operational controls`
  - Resource limit: max concurrent PTYs (`MAX_PTYS`)
  - Resource limit: output buffer size per panel (`BUFFER_SIZE`)
  - Optional telemetry:
    - running panel count
    - panel resize events
    - PTY crash events

## Runtime

```bash
npm install
npm start
```

Open `http://localhost:4310`.

Security dependency scan:

```bash
npm run security:deps
```

## Environment Variables

- `PORT` (default: `4310`)
- `HOST` (default: `127.0.0.1`)
- `MAX_PTYS` (default: `4`)
- `BUFFER_SIZE` (default: `120000`)
- `AUTO_RESTART_DELAY_MS` (default: `1500`)
- `TELEMETRY_ENABLED` (default: `false`)
- `API_TOKEN` (optional, required when binding non-loopback host)
- `REQUIRE_API_TOKEN_FOR_LOOPBACK` (default: `false` in development, `true` in staging/production)
- `NODE_ENV` (`development` | `staging` | `production`, default: `development`)
- `ALLOWED_ORIGINS` (optional global override, comma-separated origins)
- `ALLOWED_ORIGINS_DEV` (optional, used when `NODE_ENV=development`)
- `ALLOWED_ORIGINS_STAGE` (optional, used when `NODE_ENV=staging`)
- `ALLOWED_ORIGINS_PROD` (optional, used when `NODE_ENV=production`)
- `RATE_LIMIT_WINDOW_MS` (default: `60000`)
- `RATE_LIMIT_MAX_REQUESTS` (default: `240`)
- `WS_RATE_LIMIT_WINDOW_MS` (default: `60000`)
- `WS_RATE_LIMIT_MAX_MESSAGES` (default: `400`)
- `COMMAND_ALLOWLIST` (optional command prefix list, comma-separated)
- `COMMAND_APPROVAL_TOKEN` (optional, required for dangerous command patterns)
- `PERSIST_COMMAND_IN_WORKSET` (default: `false`)
- `PERSIST_ENV_IN_WORKSET` (default: `false`)
- `MASK_SENSITIVE_ENV_VALUES` (default: `true`)

Environment templates:
- `.env.development.example`
- `.env.staging.example`
- `.env.production.example`

Server env loading order (highest priority first):
- `.env.<NODE_ENV>.local`
- `.env.local`
- `.env.<NODE_ENV>`
- `.env`

## Stored Data

Generated at runtime under `data/`:

- `data/worksets.json`: saved worksets
- `data/telemetry.log`: telemetry events in JSONL (when enabled)

By default, workset persistence does not store startup command/env values unless explicitly enabled.
