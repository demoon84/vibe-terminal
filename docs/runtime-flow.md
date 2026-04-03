# 런타임 흐름

## 1. 앱 시작

1. `npm run electron:start`가 Electron을 실행합니다.
2. `src/main/main.js`가 진입점으로 로드됩니다.
3. `app.requestSingleInstanceLock()`으로 단일 인스턴스를 강제합니다.
4. 두 번째 인스턴스가 열리면 기존 창을 복구하고 포커스만 이동합니다.

## 2. `app.whenReady()` 이후 초기화

`src/main/main.js`의 `app.whenReady().then(...)`에서 아래 작업이 순서대로 진행됩니다.

1. 기본 애플리케이션 메뉴를 제거합니다.
2. 창 제어, 파일 선택, 에이전트 설치, 스킬 설치, 클립보드, 알림, 에디터 연동 IPC를 등록합니다.
3. `LayoutStore`를 생성해 사용자 데이터 경로 아래 상태 파일을 관리합니다.
4. `registerIpcRoutes(...)`로 PTY와 레이아웃 관련 IPC를 묶어서 등록합니다.
5. `createMainWindow()`로 실제 창을 생성합니다.

## 3. 메인 윈도우 생성

`createMainWindow()`는 다음 조건으로 `BrowserWindow`를 만듭니다.

- `frame: false`로 커스텀 타이틀바를 사용합니다.
- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`로 renderer 권한을 제한합니다.
- preload 스크립트는 `src/preload/preload.js`를 사용합니다.
- 개발 모드에서만 devtools 사용을 허용합니다.
- `src/renderer/index.html`을 로드합니다.

창이 열린 뒤에는 다음 이벤트가 연결됩니다.

- `maximize`, `unmaximize`: renderer에 창 상태를 전달
- `close`, `closed`: 세션 정리와 핫리로드 해제
- `render-process-gone`: renderer 크래시 시 세션 정리

## 4. Preload 브리지 준비

`src/preload/preload.js`는 `window.multiTerminal` 객체를 renderer에 노출합니다.

- `pty`: 세션 생성, 입력, 리사이즈, 종료, 디렉터리 변경
- `layout`: preset 변경, 레이아웃 저장, 레이아웃 복원
- `app`: 창 제어, 파일 선택, 런타임 점검, 클립보드, 알림, 에디터 연동

renderer는 이 브리지만 사용하고 Node 내장 모듈에는 직접 접근하지 않습니다.

## 5. Renderer 부팅

`src/renderer/renderer.js`의 `bootstrap()`이 화면 초기화를 담당합니다.

1. preload bridge와 xterm 모듈 로드 여부를 확인합니다.
2. 저장된 터미널 폰트, 알림 설정, 자동 설치 건너뛴 에이전트 목록을 읽습니다.
3. 이벤트 바인딩을 등록합니다.
4. 필요한 에이전트 설치 상태를 확인합니다.
5. PowerShell 7, 터미널 컬러, Node 런타임 상태를 점검합니다.
6. 저장된 레이아웃을 복원합니다.
7. 복원 실패 시 기본 preset으로 새 레이아웃을 만듭니다.

## 6. 일반 사용 흐름

### preset 변경

1. 사용자가 상단 preset 버튼을 누릅니다.
2. renderer의 `setPreset()`이 실행 중인 에이전트 수를 확인합니다.
3. `api.layout.setPreset(...)` 호출로 main process에 새 레이아웃을 요청합니다.
4. main process가 필요한 세션을 유지하거나 새로 만들고, 저장소에 상태를 저장합니다.
5. renderer가 `renderLayout()`으로 pane UI를 다시 구성합니다.

### 터미널 입출력

1. pane 생성 시 PTY 세션이 준비됩니다.
2. 사용자의 입력은 `pty:write`로 전달됩니다.
3. main process가 `node-pty`에 기록합니다.
4. 출력은 `pty:data` 이벤트로 renderer에 전달됩니다.
5. renderer가 xterm 화면과 상태 표시를 갱신합니다.

### 앱 종료

1. 사용자가 닫기 버튼을 누르면 renderer가 `app:window-close`를 호출합니다.
2. main process가 세션 정리를 시작하고 닫기 오버레이 표시 시간을 잠깐 보장합니다.
3. 창이 실제로 닫히면 남은 세션과 리소스를 정리합니다.
4. `beforeunload`에서 renderer 구독과 pane 뷰도 함께 해제됩니다.

## 관련 파일

- `src/main/main.js`
- `src/preload/preload.js`
- `src/renderer/renderer.js`
