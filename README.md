# Vibe Terminal

`Codex`, `Claude`, `Gemini` 같은 코딩 에이전트를 여러 터미널 pane으로 동시에 다루기 위한 Electron 기반 데스크톱 앱입니다.

## 주요 기능

- `1`, `2`, `3`, `4`, `6` 분할 preset 지원
- pane별 에이전트 실행 버튼과 전역 마운트 버튼 제공
- pane별 셸 프로필 전환 (`PowerShell` / `CMD` / `WSL` / `zsh` / `bash`)
- pane 크기 조절과 레이아웃 저장/복원
- 확인 필요 / 완료 / 오류 상태 강조와 하단 status line 피드백
- 스킬 관리자 UI와 터미널 폰트 크기 조절 오버레이

## 문서

- [docs/README.md](./docs/README.md): 문서 진입점
- [docs/overview.md](./docs/overview.md): 서비스 개요
- [docs/runtime-flow.md](./docs/runtime-flow.md): 앱 시작부터 종료까지 흐름
- [docs/ipc-and-data-flow.md](./docs/ipc-and-data-flow.md): IPC 계약과 데이터 흐름
- [docs/layout-and-session.md](./docs/layout-and-session.md): 레이아웃과 세션 구조
- [docs/renderer-ui.md](./docs/renderer-ui.md): 렌더러 UI 동작
- [docs/development.md](./docs/development.md): 개발 및 운영 메모

## 개발 실행

```bash
npm install
npm run electron:start
```

`node-pty` 네이티브 모듈 재설치가 필요하면 아래 명령을 사용합니다.

```bash
npm run rebuild:native
```

## 패키징

```bash
# Windows portable
npm run package

# Windows installer
npm run package:installer

# Windows unpacked directory
npm run package:dir

# macOS dmg
npm run package:mac

# macOS unpacked directory
npm run package:mac:dir
```

빌드 산출물은 기본적으로 `release/` 디렉터리에 생성됩니다.

## 디렉터리 구조

- `docs`: 서비스 구조, 흐름, 운영 문서
- `src/main`: Electron main process, IPC 라우팅, 세션/레이아웃 관리
- `src/preload`: renderer에 노출하는 preload bridge
- `src/renderer`: UI, xterm 연동, pane 렌더링
- `src/shared`: main/renderer가 공유하는 모델과 IPC 채널 정의
- `assets`: 패키징용 앱 아이콘
- `build`: macOS entitlements 등 빌드 설정 파일
