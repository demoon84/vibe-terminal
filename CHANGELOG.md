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
