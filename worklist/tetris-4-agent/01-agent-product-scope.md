# Agent 1 - Product Scope and Contracts

## Objective

Define the gameplay contract so other agents can implement in parallel with minimal merge conflicts.

## Owned Outputs

- `docs/tetris-spec.md`
- `src/tetris/contracts.ts`
- `worklist/tetris-4-agent/status-board.md` update (Agent 1 section)

## Required Contract

In `src/tetris/contracts.ts`, define and export:

- `BoardState`
- `PieceType`
- `Direction`
- `GameStatus`
- `GameEngine` interface with methods:
  - `start()`
  - `tick()`
  - `move(direction)`
  - `rotate(clockwise)`
  - `hardDrop()`
  - `getSnapshot()`

## Non-Goals

- Do not implement physics or rendering logic.
- Do not add external dependencies.

## Acceptance Criteria

- Spec and interfaces are clear enough that Agent 2 and Agent 3 can code without guessing behavior.
- Naming and function signatures are stable after first publish.

## Handoff

Append to `worklist/tetris-4-agent/status-board.md`:

- What was finalized
- Any open decisions
- Final interface signatures

