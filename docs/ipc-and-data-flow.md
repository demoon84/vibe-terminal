# IPC와 데이터 흐름

## 전체 구조

이 앱은 `main -> preload -> renderer` 3단계 경계를 유지합니다.

- `main`: 실제 권한 보유 주체
- `preload`: 허용된 API만 노출하는 브리지
- `renderer`: 화면과 사용자 상호작용 처리

공통 IPC 이름은 `src/shared/ipc-channels.js`에 정의되어 있고, preload와 main이 같은 상수를 공유합니다.

## Preload가 노출하는 API

`window.multiTerminal`은 세 가지 묶음으로 나뉩니다.

- `pty`
  - `create`
  - `write`
  - `resize`
  - `kill`
  - `changeDirectory`
  - `onData`
  - `onExit`
  - `onStatus`
- `layout`
  - `setPreset`
  - `save`
  - `restore`
- `app`
  - `lifecycle`
  - `window`
  - `write`
  - `read`
  - `process`

## PTY 흐름

### 세션 생성

1. renderer가 `pty:create`를 호출합니다.
2. `ipc-router.js`가 payload를 검증합니다.
3. `SessionManager.createSession()`이 `node-pty` 프로세스를 생성합니다.
4. main process가 세션별 `capabilityToken`을 발급합니다.
5. renderer는 이후 모든 변경 요청에 이 토큰을 함께 보냅니다.

### 세션 제어

다음 요청은 모두 세션 ID와 capability token을 요구합니다.

- `pty:write`
- `pty:resize`
- `pty:kill`
- `pty:change-directory`

이 구조 덕분에 renderer가 알고 있는 세션만 조작할 수 있고, 임의 세션 접근이 차단됩니다.

### 출력 이벤트

`SessionManager`는 `data`, `status`, `exit` 이벤트를 발생시키고, `ipc-router.js`가 renderer로 전달합니다.

- `pty:data`: 터미널 출력
- `pty:status`: `cwd`, `shell`, `status` 변화
- `pty:exit`: 종료 코드와 종료 상태

`pty:data`는 16ms 간격으로 버퍼링 후 flush되어 이벤트 폭주를 줄입니다.

## 레이아웃 흐름

### `layout:setPreset`

1. renderer가 새 preset을 요청합니다.
2. `ipc-router.js`가 preset ID와 pane 수 조건을 검증합니다.
3. `LayoutManager.setPreset()`이 pane 목록과 세션 연결을 재계산합니다.
4. 결과는 `LayoutStore.save()`로 저장됩니다.
5. renderer는 받은 layout snapshot을 기준으로 UI를 다시 그립니다.

### `layout:save`

pane 크기 변경이나 grid track 조정 후 renderer가 현재 상태를 저장합니다. main process는 저장된 layout과 함께 정규화된 `gridShape`, `gridTracks`를 다시 반환합니다.

### `layout:restore`

앱 시작 시 호출되며, `layout-state.json`을 읽은 뒤 유효한 세션과 preset 기준으로 복원 가능한 상태만 되살립니다.

## 보안과 신뢰 경계

### 신뢰된 renderer 검증

`src/main/ipc-trust.js`의 `createTrustedRendererGuard()`는 아래 조건을 만족하는 이벤트만 신뢰합니다.

- 현재 `mainWindow`의 `webContents`에서 온 요청
- 파괴되지 않은 sender
- `file://` 기반 URL에서 로드된 renderer

### payload 검증

`src/main/ipc-validators.js`는 IPC별 길이, 타입, 값 범위를 제한합니다.

예시:

- PTY 입력 최대 길이 제한
- 경로 문자열 최대 길이 제한
- 환경변수 key 형식 제한
- 알림 제목/본문 길이 제한

### 추가 보호 장치

- 클립보드 IPC는 호출 빈도 제한이 있습니다.
- renderer는 Node에 직접 접근하지 못합니다.
- 창은 sandbox 환경에서 실행됩니다.

## 관련 파일

- `src/shared/ipc-channels.js`
- `src/preload/preload.js`
- `src/main/ipc-router.js`
- `src/main/ipc-trust.js`
- `src/main/ipc-validators.js`
