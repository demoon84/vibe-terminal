# CHANGELOG

이 문서는 작업 이력을 기록한다.

## 2026-02-21
### 1) 규칙 설정 화면 `AGENTS.md` 동기화 수정
- 요청 요약: 규칙 설정 화면에서 최신 `AGENTS.md` 내용이 반영되지 않는 문제 수정.
- 변경 파일: `src/main/main.js`
- 검증 결과: `node --check src/main/main.js` 통과, `~/Library/Application Support/vibe-terminal-layout-system/AGENTS.md` 동기화 후 문구 반영 확인.

### 2) Windows 패키징용 `AGENTS.md` 경로 탐색 보강
- 요청 요약: Windows 패키징 시 `AGENTS.md`를 안정적으로 찾을 수 있도록 리소스 경로 탐색을 우선 적용.
- 변경 파일: `src/main/main.js`, `package.json`
- 검증 결과: `node --check src/main/main.js` 통과, `package.json`의 `build.extraResources`에 `AGENTS.md` 포함 설정 확인.

## 2026-02-20
### 1) UI/UX 및 에이전트 마운트/정책/스킬/안정성 개선
- 요청 요약: 타이틀바 액션, 스킬/정책 오버레이, 에이전트 마운트 흐름, 정책/스킬 IPC, 런타임 안정성 개선을 일괄 반영.
- 변경 파일: `.gitignore`, `src/main/ipc-validators.js`, `src/main/main.js`, `src/preload/preload.js`, `src/renderer/index.html`, `src/renderer/renderer.js`, `src/renderer/styles.css`, `src/shared/ipc-channels.js`, `src/shared/models.js`
- 검증 결과: 기존 작업 기록(README 이관본) 기준 반영 사실 확인, 세부 자동 검증 로그는 별도 기록 없음.

### 2) 창 제어/레이아웃 후속 조정
- 요청 요약: 창 제어 버튼 레이아웃과 최소 너비를 조정.
- 변경 파일: `src/main/main.js`, `src/renderer/styles.css`
- 검증 결과: 기존 작업 기록(README 이관본) 기준 반영 사실 확인, 세부 자동 검증 로그는 별도 기록 없음.
