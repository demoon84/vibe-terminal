# vibe-terminal-layout-system

Electron 기반 멀티 패널 터미널 애플리케이션입니다. 장시간 실행되는 에이전트 작업(Codex, Claude, Gemini)을 한 화면에서 관리할 수 있도록 설계되어 있으며, 데스크톱 앱(Electron)과 선택적 레거시 서버 런타임(Express + WebSocket)을 함께 제공합니다.

## 핵심 기능
- 레이아웃 프리셋 기반 멀티 패널 UI (`1x2`, `1x4`, `2x6`, `2x8`, `3x12`)
- PTY 세션 생성/복구/정리 및 패널 단위 세션 매핑
- 에이전트 CLI 실행 및 설치 보조 흐름
- 메인/렌더러 경계 보안(IPC 검증, renderer 격리, 클립보드 요청 제한)
- 레거시 HTTP/WebSocket API 런타임(선택)

## 요구 사항
- Node.js 20+
- npm

## 설치
```bash
npm install
```

## 실행
Electron 앱:
```bash
npm run electron:start
```

Electron 개발 모드:
```bash
npm run electron:dev
```

레거시 서버(선택):
```bash
npm run dev
npm start
```

기본 서버 주소: `http://127.0.0.1:4310`

## 환경 변수
환경 파일 로딩 순서:
- `.env.${NODE_ENV}.local`
- `.env.local`
- `.env.${NODE_ENV}`
- `.env`

공통/앱 관련:
- `NODE_ENV`
- `VIBE_TERMINAL_COLOR_MODE`
- `VIBE_FORCE_PWSH7_INSTALL_FAIL`
- `VIBE_OPEN_DEVTOOLS`
- `GEMINI_MODEL`
- `PWSH_PATH`
- `HOME`
- `SHELL`

레거시 서버 관련 (`server/config.js`):
- `PORT`, `HOST`, `MAX_PTYS`, `BUFFER_SIZE`, `AUTO_RESTART_DELAY_MS`
- `TELEMETRY_ENABLED`
- `API_TOKEN`, `REQUIRE_API_TOKEN_FOR_LOOPBACK`
- `ALLOWED_ORIGINS`, `ALLOWED_ORIGINS_DEV`, `ALLOWED_ORIGINS_STAGE`, `ALLOWED_ORIGINS_PROD`
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`
- `WS_RATE_LIMIT_WINDOW_MS`, `WS_RATE_LIMIT_MAX_MESSAGES`
- `COMMAND_ALLOWLIST`, `COMMAND_APPROVAL_TOKEN`
- `PERSIST_COMMAND_IN_WORKSET`, `PERSIST_ENV_IN_WORKSET`, `MASK_SENSITIVE_ENV_VALUES`

보안 스캔 스크립트 관련:
- `AUDIT_REGISTRY`
- `NPM_PUBLIC_REGISTRY`

## 테스트
```bash
npm run check
npm test
npm run security:deps
```

## 빌드/패키징
```bash
npm run rebuild:native
npm run package
npm run package:installer
npm run package:dir
npm run package:mac
npm run package:mac:dir
```

산출물은 `release/` 디렉터리에 생성됩니다.

## 프로젝트 구조
- `src/main/`: Electron 메인 프로세스, 세션/레이아웃/IPC 처리
- `src/preload/`: 렌더러 브리지
- `src/renderer/`: UI 렌더링 및 사용자 상호작용
- `src/shared/`: 공유 모델/IPC 채널 상수
- `server/`: 레거시 Express + WebSocket 런타임
- `scripts/`: 문법 검사/보안 검사 등 유틸리티
- `docs/`: IPC/상태 머신/보안 체크리스트 문서
- `test/`: 단위/회귀 테스트
- `public/`, `assets/`, `data/`: 정적 리소스 및 런타임 데이터

## 주요 파일
- `src/main/main.js`
- `src/main/session-manager.js`
- `src/main/layout-manager.js`
- `src/main/ipc-router.js`
- `src/main/ipc-validators.js`
- `src/main/path-utils.js`
- `src/preload/preload.js`
- `src/renderer/renderer.js`
- `server/index.js`
- `server/config.js`
- `server/panelManager.js`

## 문제 해결
- Electron 실행이 실패하면 `node -v`, `npm -v`로 런타임 버전(특히 Node.js 20+)을 확인하세요.
- 서버 인증 오류가 발생하면 `API_TOKEN`, `REQUIRE_API_TOKEN_FOR_LOOPBACK` 값을 먼저 점검하세요.
- CORS/Origin 관련 오류가 발생하면 `ALLOWED_ORIGINS*` 값을 실행 주소 기준으로 설정하세요.
- 요청 제한 로그가 자주 발생하면 `RATE_LIMIT_*`, `WS_RATE_LIMIT_*`를 트래픽에 맞게 조정하세요.
