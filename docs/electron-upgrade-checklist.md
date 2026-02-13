# Electron Upgrade Execution Checklist

Date: 2026-02-12
Project: `vibe-terminal-layout-system`

## Ordered Steps

- [x] 1. Baseline capture
  - Current electron: `30.5.1` (`^30.0.0` in `package.json`)
  - Latest electron: `40.4.0` (`npm view electron version`)
  - Node runtime: `v20.19.4`

- [x] 2. Baseline validation before changes
  - `npm test` passed
  - `npm run check` passed

- [ ] 3. Upgrade Electron dependency to latest stable
  - Update `devDependencies.electron` to `^40.4.0`
  - Refresh lockfile

- [ ] 4. Verify runtime and API compatibility
  - Run syntax check
  - Run tests
  - Ensure app entry (`src/main/main.js`) has no breaking API usage

- [ ] 5. Verify packaging path
  - Run packaging dry path (`npm run package:dir`)

- [ ] 6. Finalize
  - Record outcomes and residual risks