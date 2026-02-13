# Integration Checklist

Use this after all 4 role documents are completed.

## Merge Order

1. Merge Agent 1 contract changes first.
2. Rebase Agent 2 and Agent 3 onto merged contract.
3. Merge Agent 2 (engine), then Agent 3 (UI).
4. Merge Agent 4 tests and quality docs last.

## Mandatory Checks

```powershell
npm run check
npm test
```

## Manual Playtest

- Start one game session.
- Confirm move, rotate, soft drop, hard drop.
- Confirm line clear changes score.
- Confirm game over and restart behavior.

## Sign-off Template

Record this in `worklist/tetris-4-agent/status-board.md`:

- Contract status: pass/fail
- Engine status: pass/fail
- UI status: pass/fail
- QA status: pass/fail
- Final decision: `go` or `hold`

