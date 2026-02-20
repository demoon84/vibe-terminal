# vibe-terminal-layout-system

Electron-first multi-pane terminal for long-running agent workflows (Codex, Claude, Gemini), with tmux-based session orchestration and an optional legacy HTTP/WebSocket runtime.

## Purpose

This repository provides:

- an Electron desktop app (`src/main`, `src/preload`, `src/renderer`)
- PTY/tmux orchestration with layout presets
- agent CLI integration and runtime dependency checks
- an optional legacy server runtime (`server/`)

## Key Features

- Preset layouts: `1x2`, `1x4`, `2x6`, `2x8`, `3x12`
- Layout/session managers keep visible panes mapped to PTY or tmux sessions
- Startup checks/install helpers for `tmux`, PowerShell 7 (Windows), Node.js, and agent CLIs
- GUI PATH augmentation for Homebrew, `~/.nvm`, `~/.volta`, and `~/.local/bin`
- UTF-8 terminal locale fallback for stable prompt rendering
- Hardened main/renderer boundary (sandboxed renderer, IPC validation/trust guards, clipboard rate limiting)
- Optional Express + WebSocket server for legacy workflows

## Requirements

- Node.js 20+
- npm
- tmux (recommended for stable multi-session behavior)

Install tmux:

```bash
# macOS
brew install tmux

# Windows
winget install --id GnuWin32.Tmux --source winget -e
```

## Install

```bash
npm install
```

## Run

Electron app:

```bash
npm run electron:start
```

Electron dev mode:

```bash
npm run electron:dev
```

tmux-first Electron launch:

```bash
npm run electron:tmux
```

- Default tmux session: `vibe-terminal-dev`
- Override via env: `TMUX_SESSION_NAME=<name> npm run electron:tmux`

Legacy server runtime (optional):

```bash
npm run dev   # watch mode
npm start     # production mode
```

Open: `http://localhost:4310`

## Environment Variables (Legacy Server)

Configuration is loaded from `.env*` files (`.env.<env>.local` -> `.env.local` -> `.env.<env>` -> `.env`) and process env.

Important keys:

- `API_TOKEN`
- `REQUIRE_API_TOKEN_FOR_LOOPBACK`
- `ALLOWED_ORIGINS`, `ALLOWED_ORIGINS_DEV`, `ALLOWED_ORIGINS_STAGE`, `ALLOWED_ORIGINS_PROD`
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`
- `WS_RATE_LIMIT_WINDOW_MS`, `WS_RATE_LIMIT_MAX_MESSAGES`
- `COMMAND_ALLOWLIST`, `COMMAND_APPROVAL_TOKEN`
- `PERSIST_COMMAND_IN_WORKSET`, `PERSIST_ENV_IN_WORKSET`
- `MASK_SENSITIVE_ENV_VALUES`

## Security and Session Guardrails

- Token-based authorization for API/WS flows (`Authorization` or `x-api-token`)
- Environment-aware loopback token policy (`REQUIRE_API_TOKEN_FOR_LOOPBACK`)
- Origin allowlist enforcement (`ALLOWED_ORIGINS*`)
- HTTP/WS rate limiting plus periodic bucket cleanup
- Command gating with allowlist/approval token controls
- Sensitive env masking and persistence controls for stored worksets
- Window-close session cleanup and renderer isolation

## Validation and Tests

```bash
npm run check
npm test
npm run security:deps
```

Focused security regression:

```bash
npm test -- test/security-regression.test.js
```

## Build and Packaging

```bash
npm run rebuild:native
npm run package           # Windows portable
npm run package:installer # Windows NSIS installer
npm run package:dir       # Windows unpacked dir
npm run package:mac       # macOS DMG
npm run package:mac:dir   # macOS unpacked dir
```

Artifacts are generated under `release/`.

## Project Structure

- `src/main/`: Electron main process, layout/session managers, IPC router/validators/trust guard
- `src/preload/`: renderer bridge API
- `src/renderer/`: terminal UI and client behavior
- `src/shared/`: shared models and IPC channel constants
- `server/`: legacy Express + WebSocket runtime, security config, telemetry, panel manager
- `scripts/`: launch/check/security utility scripts
- `docs/`: IPC, security, and state-machine documentation
- `test/`: regression and unit test suites
- `public/`, `assets/`, `data/`: static assets, build resources, persisted runtime data

## Key Files

- `src/main/main.js`
- `src/main/session-manager.js`
- `src/main/layout-manager.js`
- `src/main/ipc-router.js`
- `src/main/ipc-validators.js`
- `src/main/path-utils.js`
- `server/config.js`
- `server/panelManager.js`
- `scripts/run-electron-with-tmux.sh`
- `docs/ipc-contract.md`
- `docs/state-machines.md`

## Troubleshooting

- `preset failed ... tmux unavailable ... ENOENT`
  - Install tmux and relaunch.
  - Verify with `command -v tmux`.
- `Codex install failed: npm-not-found`
  - Confirm npm is installed (`npm -v`).
  - Relaunch from latest build with PATH fallback support.
- Prompt text appears garbled (`M-^D...` style)
  - Use the latest build with UTF-8 fallback enabled.
