# Tetris 4-Agent Runbook

Use this runbook when 4 people (or 4 terminal sessions) build one Tetris feature set in parallel.

## Common Rules

- Scope all new code under `src/tetris/` and `test/tetris/`.
- Do not modify unrelated production features outside Tetris paths.
- Keep commits small and role-specific.
- Every role must leave a short handoff note in `worklist/tetris-4-agent/status-board.md`.

## Role Files

- Agent 1: `01-agent-product-scope.md`
- Agent 2: `02-agent-core-engine.md`
- Agent 3: `03-agent-ui-input.md`
- Agent 4: `04-agent-qa-release.md`

## Suggested Sequence

1. Agent 1 publishes the API contract first.
2. Agent 2 and Agent 3 implement in parallel against the contract.
3. Agent 4 adds tests/checks continuously, not only at the end.
4. Run integration checklist in `90-integration-checklist.md`.

## Commands (example)

```powershell
npm install
npm run check
npm test
```

## Definition of Done

- Playable Tetris loop exists (spawn, move, rotate, drop, lock, clear).
- Controls work from keyboard.
- Score and game-over states are visible.
- Tests and syntax checks pass.
- Handoff notes are complete for all 4 agents.

