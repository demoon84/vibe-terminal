# 서비스 개요

## 목적

Vibe Terminal은 `Codex`, `Claude`, `Gemini` 같은 코딩 에이전트를 여러 pane에서 동시에 다루기 위한 Electron 데스크톱 앱입니다. 단순한 멀티 터미널이 아니라, 에이전트 실행 버튼, 전역 마운트, 레이아웃 저장/복원, 상태 강조, 스킬 관리 같은 작업 흐름을 한 UI에 묶는 것이 핵심입니다.

## 핵심 사용자 가치

- 여러 에이전트를 분할 pane에서 동시에 실행할 수 있습니다.
- pane 수를 `1`, `2`, `3`, `4`, `6`개 preset으로 빠르게 전환할 수 있습니다.
- 현재 작업 폴더, 셸, 상태 정보를 pane 단위로 관리할 수 있습니다.
- 종료 후 다시 열어도 마지막 레이아웃과 세션 구성이 복원됩니다.
- PowerShell 7, Node 런타임, 스킬 설치 상태 같은 실행 환경을 앱 안에서 점검할 수 있습니다.

## 계층 구조

### 1. Main process

Electron 생명주기, 보안 경계, IPC 처리, PTY 세션 관리, 레이아웃 저장을 담당합니다.

관련 파일:

- `src/main/main.js`
- `src/main/ipc-router.js`
- `src/main/session-manager.js`
- `src/main/layout-manager.js`
- `src/main/layout-store.js`
- `src/main/ipc-trust.js`
- `src/main/ipc-validators.js`

### 2. Preload bridge

renderer가 Node API에 직접 접근하지 않고도 필요한 기능만 사용하도록 `window.multiTerminal` API를 노출합니다.

관련 파일:

- `src/preload/preload.js`

### 3. Renderer

pane UI 생성, xterm 렌더링, 버튼 이벤트 처리, 레이아웃 변경, 상태 표시, 알림을 담당합니다.

관련 파일:

- `src/renderer/index.html`
- `src/renderer/renderer.js`
- `src/renderer/styles.css`

### 4. Shared contract

main과 renderer가 공통으로 사용하는 preset 정의, 기본 셸 결정, IPC 채널 이름을 보관합니다.

관련 파일:

- `src/shared/models.js`
- `src/shared/ipc-channels.js`

## 주요 데이터 단위

- `preset`: `1x1`, `1x2`, `1x3`, `1x4`, `1x6` 같은 pane 배치 단위
- `layout`: 현재 preset, pane 목록, grid shape, track 크기 등을 담는 상태
- `session`: `node-pty`로 생성한 개별 터미널 프로세스
- `capabilityToken`: renderer가 특정 세션을 조작할 수 있는 권한 토큰

## 저장소에서 먼저 보면 좋은 파일

- 앱 시작점: `src/main/main.js`
- IPC 연결점: `src/main/ipc-router.js`
- 레이아웃 규칙: `src/main/layout-manager.js`
- 세션 수명주기: `src/main/session-manager.js`
- 화면 시작점: `src/renderer/renderer.js`
