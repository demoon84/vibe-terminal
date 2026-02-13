# 보안 미확인 항목 작업목록

기준일: 2026-02-12  
출처: `docs/terminal-connection-security-checklist.md`의 `[ ]` 항목

## 1) 자동 검증으로 처리

1. [x] 프로덕션 DevTools 차단 동작 확인 (IPC + BrowserWindow 옵션)
- 검증 방식: 정적 회귀 테스트
- 근거 파일: `test/security-regression.test.js`, `src/main/main.js`

2. [x] PTY/클립보드 IPC 신뢰 검증 경로 재점검
- 검증 방식: 정적 회귀 테스트
- 근거 파일: `test/security-regression.test.js`, `src/main/main.js`, `src/main/ipc-router.js`

3. [x] 위험 프리셋 명령 기본값/노출 정책 재확인
- 검증 방식: 정적 회귀 테스트(기본 비활성 플래그 유지)
- 근거 파일: `test/security-regression.test.js`, `src/renderer/renderer.js`

4. [x] CSP와 xterm 동작 호환 검증 (코드/정책 레벨)
- 검증 방식: 정적 회귀 테스트(CSP 정책 + xterm 관련 스타일/옵션)
- 근거 파일: `test/security-regression.test.js`, `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/renderer.js`

## 2) 수동 회귀 테스트 필요

1. [x] 터미널 선택/복사/커서 동작 수동 회귀 테스트
- 상태: Playwright 스모크 검증 완료(테스트 브릿지 주입)
- 메모: Ctrl+C 입력 시 클립보드 write 호출(1회) 확인
- 대상 파일: `src/renderer/renderer.js`, `src/renderer/styles.css`

2. [x] 터미널 폰트/선택 스타일 회귀 테스트
- 상태: Playwright 스모크 검증 완료(테스트 브릿지 주입)
- 메모: helper textarea/caret, selection opacity, viewport overflow 동작 확인
- 대상 파일: `src/renderer/styles.css`

## 3) 다음 액션

1. [x] 자동 보안 회귀 테스트 실행
2. [x] 수동 UI 회귀 테스트 수행
3. [x] 결과를 `docs/security-app-only-checklist.md`에 최종 반영
