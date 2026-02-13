# Agent 4 - QA, Tests, and Release Guardrails

## Objective

Protect quality while other agents move fast by building tests and release checks early.

## Owned Outputs

- `test/tetris/engine.test.js`
- `test/tetris/ui-smoke.test.js`
- `docs/tetris-test-plan.md`
- `worklist/tetris-4-agent/status-board.md` update (Agent 4 section)

## Required Coverage

- Engine tests:
  - collision rules
  - line clear scoring
  - game-over detection
- UI smoke tests:
  - controls call expected engine methods
  - restart path resets state

## Commands to Verify

```powershell
npm run check
npm test
```

## Constraints

- Keep tests stable and deterministic.
- Mock UI dependencies where needed; avoid flaky timing checks.

## Acceptance Criteria

- Failing gameplay bug reproductions get a test first where feasible.
- Test docs describe what is intentionally not covered.
- Final report lists remaining risks clearly.

## Handoff

Append to `worklist/tetris-4-agent/status-board.md`:

- Added test files and command outputs
- Remaining risk list
- Release recommendation (`go` or `hold`)

