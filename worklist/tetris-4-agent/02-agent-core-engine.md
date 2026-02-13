# Agent 2 - Core Gameplay Engine

## Objective

Implement pure game logic for Tetris using the contract from Agent 1.

## Owned Outputs

- `src/tetris/engine/engine.ts`
- `src/tetris/engine/pieces.ts`
- `src/tetris/engine/board.ts`
- `worklist/tetris-4-agent/status-board.md` update (Agent 2 section)

## Required Features

- 10x20 board representation
- Tetromino spawn and queue (simple random is acceptable for sample)
- Move left/right/down with collision checks
- Rotate with wall kick fallback (basic version acceptable)
- Hard drop
- Lock piece and clear lines
- Score updates by number of cleared lines
- Game-over detection on spawn collision

## Constraints

- Keep engine logic UI-agnostic.
- Export only contract-compatible APIs.
- Do not directly touch DOM or Canvas APIs.

## Acceptance Criteria

- Engine can run from tests without browser context.
- `tick()` advances game state deterministically.
- Line clear and game-over cases are covered by tests from Agent 4.

## Handoff

Append to `worklist/tetris-4-agent/status-board.md`:

- Implemented files
- Known edge cases
- API changes requested (if unavoidable)

