# Agent 3 - UI and Input Layer

## Objective

Build the playable UI shell that consumes the game engine contract.

## Owned Outputs

- `src/tetris/ui/tetris-view.ts`
- `src/tetris/ui/controls.ts`
- `src/tetris/index.ts`
- `worklist/tetris-4-agent/status-board.md` update (Agent 3 section)

## Required Features

- Render board state visually (text mode or canvas is both acceptable)
- Bind keyboard controls:
  - Left / Right
  - Soft drop
  - Rotate
  - Hard drop
  - Restart
- Show score and status (`running`, `paused`, `game_over`)
- Game loop timer calling `tick()`

## Constraints

- UI must consume `GameEngine` interface only.
- Do not re-implement engine logic in UI code.
- Keep input mapping configurable in one place.

## Acceptance Criteria

- User can start a session and play complete rounds.
- Input responsiveness is acceptable under normal local run.
- UI still works when engine internals change but contract remains stable.

## Handoff

Append to `worklist/tetris-4-agent/status-board.md`:

- Entry point and run instructions
- Any temporary UI limitations
- Integration assumptions made

