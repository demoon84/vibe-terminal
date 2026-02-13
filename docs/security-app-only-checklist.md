# 앱 내 즉시 적용 보안 체크리스트

기준: 2026-02-12  
원칙: 외부 인프라/운영 정책 없이, 코드 수정만으로 앱에서 바로 처리 가능한 항목만 포함

## 작업 순서

1. 인증 표면 축소
- [x] URL query token 인증 제거 (`server/index.js`)
- [x] 헤더 기반 토큰만 허용 (`Authorization`, `x-api-token`)

2. 브라우저/웹 클라이언트 경계 강화
- [x] HTTP Origin 검증 추가 (`server/index.js`)
- [x] WebSocket Origin 검증 추가 (`server/index.js`)
- [x] 기본 보안 헤더 + CSP 적용 (`server/index.js`)

3. 남용 방어
- [x] 서버 인메모리 rate limit 추가 (`server/index.js`)
- [x] rate limit 환경변수 추가 (`server/config.js`)

4. Electron 프로세스 격리 강화
- [x] 렌더러 sandbox 활성화 (`src/main/main.js`)

5. 운영 가시성
- [x] 새 보안 설정 환경변수 문서화 (`README.md`)

## 설정 항목

- `ALLOWED_ORIGINS`
  - 예: `ALLOWED_ORIGINS=http://127.0.0.1:4310,http://localhost:4310`
- `ALLOWED_ORIGINS_DEV`
  - 예: `ALLOWED_ORIGINS_DEV=http://127.0.0.1:4310,http://localhost:4310`
- `ALLOWED_ORIGINS_STAGE`
  - 예: `ALLOWED_ORIGINS_STAGE=https://staging.example.com`
- `ALLOWED_ORIGINS_PROD`
  - 예: `ALLOWED_ORIGINS_PROD=https://app.example.com`
- `RATE_LIMIT_WINDOW_MS`
  - 기본: `60000`
- `RATE_LIMIT_MAX_REQUESTS`
  - 기본: `240`

## 배포 전 보안 점검 진행상태 (2026-02-12)

- 자동 회귀 테스트: 완료 (`test/security-regression.test.js`)
- 실행 명령: `npm test -- test/security-regression.test.js`
- Playwright 스모크 검증: 완료 (로컬 HTTP + 테스트 브릿지 주입)
- 미완료(추가 권장):
  - 실제 패키징된 Electron 빌드에서 동일 시나리오 1회 재검증
- 작업 목록 문서: `docs/security-worklist.md`
