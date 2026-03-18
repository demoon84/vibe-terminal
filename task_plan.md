# Task Plan

## Goal

4분할 pane drag에서 `A를 C 왼쪽으로 drop -> A | C | (B 위 / D 아래)` 같은 비대칭 배치를 만들 수 있도록, 4분할에도 `stack-left/right/top/bottom` variant와 `3x2`/`2x3` grid shape를 추가한다.

## Checklist

- DONE Scope: 사용자가 원하는 동작이 `2x2` 고정 swap이 아니라 `3칸 + 마지막 칸 2분할` 비대칭 조합이라는 점을 예시로 재확인
- DONE Root Cause: 4분할 layout model이 `grid/row/column`만 지원했고, main save 경로도 `3x2`/`2x3` shape를 허용하지 않아 비대칭 상태가 저장 중 `grid`로 눌리던 점 확인
- DONE Design: 4분할에도 `stack-left/right/top/bottom` variant를 추가하고, target pane의 현재 위치를 기준으로 preferred variant를 고르도록 규칙 정리
- DONE Refactor: `src/renderer/renderer.js`와 `src/main/layout-manager.js`에서 4분할 allowed variant, grid shape, pane placement, normalize 경로를 확장
- DONE Verification: 메인 프로세스를 재시작한 뒤 `node --experimental-websocket /tmp/vt_verify_four_pane.mjs`로 실제 UI drag와 사용자 예시를 재검증하고, `A -> C left`가 `stack-right(3x2)`로 반영되는 것을 확인

## Notes

- 이번 범위는 자유 도킹 엔진 전체가 아니라, 4분할 preset 안에서 필요한 비대칭 variant를 명시 추가하는 작업이다.
- 저장/복원 경로까지 같이 바꾸지 않으면 renderer가 `stack-right`를 계산해도 main에서 `grid`로 되돌려버린다.
