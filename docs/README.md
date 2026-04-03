# Vibe Terminal 문서

현재 저장소의 구조와 서비스 흐름을 코드 기준으로 나눠 정리한 문서 모음입니다. 상세 구현을 빠르게 찾을 수 있도록 책임별로 파일을 분리했습니다.

## 문서 목록

- [서비스 개요](./overview.md): 제품 목적, 핵심 기능, 디렉터리 책임
- [런타임 흐름](./runtime-flow.md): 앱 시작부터 종료까지의 실행 순서
- [IPC와 데이터 흐름](./ipc-and-data-flow.md): main, preload, renderer 사이 계약과 보안 경계
- [레이아웃과 세션](./layout-and-session.md): preset, pane, PTY 세션, 저장 복원 구조
- [렌더러 UI](./renderer-ui.md): 화면 상태, pane 렌더링, 사용자 상호작용
- [개발 및 운영](./development.md): 실행 스크립트, 환경 변수, 패키징 포인트

## 추천 읽기 순서

1. `overview.md`
2. `runtime-flow.md`
3. `ipc-and-data-flow.md`
4. `layout-and-session.md`
5. `renderer-ui.md`
6. `development.md`

## 빠른 구조 요약

- `src/main`: Electron main process, IPC 등록, 세션과 레이아웃 수명주기 관리
- `src/preload`: renderer가 접근 가능한 안전한 브리지 노출
- `src/renderer`: pane UI, xterm 연결, 사용자 상호작용 처리
- `src/shared`: preset 정의와 IPC 채널 같은 공용 계약

문서는 현재 코드 상태를 기준으로 작성되어 있으며, 동작이 바뀌면 함께 갱신하는 것을 전제로 합니다.
