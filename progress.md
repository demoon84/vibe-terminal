# Progress

- 4분할 요구사항을 다시 정리한 결과, 필요한 것은 `2x2` 고정 swap이 아니라 비대칭 `stack` variant라는 점을 확인했다.
- `src/renderer/renderer.js`에서 4분할 allowed variant 목록에 `stack-left/right/top/bottom`을 추가하고, `3x2`/`2x3` shape 및 pane placement를 정의했다.
- 같은 파일에서 target pane의 현재 위치를 기준으로 4분할 preferred variant를 정하도록 `getPreferredFourPaneLayoutVariants`를 다시 구성했다.
- `src/main/layout-manager.js`에서도 같은 4분할 variant와 `3x2`/`2x3` shape를 허용하도록 맞춰 저장/복원 경로가 renderer 계산을 유지하게 했다.
- 메인 프로세스 재시작 전에는 manual persist조차 `grid`로 내려앉는 것을 확인했고, 재시작 후에는 `stack-right`가 정상 저장/복원되는 것을 확인했다.
- `node --check src/renderer/renderer.js`, `node --check src/main/layout-manager.js`, `git diff --check -- src/renderer/renderer.js src/main/layout-manager.js CHANGELOG.md task_plan.md findings.md progress.md`를 실행해 통과했다.
- `node --experimental-websocket /tmp/vt_verify_four_pane.mjs`로 실제 UI drag를 재현했고, 사용자 예시 `A -> C left`가 `stack-right(3x2)`와 `order=[A,C,B,D]`로 반영되는 것을 확인했다.
- 넓은 synthetic drag 매트릭스는 대부분 일치했지만, 일부 외곽 `top/bottom` edge case는 synthetic hit-test 경계 영향으로 추가 확인 여지가 남아 있다.
