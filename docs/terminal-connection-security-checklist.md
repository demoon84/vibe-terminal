# 터미널 연결/입력 보안 점검 체크리스트

기준일: 2026-02-12  
범위: Electron 메인/프리로드/렌더러의 PTY 연결, 입력 전달, 클립보드, UI 상호작용

## 1) 즉시 점검 (Critical)

1. [x] 프로덕션 DevTools 차단
- 파일: `src/main/main.js`
- 점검: `webPreferences.devTools`가 프로덕션에서 `false`인지 확인
- 점검: `APP_WINDOW_DEVTOOLS_TOGGLE` IPC가 프로덕션에서 `disabled-in-production` 반환하는지 확인

2. [x] 렌더러 격리/샌드박스 강제
- 파일: `src/main/main.js`
- 점검: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` 유지

3. [x] IPC 호출자 신뢰 검증
- 파일: `src/main/ipc-trust.js`, `src/main/ipc-router.js`, `src/main/main.js`
- 점검: 모든 민감 IPC(PTY/클립보드/창 제어)에 `isTrustedRendererEvent` 적용 여부 확인

4. [x] PTY 생성/입력 경로 제한
- 파일: `src/main/ipc-router.js`, `src/main/session-manager.js`
- 점검: 세션 식별자 검증, resize/write/kill 대상 세션 검증, 입력 길이/형식 제한

## 2) 우선 점검 (High)

1. [x] 위험 명령 프리셋 노출 점검
- 파일: `src/renderer/renderer.js`
- 점검: `codex --dangerously-bypass-approvals-and-sandbox`, `gemini --sandbox=false` 사용 정책 확인
- 조치: 기본 비활성 유지, 사용자 명시 동작에서만 활성화되는지 확인

2. [x] 클립보드 접근 최소화
- 파일: `src/preload/preload.js`, `src/main/main.js`, `src/renderer/renderer.js`
- 점검: 읽기/쓰기 호출이 사용자 액션 기반인지 확인
- 조치: 백그라운드 주기 호출 금지, 실패 시 민감내용 로그 금지

3. [x] CSP와 xterm 동작 호환 검증
- 파일: `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/renderer.js`
- 상태: 정적 회귀 테스트 + Playwright 스모크 검증 완료
- 점검: 드래그 선택/복사/커서 깜박임이 정상인지 확인
- 점검: CSP 변경 시 인라인 스타일 차단으로 xterm 기능이 깨지지 않는지 회귀 테스트

4. [x] 드래그/드롭 내비게이션 차단 확인
- 파일: `src/renderer/renderer.js`
- 점검: 파일 드롭 시 앱 내 처리만 수행되고 브라우저 내비게이션이 차단되는지 확인

## 3) 안정성 점검 (Medium)

1. [x] PowerShell 7 색상 반영 진단 루틴 유지
- 파일: `src/main/main.js`, `src/renderer/renderer.js`
- 점검: `APP_TERMINAL_COLOR_DIAGNOSTICS` 결과를 시작 시 확인하고 비정상 시 가이드 노출

2. [x] 터미널 폰트/선택 스타일 회귀 테스트
- 파일: `src/renderer/styles.css`
- 상태: 정적 회귀 테스트 + Playwright 스모크 검증 완료
- 점검: 폰트 크기 변경 후 선택 영역, helper textarea, 스크롤바 표시가 정상인지 확인

3. [x] 세션 종료/정리 루틴 점검
- 파일: `src/main/session-manager.js`, `src/main/main.js`
- 점검: 창 종료/크래시 시 PTY 정리, orphan 프로세스 방지 로직 확인

## 4) 실행 순서 (권장)

1. [x] 프로덕션 DevTools 차단 동작 확인 (IPC + BrowserWindow 옵션)
2. [x] 터미널 선택/복사/커서 동작 수동 회귀 테스트
3. [x] PTY/클립보드 IPC 신뢰 검증 경로 재점검
4. [x] 위험 프리셋 명령 기본값/노출 정책 재확인
5. [x] 배포 전 체크 결과를 `docs/security-app-only-checklist.md`에 반영

## 5) 검증 메모 (2026-02-12)

- 자동 테스트: `npm test -- test/security-regression.test.js` (9/9 통과)
- Playwright 스모크(로컬 HTTP + 테스트 브릿지 주입) 결과:
  - `.pane` 4개 / `.xterm` 4개 렌더링 확인
  - helper textarea 존재, caret color 투명(`rgba(0, 0, 0, 0)`) 확인
  - viewport `overflow-y: auto` 확인
  - selection 레이어 `opacity: 1` 확인
  - Ctrl+C 입력 시 클립보드 write 호출 카운트 증가(1회) 확인
