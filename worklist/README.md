# Worklist

This folder contains execution-ready task instructions for multi-terminal, multi-agent runs.

## Included Scenario

- `worklist/tetris-4-agent/`
- Goal: build a playable Tetris feature with 4 parallel roles.

## Recommended Run Mode (4 terminals)

1. Read `worklist/tetris-4-agent/00-runbook.md`.
2. Create isolated working directories with:
   - `worklist/tetris-4-agent/setup-worktrees.ps1`
3. Open 4 terminals, one per worktree.
4. In each terminal, execute only one role document:
   - Terminal 1 -> `01-agent-product-scope.md`
   - Terminal 2 -> `02-agent-core-engine.md`
   - Terminal 3 -> `03-agent-ui-input.md`
   - Terminal 4 -> `04-agent-qa-release.md`
5. Integrate using `90-integration-checklist.md`.

