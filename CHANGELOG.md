# CHANGELOG

이 문서는 작업 이력을 기록한다.

## 2026-03-19
### 20) 4분할 pane 드래그에 비대칭 stack variant 추가
- 요청 요약: 4분할에서 단순 `2x2` 자리 교환이 아니라, `A를 C 왼쪽으로 drop -> A | C | (B 위 / D 아래)`처럼 `3칸 + 마지막 칸 2분할` 비대칭 배치를 만들 수 있도록 `stack-left/right/top/bottom` variant와 우선순위 규칙을 추가.
- 변경 파일: `src/renderer/renderer.js`, `src/main/layout-manager.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `node --check src/main/layout-manager.js` 통과, `git diff --check -- src/renderer/renderer.js src/main/layout-manager.js CHANGELOG.md task_plan.md findings.md progress.md` 통과, 메인 프로세스 재시작 후 `node --experimental-websocket /tmp/vt_verify_four_pane.mjs`로 실제 UI drag 재현 시 사용자 예시 `A -> C left`가 `layoutVariant=stack-right`, `gridShape=3x2`, `order=[A,C,B,D]`로 반영되는 것 확인. 같은 검증에서 대부분의 4분할 synthetic path는 일치했고, 일부 외곽 `top/bottom` edge synthetic case는 추가 확인 여지 있음.

## 2026-03-18

### 19) 4분할 pane 드래그가 1열/1행으로 붕괴하지 않도록 우선순위 수정
- 요청 요약: `1x4`의 기본 2x2 상태에서 pane 위치 변경 드래그를 하면 `grid` 안에서 슬롯만 바뀌어야 하는데, 좌우/상하 drop마다 `row` 또는 `column`으로 먼저 무너져 재배치가 비정상 동작하던 문제를 수정.
- 변경 파일: `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `git diff --check -- src/renderer/renderer.js` 통과, `--remote-debugging-port=9224` 검증 인스턴스에서 synthetic `PointerEvent` 재현으로 우측 드롭/하단 드롭 모두 `layoutVariant=grid`, `gridShape=2x2` 유지 상태에서 pane 순서만 변경되는 것 확인.

### 18) 3분할 드래그 의도 해석 경로를 단일 규칙으로 정리
- 요청 요약: 드래그 관련 코드를 전체 검수한 뒤 `insertMode` 잔재와 분산된 variant preference 분기를 정리하고, `row` 상태에서 `middle 아래 -> stack`, `outer 아래 -> 3row`가 일관되게 나오도록 3분할 drop intent 해석기를 통합.
- 변경 파일: `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `git diff --check -- src/renderer/renderer.js task_plan.md findings.md progress.md CHANGELOG.md` 통과, `--remote-debugging-port=9223` 검증 인스턴스에서 synthetic `PointerEvent` 재현으로 `row` 초기화 후 `middle-bottom => stack-left(2x2)`, `outer-bottom => gridRows=3` 확인.

### 17) 3분할 드래그에서 `3row(column)` 선택 가능하도록 드롭 힌트 분기 추가
- 요청 요약: `3분할` 드래그 규칙을 다시 정리해, `1x3(row)` 상태에서 middle pane 아래로 drop하면 비대칭 `stack` 조합이 되고 outer pane 아래로 drop하면 `3row(column)`이 되도록 분기.
- 변경 파일: `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `git diff --check -- src/renderer/renderer.js CHANGELOG.md` 통과, `--remote-debugging-port=9223` 검증 인스턴스에서 synthetic `PointerEvent` 재현으로 `row` 초기화 후 middle-bottom drop 시 `stack-left(2x2)`, outer-bottom drop 시 `gridRows=3` 전환 확인.

### 16) 패널 드래그 시작 영역을 헤더 전체로 확장
- 요청 요약: 패널 위치 재배치 드래그를 상단의 얇은 handle이 아니라 헤더 바 전체에서 시작할 수 있도록 바꾸고, 버튼/드롭다운 같은 인터랙티브 요소는 기존처럼 클릭되게 예외 처리.
- 변경 파일: `src/renderer/renderer.js`, `src/renderer/styles.css`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `git diff --check -- src/renderer/renderer.js src/renderer/styles.css CHANGELOG.md` 통과.

### 15) 3분할 패널 드래그를 비대칭 `1칸 + 2줄` 조합까지 확장
- 요청 요약: `3분할`에서 단순 가로/세로열 전환이 아니라, 한 pane을 다른 pane의 상/하/좌/우로 드롭해 `1칸 + 2줄` 형태의 비대칭 조합까지 만들 수 있도록 `layoutVariant` 저장/복원과 pane별 grid span 배치를 추가.
- 변경 파일: `src/renderer/renderer.js`, `src/renderer/styles.css`, `src/main/ipc-validators.js`, `src/main/ipc-router.js`, `src/main/layout-manager.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `node --check src/main/ipc-validators.js` 통과, `node --check src/main/ipc-router.js` 통과, `node --check src/main/layout-manager.js` 통과, `git diff --check -- src/renderer/renderer.js src/renderer/styles.css src/main/ipc-validators.js src/main/ipc-router.js src/main/layout-manager.js task_plan.md findings.md progress.md` 통과, `npm run package:dir` 통과.

### 14) 드롭 방향에 따라 패널 grid shape도 함께 전환되도록 조정
- 요청 요약: 기존 드래그 재배치가 pane 순서만 바꾸고 분할 격자 모양은 고정해 상하 분할이 생기지 않던 문제를 수정해, 좌우 drop은 가로 배치, 상하 drop은 세로 배치로 `gridShape`까지 함께 저장/복원되도록 정리.
- 변경 파일: `src/renderer/renderer.js`, `src/main/layout-manager.js`, `src/main/ipc-validators.js`, `src/main/ipc-router.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `node --check src/main/layout-manager.js` 통과, `node --check src/main/ipc-validators.js` 통과, `node --check src/main/ipc-router.js` 통과, `git diff --check -- src/renderer/renderer.js src/main/layout-manager.js src/main/ipc-validators.js src/main/ipc-router.js CHANGELOG.md task_plan.md findings.md progress.md` 통과, `npm run package:dir` 통과.

### 13) 패널 드래그를 위치 교환에서 드롭 방향 기준 순서 재배치로 변경
- 요청 요약: 패널 헤더 드래그 시 target pane의 좌/상 drop은 앞, 우/하 drop은 뒤로 해석해 2/3/4분할에서 상하 방향 드롭도 자연스럽게 pane 순서 변경으로 반영되도록 조정.
- 변경 파일: `src/renderer/renderer.js`, `src/renderer/styles.css`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `git diff --check -- src/renderer/renderer.js src/renderer/styles.css CHANGELOG.md task_plan.md findings.md progress.md` 통과, `npm run package:dir` 통과.

### 12) 패널 헤더 드래그로 터미널 위치 교환 지원
- 요청 요약: 패널 상단 바를 잡고 다른 패널 위로 드래그해 터미널 위치를 서로 교환할 수 있도록 렌더러 드래그 처리와 레이아웃 저장 경로를 추가.
- 변경 파일: `src/renderer/renderer.js`, `src/renderer/styles.css`, `src/main/ipc-validators.js`, `src/main/ipc-router.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `node --check src/main/ipc-validators.js` 통과, `node --check src/main/ipc-router.js` 통과, `git diff --check -- src/renderer/renderer.js src/renderer/styles.css src/main/ipc-validators.js src/main/ipc-router.js CHANGELOG.md` 통과, `npm run package:dir` 통과.

### 11) 에디터 드롭다운 선택 즉시 적용
- 요청 요약: 패널 상단 에디터 드롭다운에서 항목을 선택해도 실제 변경 처리가 되지 않던 문제를 수정해, 메뉴에서 선택하는 즉시 해당 에디터로 열기 동작이 실행되도록 정리.
- 변경 파일: `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `git diff --check -- src/renderer/renderer.js CHANGELOG.md` 통과.

### 10) 패널 상단 버튼 크기를 타이틀바 버튼 기준으로 축소
- 요청 요약: 패널 상단의 에이전트 버튼, 에디터 드롭다운, 유틸 버튼 크기를 타이틀바 버튼 기준(`22px` 높이/작은 패딩/작은 최소폭)으로 맞춤.
- 변경 파일: `src/renderer/styles.css`
- 검증 결과: `git diff --check -- src/renderer/styles.css CHANGELOG.md` 통과.

### 9) 패널 상단 액션 그룹 사이 간격 축소
- 요청 요약: 에디터 드롭다운과 `화면정리` 그룹 사이 여백이 커 보이던 문제를 줄이기 위해 패널 상단 액션 그룹의 gap을 축소.
- 변경 파일: `src/renderer/styles.css`
- 검증 결과: `git diff --check -- src/renderer/styles.css CHANGELOG.md` 통과.

### 8) 패널 상단 `모든권한` 버튼 제거
- 요청 요약: 패널 상단 액션 영역에서 `모든권한` 버튼을 제거해 에이전트/에디터/종료 관련 버튼만 남도록 정리.
- 변경 파일: `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `git diff --check -- src/renderer/renderer.js` 통과.

### 7) 터미널 본문 배경색을 청회색 톤으로 조정
- 요청 요약: 터미널 본문 배경을 더 어두운 청회색 톤으로 바꾸기 위해 pane 본문/푸터 배경과 xterm 테마 배경색을 동일한 색상으로 맞춤.
- 변경 파일: `src/renderer/styles.css`, `src/renderer/renderer.js`
- 검증 결과: `git diff --check -- src/renderer/styles.css src/renderer/renderer.js` 통과, `node --check src/renderer/renderer.js` 통과.

### 6) 패널 상단 액션 버튼을 프리셋 버튼 계열 스타일로 정리
- 요청 요약: 패널 상단의 `Codex/Claude/Gemini`와 우측 액션 버튼들을 개별 pill이 아니라 `1분할/2분할/3분할/4분할`처럼 세그먼트 박스 안에 들어간 flat 버튼 형태로 다시 정리.
- 변경 파일: `src/renderer/renderer.js`, `src/renderer/styles.css`
- 검증 결과: `git diff --check -- src/renderer/renderer.js src/renderer/styles.css` 통과, `node --check src/renderer/renderer.js` 통과.

### 5) 앱 종료 시 PTY 내부에서 띄운 Vibe Terminal 동반 종료 완화
- 요청 요약: 앱 재시작/종료 경로에서 PTY 세션 정리가 `node-pty` 자식 프로세스까지 같이 종료시키던 문제를 조사하고, 종료 직전에 PTY 하위의 Vibe Terminal 프로세스를 감지해 PTY 밖에서 지연 재실행하도록 보강.
- 변경 파일: `src/main/main.js`, `src/main/session-manager.js`
- 검증 결과: `node --check src/main/main.js` 통과, `node --check src/main/session-manager.js` 통과, `npm run electron:start -- --user-data-dir=/tmp/vibe-terminal-restart-smoke` 기동 확인 후 수동 종료, `node - <<'EOF' ... node-pty 최소 재현`에서 PTY 종료 시 자식 프로세스 동반 종료 현상 확인.

### 4) 터미널 렌더러 부트스트랩 중단과 4분할 프리셋 회귀 수정
- 요청 요약: 터미널이 보이지 않던 원인을 조사한 결과, 렌더러에서 삭제된 셸 메뉴 함수(`syncShellControls`)를 계속 호출해 레이아웃 복원이 중단되고 있었고, 동시에 공용 프리셋 ID에서 `1x4`가 누락돼 4분할 전환이 실패하던 문제를 함께 수정.
- 변경 파일: `src/renderer/renderer.js`, `src/shared/models.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `node --check src/shared/models.js` 통과, `npm run electron:start -- --user-data-dir=/tmp/vibe-terminal-dev-test2 --remote-debugging-port=9223` 스모크 실행 후 CDP 검증에서 `paneCount=1/xtermCount=1/preset=1x1` 확인, 같은 세션에서 `1x4` 버튼 클릭 후 `paneCount=4/xtermCount=4/preset=1x4` 확인.

### 1) 메인 윈도우 최소 크기 제한 제거
- 요청 요약: 메인 윈도우의 최소 너비/높이 제한을 제거해 사용자가 더 작은 크기로도 창을 줄일 수 있도록 수정.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `rg -n "minWidth|minHeight" src/main/main.js` 결과 없음으로 최소 크기 제한 제거 확인.

### 2) 분할 터미널 마우스 드래그 리사이즈 지원
- 요청 요약: 분할된 터미널 사이 경계를 마우스로 드래그해 열 너비/행 높이를 조절하고, 조절한 레이아웃을 저장/복원할 수 있도록 수정.
- 변경 파일: `src/shared/ipc-channels.js`, `src/preload/preload.js`, `src/main/ipc-validators.js`, `src/main/ipc-router.js`, `src/renderer/renderer.js`, `src/renderer/styles.css`
- 검증 결과: `node --check src/shared/ipc-channels.js` 통과, `node --check src/preload/preload.js` 통과, `node --check src/main/ipc-validators.js` 통과, `node --check src/main/ipc-router.js` 통과, `node --check src/renderer/renderer.js` 통과, `git diff --check` 통과, `npm run package:dir` 성공(종료코드 0), `rg -n "LAYOUT_SAVE|pane-grid-splitter|activeGridResize|layout\\.save\\(" src/shared/ipc-channels.js src/preload/preload.js src/main/ipc-router.js src/main/ipc-validators.js src/renderer/renderer.js src/renderer/styles.css`로 저장 IPC/드래그 스플리터 경로 반영 확인.

### 3) Ghostty 스타일 셸 프로필 전환과 attention 상태 표시 추가
- 요청 요약: Ghostty 느낌의 터미널 앱 방향으로 한 걸음 더 가기 위해 pane별 셸 프로필 전환(`PowerShell`/`CMD`/`WSL`/`zsh`/`bash` 등)과 확인 필요/완료/오류 attention 배지 및 강조 표시를 추가.
- 변경 파일: `README.md`, `src/shared/ipc-channels.js`, `src/preload/preload.js`, `src/main/main.js`, `src/main/session-manager.js`, `src/renderer/renderer.js`, `src/renderer/styles.css`
- 검증 결과: `node --check src/shared/ipc-channels.js` 통과, `node --check src/preload/preload.js` 통과, `node --check src/main/main.js` 통과, `node --check src/main/session-manager.js` 통과, `node --check src/renderer/renderer.js` 통과, `git diff --check` 통과, `npm run electron:start` 스모크 실행(종료코드 0) 확인.

## 2026-02-27
### 1) Windows PowerShell 세션의 `.CMD` 자기재귀 생성 방지
- 요청 요약: PowerShell 프로세스가 계속 늘어나는 원인을 조사한 결과, 세션 환경에서 `ComSpec/COMSPEC`을 `pwsh.exe`로 덮어써 `.CMD` 실행 시 `pwsh /c ...` 재귀 체인이 발생하던 문제를 수정.
- 변경 파일: `src/main/session-manager.js`
- 검증 결과: `node --check src/main/session-manager.js` 통과, `rg -n "ComSpec|COMSPEC|isPowerShell7\\(" src/main/session-manager.js` 결과 없음으로 관련 오버라이드 제거 확인, 프로세스 조사에서 `timeHook\\node_modules\\.bin\\tsc.CMD`/`eslint.CMD` 연쇄 생성 패턴과 `ComSpec=pwsh.exe` 상태 확인.

### 2) 작업 완료/확인 필요 상황의 OS 알림(Desktop Notification) 추가
- 요청 요약: 사용자 부재 시에도 상태를 인지할 수 있도록, 에이전트 세션 종료(완료/오류) 및 터미널 확인 프롬프트 감지 시 OS 알림을 보내는 경로를 추가.
- 변경 파일: `src/shared/ipc-channels.js`, `src/preload/preload.js`, `src/main/ipc-validators.js`, `src/main/main.js`, `src/renderer/renderer.js`
- 검증 결과: `node --check src/shared/ipc-channels.js` 통과, `node --check src/preload/preload.js` 통과, `node --check src/main/ipc-validators.js` 통과, `node --check src/main/main.js` 통과, `node --check src/renderer/renderer.js` 통과, `rg -n "APP_SHOW_NOTIFICATION|validateNotificationPayload|showDesktopNotification|maybeNotifyConfirmationRequired|maybeNotifySessionExit" src/shared/ipc-channels.js src/preload/preload.js src/main/ipc-validators.js src/main/main.js src/renderer/renderer.js`로 알림 채널/검증/트리거 경로 반영 확인.

### 3) 버전 `1.0.4` 상향 및 Windows 설치형 패키징 안정화
- 요청 요약: 버전을 `1.0.4`로 상향하고 설치형(NSIS) 패키징을 완료. Windows `node-pty` 재빌드 실패(`MSB8040`) 회피를 위해 `electron-builder`의 `npmRebuild`를 비활성화.
- 변경 파일: `package.json`
- 검증 결과: `node -p "require('./package.json').version"` 결과 `1.0.4`, `npm run package:installer` 성공(종료코드 0), 산출물 `release/Vibe Terminal Setup 1.0.4.exe` 생성 확인.

## 2026-02-26
### 1) 스킬관리/규칙설정/앱 전역 스크롤바 스타일 통일
- 요청 요약: 스킬관리 영역, 규칙 설정 스크롤 영역, 앱 전체 스크롤바를 동일한 커스텀 스타일로 통일.
- 변경 파일: `src/renderer/styles.css`
- 검증 결과: `rg -n -- "--scrollbar-size|\\*::-webkit-scrollbar|\\.skill-manager-card|\\.agents-policy-card|xterm-viewport" src/renderer/styles.css`로 전역/대상 영역 규칙 반영 확인, 수동 검증 절차(스킬관리/규칙설정/터미널 스크롤바 표시 및 hover 스타일 일치 여부 확인) 정의.

### 2) 스킬 재설치/에디터 열기/규칙 입력란 리사이즈 문제 수정
- 요청 요약: 스킬 삭제 후 재설치 실패를 완화하고, Windows 에디터 열기 실패를 수정하며, 규칙 설정 입력란의 리사이즈를 비활성화.
- 변경 파일: `src/main/main.js`, `src/renderer/renderer.js`, `src/renderer/styles.css`
- 검증 결과: `node --check src/main/main.js` 통과, `node --check src/renderer/renderer.js` 통과, `rg -n -- "resize: none|buildKnownEditors|resolveEditorLaunchCommand|cleanupStaleSkillInstallPaths|resolveInstalledSkillPath" src/renderer/styles.css src/main/main.js src/renderer/renderer.js`로 핵심 수정점 반영 확인.

### 3) 규칙 설정 외부 편집기 열기 Windows fallback 보강
- 요청 요약: `규칙 설정 > 외부 편집기`가 기본 연결 앱 실패 시에도 Windows에서 열리도록 fallback 실행 경로를 추가.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `rg -n "openPathInWindowsEditorFallback|APP_EDIT_AGENTS_POLICY|spawnDetachedCommand|async function openInEditor" src/main/main.js`로 fallback/실행 경로 반영 확인.

### 4) Windows 에디터 목록에 IntelliJ IDEA 우선 노출
- 요청 요약: 에디터 메뉴에서 IntelliJ IDEA를 첫 번째 항목으로 보이도록 순서를 조정.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `rg -n "id: \"idea\"|buildKnownEditors" src/main/main.js`로 Windows 목록 선두 배치 확인.

### 5) 에디터 목록 조회 실패 시 UI fallback 목록 표시
- 요청 요약: 에디터 IPC 응답이 비어 있거나 실패해도 에디터 목록이 비어 보이지 않도록 기본 목록을 표시.
- 변경 파일: `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `rg -n "getEditorMenuFallbackList|populateEditorMenu" src/renderer/renderer.js`로 fallback 경로 반영 확인.

### 6) 에디터 목록 즉시 렌더링 및 조회 타임아웃 방어
- 요청 요약: 에디터 목록이 보이지 않는 문제를 줄이기 위해 IPC 응답 전에도 기본 목록을 즉시 렌더링하고, 조회 지연 시 fallback을 유지.
- 변경 파일: `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `rg -n "EDITOR_QUERY_TIMEOUT_MS|Promise.race|forceDirectOpen|populateEditorMenu" src/renderer/renderer.js`로 즉시 렌더링/타임아웃/클릭 동작 반영 확인.

### 7) 분할 변경 후 에디터 드롭다운 비노출 보강
- 요청 요약: 분할 변경 이후 에디터 목록이 안 보이는 문제를 완화하기 위해 드롭다운 레이어 우선순위와 메뉴 재생성/정리 로직을 보강.
- 변경 파일: `src/renderer/styles.css`, `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `rg -n "pane-header|pane-editor-group|pane-editor-menu|handleEditorMenuOutsideClick|childElementCount <= 1" src/renderer/styles.css src/renderer/renderer.js`로 관련 보강점 확인.

### 8) 분할 변경 시 explorer만 남는 에디터 목록 병합 수정
- 요청 요약: `queryEditors` 응답이 일부 항목만 반환돼도 fallback 목록과 병합해 IntelliJ/Cursor/VS Code/Windsurf/Explorer가 유지되도록 수정.
- 변경 파일: `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `rg -n "mergeEditorMenuItems|getEditorMenuFallbackList|populateEditorMenu" src/renderer/renderer.js`로 병합 로직 반영 확인.

### 9) 에디터 목록 항목 클릭 시 즉시 열기 동작 추가
- 요청 요약: 에디터 드롭다운에서 항목을 클릭하면 선택과 동시에 해당 에디터로 경로를 바로 열도록 수정.
- 변경 파일: `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `rg -n "openEditorForView|itemBtn.addEventListener\\(\"click\", async|await openEditorForView\\(view\\)" src/renderer/renderer.js`로 즉시 열기 경로 반영 확인.

### 10) 에디터 항목 클릭 동작을 선택/실행 분리로 조정
- 요청 요약: 드롭다운 항목 선택 시에는 열지 않고, 이미 선택된 항목을 다시 클릭한 경우에만 에디터를 실행하도록 동작 수정.
- 변경 파일: `src/renderer/renderer.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `rg -n "isAlreadySelected|itemBtn.addEventListener\\(\"click\", async|openEditorForView" src/renderer/renderer.js`로 조건 실행 경로 반영 확인.

### 11) 에디터 열기 버튼 영역 분리 및 설치 목록 전용 표시
- 요청 요약: 왼쪽 영역은 선택된 에디터로 즉시 열기, 오른쪽 화살표 영역은 목록 토글만 수행하도록 분리하고, 드롭다운에는 설치된 에디터만 표시되도록 수정.
- 변경 파일: `src/renderer/renderer.js`, `src/renderer/styles.css`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `rg -n -e "normalizeEditorMenuItems" -e "openMenuButton" -e "pane-open-menu-btn" -e "설치된 에디터 없음" -e "is-selected" src/renderer/renderer.js src/renderer/styles.css`로 분리 버튼/설치 목록/선택 처리 반영 확인.

### 12) Windows 에디터 목록 조회 안정화 및 설치 경로 탐지 보강
- 요청 요약: Windows에서 설치된 에디터 목록이 비어 보이는 문제를 줄이기 위해 목록 조회 캐시/재시도 로직을 보강하고, VS Code/Cursor/Windsurf 설치 경로 탐지를 `Program Files`까지 확장.
- 변경 파일: `src/renderer/renderer.js`, `src/main/main.js`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `node --check src/main/main.js` 통과, `rg -n -e "loadInstalledEditorList|pendingEditorListQuery|forceRefresh" src/renderer/renderer.js` 및 `rg -n -e "fallbackExecutables" -e "Microsoft VS Code" -e "Cursor" -e "Windsurf" src/main/main.js`로 반영 확인.

### 13) Windows IntelliJ 설치 경로(버전/Toolbox) 탐지 보강
- 요청 요약: IntelliJ IDEA가 설치되어 있어도 목록에 보이지 않는 문제를 해결하기 위해 버전 포함 설치 폴더와 JetBrains Toolbox 채널 경로를 함께 스캔하도록 수정.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `Select-String -Path src/main/main.js -Pattern "collectWindowsIntelliJFallbackExecutables|startsWith\\(\"intellij idea\"\\)|Toolbox|IDEA"`로 동적 경로 탐지 로직 반영 확인.

### 14) IntelliJ 아이콘을 실행 파일의 공식 아이콘으로 표시
- 요청 요약: IntelliJ 아이콘이 임시 SVG로 보이던 문제를 수정하고, 설치된 `idea64.exe`에서 추출한 공식 앱 아이콘을 목록/버튼에 표시하도록 반영.
- 변경 파일: `src/main/main.js`, `src/renderer/renderer.js`
- 검증 결과: `node --check src/main/main.js` 통과, `node --check src/renderer/renderer.js` 통과, `Select-String -Path src/main/main.js -Pattern "getFileIconBase64|app.getFileIcon|queryInstalledEditors"` 및 `Select-String -Path src/renderer/renderer.js -Pattern "EDITOR_ICONS|idea"`로 아이콘 추출 경로 및 IntelliJ 임시 SVG 제거 확인.

### 15) skills.sh 스킬 설치 실패 완화(실행 경로/판정 보강)
- 요청 요약: skills.sh 기반 설치가 실패하는 문제를 줄이기 위해 CLI 실행 fallback과 설치 완료 판정을 보강.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `rg -n "SKILLS_CLI_MAX_BUFFER|runSkillsCliSync|installSkillsShSkill" src/main/main.js`로 `npx -> npm exec` fallback 및 버퍼 확장 반영 확인.

### 16) 스킬 인식 기준을 `SKILL.md`/`AGENTS.md` 동시 지원으로 확장
- 요청 요약: `+` 설치 후 설치된 스킬에 표시되지 않는 문제를 줄이기 위해 스킬 매니페스트 인식 기준을 `SKILL.md` 전용에서 `AGENTS.md`까지 확장.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `rg -n "resolveSkillManifestPath|hasSkillManifest|AGENTS.md|SKILL.md" src/main/main.js`로 매니페스트 탐지 경로 반영 확인.

### 17) skills.sh 검색 스킬 설치 안정화(원본 ID 전달/Windows 복사 설치)
- 요청 요약: skills.sh 검색 결과 스킬이 설치되지 않거나 설치 목록 반영이 누락되는 문제를 줄이기 위해 원본 `skillId` 전달 경로를 추가하고, 설치 명령에 `--copy --full-depth`를 적용.
- 변경 파일: `src/main/main.js`, `src/main/ipc-validators.js`, `src/renderer/renderer.js`
- 검증 결과: `node --check src/main/main.js` 통과, `node --check src/main/ipc-validators.js` 통과, `node --check src/renderer/renderer.js` 통과, `rg -n "installSkillId|--copy|--full-depth|runSkillsCliSync" src/main/main.js src/main/ipc-validators.js src/renderer/renderer.js`로 반영 확인.

### 18) skills.sh 설치 spawn 실패 대응(Windows cmd fallback)
- 요청 요약: `스킬 설치 실행에 실패했습니다` 오류를 줄이기 위해 skills CLI 실행 시 direct 실행 실패/종료코드 실패에 대해 Windows `cmd /c` 경유 fallback을 추가하고, 실패 상태줄에 마지막 stderr 라인을 함께 표시.
- 변경 파일: `src/main/main.js`, `src/renderer/renderer.js`
- 검증 결과: `node --check src/main/main.js` 통과, `node --check src/renderer/renderer.js` 통과, `rg -n "cmd-npx|cmd-npm-exec|SKILLS_CLI_MAX_BUFFER|스킬 설치 실패:" src/main/main.js src/renderer/renderer.js`로 fallback/오류표시 반영 확인.

### 19) Windows `npm.cmd`/`npx.cmd` EINVAL 직접 실행 회피
- 요청 요약: Windows에서 `spawnSync ...\\npm.cmd EINVAL`로 skills.sh 설치가 실패하는 문제를 해결하기 위해, Windows 경로에서는 `npm.cmd`/`npx.cmd` direct spawn을 사용하지 않고 `cmd /c` 경유 실행만 사용하도록 변경.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `rg -n "runSkillsCliSync|cmd-npx|cmd-npm-exec" src/main/main.js` 확인, `spawnSync(cmd.exe, ['/d','/s','/c','npm exec ...'])` 재현 테스트에서 `status=0` 확인.

### 20) Windows skills.sh 설치 명령 따옴표/인코딩 처리 수정
- 요청 요약: `skills-install-exit-1`과 깨진 한글 오류(`��...`)가 발생하던 문제를 해결하기 위해 Windows `cmd /c` 명령 문자열의 과도한 따옴표 감싸기를 제거하고, CLI 출력 디코딩을 버퍼 기반 UTF-8/euc-kr fallback으로 보강.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `spawnSync(cmd.exe, ['/d','/s','/c','\"npx\" ...'])` 재현에서 실패(`status=1`) 확인, 수정 방식(`cmd /c npx ...`, `cmd /c npm exec ...`) 재현에서 `status=0` 확인.

### 21) 개발 모드에서 규칙 설정이 원본 `AGENTS.md`를 직접 반영하도록 수정
- 요청 요약: 규칙 설정 화면에서 업데이트된 `AGENTS.md` 내용이 반영되지 않는 문제를 해결하기 위해 개발 모드에서는 `userData` 복사본 대신 프로젝트 원본 파일을 직접 읽고/저장하도록 경로 정책을 변경.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `rg -n "shouldUseDirectSourceAgentsPolicy|prepareAgentsPolicyPath|APP_WRITE_AGENTS_POLICY" src/main/main.js`로 직접 반영/패키지 분기 로직 반영 확인.

### 22) 레이아웃에 `1분할(1x1)` 프리셋 추가
- 요청 요약: 기존 2/4/6/8분할 외에 단일 패널 작업을 위한 `1분할`을 추가.
- 변경 파일: `src/shared/models.js`, `src/renderer/index.html`, `src/renderer/renderer.js`, `src/renderer/styles.css`
- 검증 결과: `node --check src/shared/models.js` 통과, `node --check src/renderer/renderer.js` 통과, `rg -n "1x1|preset-1x1|1분할" src/shared/models.js src/renderer/index.html src/renderer/renderer.js src/renderer/styles.css`로 프리셋 정의/UI/CSS 반영 확인.

### 23) 사용자 질문 로그 음영 블록 UI 추가
- 요청 요약: 터미널 입력 기반 사용자 질문을 별도 로그 영역에 수집하고, 질문 항목을 음영 카드로 표시해 빠르게 식별할 수 있도록 개선.
- 변경 파일: `src/renderer/index.html`, `src/renderer/renderer.js`, `src/renderer/styles.css`, `AGENTS.md`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `rg -n "user-question-log|captureUserQuestionInput|appendUserQuestionLog" src/renderer/index.html src/renderer/renderer.js src/renderer/styles.css`로 UI/입력 캡처/스타일 반영 확인.

### 24) 질문 음영 표시를 터미널 본문 inline 방식으로 전환
- 요청 요약: 분리된 질문 로그 패널 대신 터미널 텍스트 안에서 질문이 보이도록, Enter 시점의 입력 문장을 터미널 본문에 음영 라인으로 삽입하는 방식으로 변경.
- 변경 파일: `src/renderer/index.html`, `src/renderer/renderer.js`, `src/renderer/styles.css`, `AGENTS.md`
- 검증 결과: `node --check src/renderer/renderer.js` 통과, `rg -n "echoUserQuestionInTerminal|buildQuestionInlineLine|captureUserQuestionInput|pendingQuestionInputBySessionId" src/renderer/renderer.js` 확인, `rg -n "user-question-log" src/renderer/index.html src/renderer/styles.css` 결과 없음 확인.

## 2026-02-21
### 1) 규칙 설정 화면 `AGENTS.md` 동기화 수정
- 요청 요약: 규칙 설정 화면에서 최신 `AGENTS.md` 내용이 반영되지 않는 문제 수정.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `~/Library/Application Support/vibe-terminal-layout-system/AGENTS.md` 동기화 후 문구 반영 확인.

### 2) Windows 패키징용 `AGENTS.md` 경로 탐색 보강
- 요청 요약: Windows 패키징 시 `AGENTS.md`를 안정적으로 찾을 수 있도록 리소스 경로 탐색을 우선 적용.
- 변경 파일: `src/main/main.js`, `package.json`
- 검증 결과: `node --check src/main/main.js` 통과, `package.json`의 `build.extraResources`에 `AGENTS.md` 포함 설정 확인.

### 3) 기본 설치 스킬 삭제 가능하도록 스킬 관리자 수정
- 요청 요약: Vibe Terminal에 기본 설치된 스킬도 스킬관리에서 삭제할 수 있도록 동작 개선.
- 변경 파일: `src/main/main.js`, `src/renderer/renderer.js`
- 검증 결과: `node --check src/main/main.js` 통과, `node --check src/renderer/renderer.js` 통과.

## 2026-02-20
### 1) UI/UX 및 에이전트 마운트/정책/스킬/안정성 개선
- 요청 요약: 타이틀바 액션, 스킬/정책 오버레이, 에이전트 마운트 흐름, 정책/스킬 IPC, 런타임 안정성 개선을 일괄 반영.
- 변경 파일: `.gitignore`, `src/main/ipc-validators.js`, `src/main/main.js`, `src/preload/preload.js`, `src/renderer/index.html`, `src/renderer/renderer.js`, `src/renderer/styles.css`, `src/shared/ipc-channels.js`, `src/shared/models.js`
- 검증 결과: 기존 작업 기록(README 이관본) 기준 반영 사실 확인, 세부 자동 검증 로그는 별도 기록 없음.

### 2) 창 제어/레이아웃 후속 조정
- 요청 요약: 창 제어 버튼 레이아웃과 최소 너비를 조정.
- 변경 파일: `src/main/main.js`, `src/renderer/styles.css`
- 검증 결과: 기존 작업 기록(README 이관본) 기준 반영 사실 확인, 세부 자동 검증 로그는 별도 기록 없음.
