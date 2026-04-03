# 렌더러 UI

## 상태 관리

`src/renderer/renderer.js`는 단일 `state` 객체를 중심으로 동작합니다.

대표 상태:

- 현재 `layout`
- pane view 맵과 session 매핑
- 세션별 capability token
- 에이전트 선택 상태
- 스킬 관리자 상태
- 데스크톱 알림 설정
- 터미널 폰트 설정
- grid resize와 pane swap 작업 상태

이 구조 덕분에 renderer는 서버 상태 저장소 없이도 화면과 IPC 응답을 한곳에서 동기화합니다.

## 레이아웃 렌더링

`renderLayout(layout)`은 화면 재구성의 중심 함수입니다.

주요 단계:

1. 기존 pane view와 observer를 정리합니다.
2. layout snapshot을 state에 복사합니다.
3. visible pane 목록과 placement를 계산합니다.
4. grid preset과 track 크기를 CSS grid에 반영합니다.
5. pane별 DOM과 xterm 인스턴스를 생성합니다.
6. DOM에 붙인 뒤 `terminal.open()`을 호출합니다.
7. `ResizeObserver`로 pane 크기 변화 시 fit과 PTY resize를 예약합니다.
8. splitter를 다시 그립니다.

## 사용자 상호작용

### 상단 타이틀바

- 창 최소화, 최대화, 닫기
- 전체 pane에 작업 경로 적용
- 스킬 관리자 열기
- 터미널 폰트 설정 열기
- 전체 pane에 `Codex`, `Claude`, `Gemini` 마운트
- 실행 중 에이전트 전체 종료

### preset 버튼

renderer는 현재 실행 중인 에이전트 수를 기준으로 선택 가능한 preset만 허용합니다. 제약 조건을 위반하면 상태줄에 이유를 남기고 요청을 보내지 않습니다.

### PTY 이벤트 반영

- `pty:data`: xterm 출력 추가, 확인 필요 프롬프트 감지
- `pty:status`: pane 상태, 경로, 셸 표시 갱신
- `pty:exit`: 종료 로그 출력, 상태 반영, 필요 시 알림

### 알림 처리

renderer는 터미널 출력에서 확인 필요 패턴을 감지해 데스크톱 알림을 보낼 수 있습니다. 같은 세션에서 너무 자주 울리지 않도록 cooldown과 throttling을 함께 사용합니다.

## 종료 처리

`beforeunload` 시점에 다음을 수행합니다.

- main process에 renderer 종료 알림 전송
- 이벤트 구독 해제
- pane view와 observer 정리

이 정리 단계가 있어 새 창 재생성이나 종료 중 메모리 누수 가능성을 줄입니다.

## 관련 파일

- `src/renderer/index.html`
- `src/renderer/renderer.js`
- `src/renderer/styles.css`
