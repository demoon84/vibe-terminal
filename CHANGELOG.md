# CHANGELOG

이 문서는 작업 이력을 기록한다.

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
