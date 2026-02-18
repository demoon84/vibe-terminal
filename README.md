# vibe-terminal-layout-system

Electron-based multi-pane terminal app for long-running agent workflows.

## What this repo includes

- Electron app (`src/main`, `src/preload`, `src/renderer`)
- PTY/tmux session orchestration with preset layouts (`1x2`, `1x4`, `2x6`, `2x8`, `3x12`)
- Agent runtime integration (Codex / Claude / Gemini)
- Legacy web server runtime (`server/`)

## Requirements

- Node.js 20+
- npm
- tmux (recommended/required for stable multi-session behavior)

Install tmux:

```bash
# macOS
brew install tmux

# Windows
winget install --id GnuWin32.Tmux --source winget -e
```

## Quick start (Electron)

```bash
npm install
npm run electron:start
```

Development mode:

```bash
npm run electron:dev
```

tmux-first workflow:

```bash
npm run electron:tmux
```

- Default tmux session name: `vibe-terminal-dev`
- Override: `TMUX_SESSION_NAME=<name> npm run electron:tmux`

## Auto dependency checks at app startup

The app can validate/install runtime dependencies from the UI startup flow:

- `tmux`
- PowerShell 7 (Windows)
- Node.js runtime
- Agent CLIs (Codex / Claude / Gemini)

Recent runtime hardening included in this branch:

- GUI PATH augmentation for macOS/Linux (Homebrew + user tool bins like `~/.nvm`, `~/.volta`, `~/.local/bin`)
- Resolved npm execution path for agent auto-install (prevents `npm-not-found` in GUI launch contexts)
- UTF-8 locale fallback in terminal sessions (prevents mojibake prompt rendering)

## Packaging

### macOS DMG

```bash
npx electron-builder --mac dmg
```

Output:

- `release/Vibe Terminal-<version>-arm64.dmg`
- `release/Vibe Terminal-<version>-arm64.dmg.blockmap`

### Windows

```bash
npm run package          # portable
npm run package:installer # nsis
npm run package:dir
```

## Validation commands

```bash
npm run check
npm test
npm run security:deps
```

## Legacy web runtime (optional)

```bash
npm install
npm start
```

Open: `http://localhost:4310`

## Key files

- `src/main/main.js`
- `src/main/session-manager.js`
- `src/main/layout-manager.js`
- `src/main/path-utils.js`
- `src/preload/preload.js`
- `src/renderer/renderer.js`
- `scripts/run-electron-with-tmux.sh`
- `docs/ipc-contract.md`
- `docs/state-machines.md`

## Troubleshooting

- `preset failed ... tmux unavailable ... ENOENT`
  - Install tmux and relaunch app.
  - Confirm `tmux` is available in your shell: `command -v tmux`.

- `Codex install failed: npm-not-found`
  - Confirm npm is installed: `npm -v`.
  - Relaunch with the latest build (includes GUI PATH fallback for nvm/volta/homebrew).

- Prompt text appears garbled (`M-^D...` style)
  - Use the latest build in this branch; UTF-8 locale fallback is now enforced for terminal sessions.

- Dock icon size differs between idle/running on macOS
  - Use the latest packaged app; runtime dock icon override was removed so running state uses bundle icon consistently.
