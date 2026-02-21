# CHANGELOG

이 문서는 작업 이력을 기록한다.

## 2026-02-21
- 요청 요약: 작업 이력 기록 기준을 커밋 중심에서 `CHANGELOG.md` 중심으로 정리.
- 변경 파일: `AGENTS.md`, `CHANGELOG.md`
- 검증 결과: `AGENTS.md` 작업 절차 규칙 반영 확인, `CHANGELOG.md` 생성 확인.
- 요청 요약: 맥 설치 파일 패키징 실행.
- 변경 파일: `CHANGELOG.md` (산출물: `release/Vibe Terminal-1.0.2-arm64.dmg`)
- 검증 결과: `npm run package:mac` 종료 코드 0, DMG 및 blockmap 생성 확인.
- 요청 요약: 규칙 설정 화면에서 최신 `AGENTS.md` 내용이 반영되지 않는 문제 수정.
- 변경 파일: `src/main/main.js`, `CHANGELOG.md`
- 검증 결과: `node --check src/main/main.js` 통과, `~/Library/Application Support/vibe-terminal-layout-system/AGENTS.md` 동기화 후 문구 반영 확인.
