# 레이아웃과 세션

## preset 모델

`src/shared/models.js`는 앱이 지원하는 기본 pane 구성을 정의합니다.

- `1x1`
- `1x2`
- `1x3`
- `1x4`
- `1x6`

각 preset은 다음 값을 가집니다.

- `rows`
- `columns`
- `panelCount`
- 표시용 `name`

또한 최소 pane 크기, splitter 크기 같은 레이아웃 제약도 같은 파일에서 정의합니다.

## LayoutManager 책임

`src/main/layout-manager.js`는 현재 레이아웃의 정규화와 스냅샷 생성을 담당합니다.

핵심 역할:

- preset에 맞는 기본 `gridShape` 계산
- preset별 허용 `layoutVariant` 관리
- 저장된 `gridTracks` 비율 정규화
- pane와 session 매핑 유지
- 레이아웃 snapshot 생성
- 저장 상태 복원 시 유효한 구조만 재구성

활성 상태는 대략 아래 값을 포함합니다.

- `presetId`
- `panes`
- `layoutVariant`
- `gridShape`
- `gridTracks`

## SessionManager 책임

`src/main/session-manager.js`는 `node-pty` 프로세스와 세션 메타데이터를 관리합니다.

핵심 역할:

- 세션 생성과 종료
- 세션별 `cwd`, `shell`, `env`, `cols`, `rows`, `status` 추적
- PTY 출력 이벤트 전달
- 종료된 세션 일부를 제한적으로 보존해 복원 보조
- OSC 7 시퀀스를 파싱해 현재 작업 디렉터리 자동 갱신
- UTF-8 locale과 색상 관련 환경 변수를 정규화

세션 상태는 `creating`, `running`, `stopping`, `stopped`, `errored`로 관리됩니다.

## 레이아웃 저장과 복원

`src/main/layout-store.js`는 사용자 데이터 경로 아래 `state/layout-state.json` 파일에 레이아웃을 저장합니다.

저장 시 포함되는 주요 값:

- 현재 preset
- pane 목록
- layout variant
- grid shape
- grid tracks
- 세션 snapshot
- `updatedAt`

복원 시에는 저장된 상태를 그대로 신뢰하지 않고, `LayoutManager.restoreLayout()`이 다시 정규화합니다.

## 대표 흐름

### 새 preset 적용

1. renderer가 새 preset ID를 보냅니다.
2. `LayoutManager.setPreset()`이 필요한 pane 수를 계산합니다.
3. 기존 실행 중 세션은 가능한 한 유지합니다.
4. 부족한 pane은 새 세션으로 채웁니다.
5. 결과 레이아웃을 저장하고 renderer에 반환합니다.

### pane 크기 저장

1. renderer가 splitter 이동 결과를 `layout:save`로 보냅니다.
2. main process가 track 값을 정규화합니다.
3. 정규화된 레이아웃을 디스크에 기록합니다.
4. renderer는 반환값을 기준으로 상태를 유지합니다.

## 운영상 주의점

- preset이 바뀌어도 실행 중 세션을 최대한 재사용하도록 설계되어 있습니다.
- pane 수보다 많은 에이전트가 실행 중일 때는 더 작은 preset으로 줄이지 못합니다.
- 저장 파일이 손상되어도 `LayoutStore.load()`는 `null`을 반환하고 앱은 기본 preset으로 복구됩니다.

## 관련 파일

- `src/shared/models.js`
- `src/main/layout-manager.js`
- `src/main/layout-store.js`
- `src/main/session-manager.js`
