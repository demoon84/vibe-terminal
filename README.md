# Vibe Terminal

Electron based multi-pane terminal app for coding agents (`Codex`, `Claude`, `Gemini`).

## Development

```bash
npm install
npm run electron:start
```

## Main Features

- Multi-pane presets: `2`, `4`, `6`, `8` splits.
- Per-pane agent controls and global mount controls.
- Global path apply and status line feedback.
- Skill manager UI (installed/recommended/search, install/uninstall).
- AGENTS policy editor UI (`AGENTS.md` read/edit/save/open in system editor).
- Terminal font sizing and preview overlay.

## Update History

### 2026-02-20 (working tree)

#### UI / UX

- Added titlebar utility actions: `스킬관리`, `규칙설정`, `폰트`, `모두종료`.
- Added `Skill Manager` overlay and `AGENTS.md` editor overlay.
- Improved split view visuals by tuning pane grid separators (`gap/background`) to reduce blank spacing artifacts.

#### Agent Mounting

- Updated global mount flow so target agent mount can switch from a running agent by stopping active agents first, then remounting.
- Kept global mount buttons visible during normal operation and improved disabled states during stop flow.
- Improved status messages for mount/stop/switch outcomes.

#### AGENTS.md Policy Management

- Added IPC channels and preload bridges for policy read/write/open-editor actions.
- Added stale-version protection (mtime check) on policy save to avoid accidental overwrite.
- Added validator for policy write payload shape and size.

#### Skill Management

- Added IPC channels and preload bridges for skill catalog/install/uninstall.
- Added payload validation for skill search/install/uninstall requests.
- Added curated skill listing + `skills.sh` search integration and UI refresh flow.

#### Runtime / Stability

- Added terminal snapshot trailing-empty-line trimming to avoid excessive vertical blank area after pane re-render/restore.
- Added clipboard IPC rate limiting and trusted renderer checks on new handlers.
- Removed unused `3x12` preset constant from shared preset IDs.

#### Touched Files

- `.gitignore`
- `src/main/ipc-validators.js`
- `src/main/main.js`
- `src/preload/preload.js`
- `src/renderer/index.html`
- `src/renderer/renderer.js`
- `src/renderer/styles.css`
- `src/shared/ipc-channels.js`
- `src/shared/models.js`

### 2026-02-20 (post-adjustments)

#### Window Controls / Layout

- Kept window control buttons fully inside the titlebar by aligning control container/button height to titlebar bounds.
- Reduced window control button height (effective 6px reduction from titlebar height) for better vertical balance.
- Set window startup width and minimum width to `1400` to preserve titlebar usability at narrow sizes.

#### AGENTS Guide

- Refined `AGENTS.md` structure for readability and reduced duplication.
- Added role-based execution rules (`executor`, `verifier`, `code-reviewer`, `debugger`, `explore`).
- Added explicit workflow rule: when git is connected, always commit completed work to preserve history.

#### Touched Files

- `AGENTS.md`
- `src/main/main.js`
- `src/renderer/styles.css`
