# Findings

- 사용자가 원하는 4분할 동작은 `2x2` 안의 자리 교환이 아니라, `A | C | (B/D)`처럼 `3칸 + 마지막 칸 2분할` 비대칭 배치였다.
- 기존 4분할 모델은 `grid`, `row`, `column`만 지원해서 이 형태를 표현할 수 없었다.
- renderer에서 4분할 `stack-right`를 계산해도, main `layout-manager`가 `3x2`/`2x3` shape를 허용하지 않아 저장 시 `grid(2x2)`로 되돌아갔다.
- 해결에는 renderer/main 모두에서 4분할 `stack-left/right/top/bottom` variant, 대응 grid shape(`3x2`, `2x3`), pane placement를 함께 추가해야 했다.
- preferred variant는 drop edge만으로 고정하지 않고, target pane의 현재 위치를 같이 봐야 사용자가 기대한 비대칭 방향이 자연스럽게 선택된다.
- 메인 프로세스를 재시작한 뒤 remote-debugging 기반 synthetic `PointerEvent` 검증에서 사용자 예시 `A -> C left`가 `layoutVariant=stack-right`, `gridShape={ columns: 3, rows: 2 }`, `order=[A,C,B,D]`로 실제 반영되는 것을 확인했다.
- 넓은 synthetic drag 매트릭스도 대부분 일치했지만, 일부 외곽 `top/bottom` edge 케이스는 synthetic hit-test 경계 영향으로 추가 확인 여지가 남아 있다.
