# 개발 및 운영

## 개발 실행

```bash
npm install
npm run electron:start
```

`node-pty` 네이티브 모듈 재설치가 필요하면 아래 명령을 사용합니다.

```bash
npm run rebuild:native
```

## 패키징 스크립트

```bash
npm run package
npm run package:installer
npm run package:dir
npm run package:mac
npm run package:mac:dir
```

산출물은 기본적으로 `release/`에 생성됩니다.

## 주요 의존성

- `electron`
- `electron-builder`
- `node-pty`
- `@xterm/xterm`
- `@xterm/addon-fit`

## 자주 보는 환경 변수

- `PWSH_PATH`: Windows에서 PowerShell 7 경로 강제 지정
- `VIBE_TERMINAL_COLOR_MODE`: 터미널 색상 처리 모드 설정
- `VIBE_OPEN_DEVTOOLS=1`: 개발 중 창 로드 후 devtools 자동 열기
- `VIBE_FORCE_PWSH7_INSTALL_FAIL=1`: PowerShell 7 설치 실패 경로 테스트
- `SKILLS_API_URL`: 스킬 카탈로그 API 기본 주소 변경
- `NODE_ENV=production`: 프로덕션 동작 강제

## 상태 파일과 운영 데이터

- 레이아웃 저장 파일: 사용자 데이터 경로 아래 `state/layout-state.json`
- 앱 아이콘: `assets/`
- 빌드 설정: `build/`

운영 중 문제가 날 때는 저장된 `layout-state.json`이 복원 실패를 유발하는지 먼저 확인하는 편이 빠릅니다.

## 문서 갱신 기준

아래 항목이 바뀌면 `docs/`도 함께 수정하는 것이 좋습니다.

- preset 종류나 pane 배치 규칙
- preload API 변경
- IPC 채널 추가, 제거, 이름 변경
- 세션 복원 방식 변경
- 패키징 스크립트 또는 필수 런타임 조건 변경

## 추천 수동 점검

1. 앱 실행
2. preset 전환
3. pane별 에이전트 실행
4. 레이아웃 저장 후 재실행 복원
5. 창 닫기와 재실행

이 다섯 가지가 현재 앱의 핵심 회귀 포인트입니다.
