# Vibe Terminal 보안 위협 점검 체크리스트

기준일: 2026-02-12  
범위: `src`, `server`, `public` 기준 정적 코드 점검

## 1) 위협 요약 (현재 코드 기준)

- 로컬/원격 요청 처리 서버(Express + WebSocket)와 Electron 렌더러/메인 IPC 경계가 핵심 공격면입니다.
- 특히 "렌더러 코드 실행(XSS/취약 플러그인/악성 스크립트)"이 발생하면 PTY/클립보드/명령 실행 경로로 수평 확장될 가능성이 큽니다.

## 2) 우선순위 체크리스트

### Critical

- [x] Electron 렌더러 샌드박스 활성화
  - 위협: 렌더러 침해 시 OS 권한 상승 위험 증가
  - 코드 근거: `src/main/main.js:793` (`sandbox: false`)
  - 조치: `sandbox: true` 전환 후 preload API 최소화/회귀 테스트

- [x] 명령 실행 입력(`panel.command`) 통제
  - 위협: 악성 명령 실행, 시스템 손상, 정보 유출
  - 코드 근거: `server/panelManager.js:208`, `server/panelManager.js:261`
  - 조치: 허용 명령 allowlist, 위험 플래그 차단, 관리자 승인 플로우

- [x] IPC 기반 PTY 생성 권한 제한
  - 위협: 렌더러 타협 시 임의 PTY 생성/입력/종료 가능
  - 코드 근거: `src/preload/preload.js:14`, `src/main/ipc-router.js:71`
  - 조치: IPC 호출자 검증(프레임/오리진), 세션별 capability 토큰 도입

- [x] 인증 토큰의 URL 전달 금지
  - 위협: 로그/리퍼러/히스토리 기반 토큰 유출
  - 코드 근거: `server/index.js:45`
  - 조치: `Authorization`/`x-api-token`만 허용, query token 제거

### High

- [x] Loopback 신뢰 정책 재검토
  - 위협: 로컬 악성 프로세스가 무인증 API/WS 호출
  - 코드 근거: `server/index.js:65`
  - 조치: 운영 모드에서 loopback도 토큰 필수화(옵션 플래그 가능)

- [x] WebSocket/HTTP 오리진 검증 추가
  - 위협: 교차 출처 페이지에서 로컬 서비스 악용(CSRF 유사)
  - 코드 근거: `server/index.js:152`, `server/index.js:332`
  - 조치: 허용 `Origin` 검증 및 불일치 요청 거부

- [x] 보안 헤더/CSP 적용
  - 위협: XSS/클릭재킹/콘텐츠 인젝션 노출
  - 코드 근거: `server/index.js:159` (정적 서빙만 존재, 헤더 미적용)
  - 조치: `helmet` + 엄격 CSP + frame-ancestors 제한

- [x] API/WS rate limit 및 실패 로깅 추가
  - 위협: 무차별 요청, 자원 고갈, 토큰 추측
  - 코드 근거: `server/index.js` 전반(제한 없음)
  - 조치: IP/token 단위 제한, 429 정책, 보안 이벤트 텔레메트리

- [x] 클립보드 IPC 접근 정책 수립
  - 위협: 클립보드 민감정보 탈취/변조
  - 코드 근거: `src/main/main.js:970`, `src/main/main.js:974`
  - 조치: 사용자 액션 기반 호출만 허용, 호출 빈도 제한/감사 로그

### Medium

- [x] `cwd`/`env` 입력 유효성 검증 강화
  - 위협: 의도치 않은 경로/환경오염, 명령 행태 변조
  - 코드 근거: `server/panelManager.js:140`, `server/panelManager.js:145`
  - 조치: 키 패턴 검증, 금지 환경변수 목록, 경로 존재/권한 체크

- [x] 민감 데이터 저장 최소화
  - 위협: 작업 기록/환경변수/출력 로그의 평문 노출
  - 코드 근거: `server/storage.js:7`, `server/storage.js:29`, `server/telemetry.js:37`
  - 조치: 저장 대상 최소화, 마스킹, 보관 기간/삭제 정책

- [x] 검색/렌더링 XSS 안전성 회귀 테스트
  - 위협: 추후 UI 변경 시 DOM 인젝션 회귀
  - 코드 근거: `public/app.js:169` (`innerHTML` 템플릿), `public/app.js:257` (`window.find`)
  - 조치: untrusted 문자열은 `textContent` 유지, DOMPurify 정책 고려

- [x] 의존성 취약점 스캔 파이프라인 복구
  - 위협: 알려진 CVE 미탐지
  - 현황: `npm audit --omit=dev --json` 실패(사설 레지스트리 응답 오류)
  - 조치: CI에서 공용 advisory DB 경로 또는 대체 스캐너(OSV/Snyk) 구성

## 3) 운영 점검 루틴 (권장)

- [ ] 배포 전: Critical/High 전부 통과
- [ ] 주간: 의존성 스캔 + 로그 샘플링 + 토큰/권한 정책 점검
- [ ] 월간: 위협 모델 재평가(신규 IPC/API/패키지 반영)
