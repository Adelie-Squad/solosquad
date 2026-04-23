# SoloSquad 개발 현황 & 로드맵

> 릴리스된 버전, 진행 중인 계획, 결정 로그, 외부 참고자료를 한 자리에 모은 롤링 문서.

**최종 업데이트:** 2026-04-23

---

## 1. 릴리스 현황

### npm에 배포된 버전 (사용 가능)

| 버전 | 날짜 | 주요 내용 | 문서 |
|---|---|---|---|
| `v1.0.0` | 초기 | 코어 구조 | — |
| `v1.1.0` | — | 크로스 플랫폼 (Windows/macOS/Linux) | `v1.1-cross-platform.md` |
| `v1.1.1` | — | QA 하드닝 | `v1.1.1-qa-hardening.md` |
| `v1.1.2` | — | npm 퍼블리시 | `v1.1.2-npm-publish.md` |
| `v1.1.3` | 2026-04-21 | **hotfix** — `dotenv/config` 로드 누락 수정 | `v1.2.1-messenger-debugging.md` |
| `v1.1.4` | 2026-04-21 | **hotfix** — `solosquad update`의 `package.json` 경로 해석 오류 수정 | 동일 |
| `v1.1.5` | 2026-04-21 | **hotfix** — Windows에서 `claude.cmd` 실행 시 ENOENT | 동일 |
| `v1.2.0` | 2026-04-23 | GitHub-aligned 레이아웃 재편 + 마이그레이션 프레임워크 | `v1.2.2-terminology-layout.md`, `v1.2.3-migration-process.md` |

### 현재 설치 가능 버전: `1.2.1` (npm `latest` 태그, 배포 예정)

**다음 배포:** `v1.2.1` — v1.2.0 배포 직후 발견된 UX·구조 이슈 해결 + `add org/repo/sync` 명령 도입.

> **문서 파일명 vs npm 버전:** `docs/v1.2.2-*.md` / `docs/v1.2.3-*.md`는 **작업 블록 라벨**. 실제 npm 출시 번호는 semver를 따릅니다.

---

## 2. v1.2.1 블록 — 배포 대기 (2026-04-23)

**핵심 아이디어:** v1.2.0 에서 드러난 UX 버그 수정 + org/repo 관리 CLI 완성 + cross-repo 런타임 기반 + 회귀 테스트.

### 2.1 포함 변경 사항

| 영역 | 내용 |
|---|---|
| **버그 수정** | `solosquad migrate --dry-run` unknown option 해소. 모든 CLI 명령 시작 시 layout 버전 배너(v1.1.x → v1.2.x 사용자도 감지) |
| **구조 변경** | `<org>/repositories/` 중간 계층 도입. 시스템 폴더(`memory/`, `workflows/`, `slack/`)와 코드 저장소 분리. `repository/` 단수 대신 복수형 유지 |
| **신규 CLI** | `solosquad add org <name>` — 워크스페이스에 조직 추가<br>`solosquad add repo <url\|path>` — clone 또는 등록(외부 경로 이동 지원, org 자동 판정)<br>`solosquad sync` — repositories/ 스캔 + `.org.yaml` 동기화 + legacy `.git` 감지 & 정리 안내 |
| **런타임 (A2)** | `src/bot/workflow-resolver.ts` — `resolveOrgCwd()` — 활성 workflow stage 의 `target_repo` → main-role repo → 레거시 루트 순 fallback. 봇·스케줄러 모두 교체 |
| **Init 개선** | Step 5.1 저장소 다중 등록 루프 — URL/경로 반복 입력 |
| **마이그레이션** | `1.2.0 → 1.2.1` no-op 스크립트: 각 org 에 `repositories/` 폴더 자동 생성 + workspace.yaml 버전 갱신 (기존 v1.2.0 사용자 silent 업그레이드) |
| **회귀 테스트 (A3)** | `test/migration-v1.1-to-v1.2.test.ts` — dry-run / apply / multi-messenger / rollback / idempotent / chain to 1.2.1 (6 케이스) |

### 2.2 설계 결정 (2026-04-23)

- **`repositories/` 중간 계층 도입** — OpenClaw / Ralph / Hermes 조사 결과 피어 프로젝트들은 시스템 폴더와 코드를 한 층에 섞지 않음. GitHub flat 관례에 집착할 이유가 약하다고 판단. 시스각적 분리 + 이름 충돌 방지.
- **`add repo` org 자동 판정** — 단일 org 면 자동, 복수 org 면 cwd 기반 추론 or 질문. 반복 질문 피로 최소화 + 오인 가능성 0.
- **Legacy `.git` 정리 타이밍** — 마이그레이션 스크립트가 아닌 `solosquad sync` 에서 처리. 이미 마이그레이션 끝낸 사용자가 자기 페이스로 정리 가능. Normalize / Keep legacy 양 옵션 제공.
- **단수 vs 복수 폴더명** — `repositories/`, `workflows/` 복수 유지. 내용물(다수)과 이름이 일치하는 게 자연스럽고, 기존 yaml 필드(`products:`, `repos:`)와의 일관성 유지.

### 2.3 배포 절차

1. ✓ 코드 구현 (B1, B2, A1, A2, A3)
2. ✓ `npx tsc --noEmit` — 컴파일 통과
3. ✓ `node --test test/*.test.ts` — 8/8 통과
4. ✓ 문서 반영 (v1.2.2 스펙, update-migration-guide, CLAUDE.md)
5. ✓ `package.json` 1.2.0 → 1.2.1
6. ⏳ `npm publish` (OTP 필요)

### 2.4 미구현 (차기)

- Cross-repo workflow 조율(의존 repo 간 PR 타이밍 자동화) — 현재는 `target_repo` per stage 까지만
- Monorepo 감지 (`apps/frontend`, `apps/backend` 분할)
- 채널명 → org 라우팅 정교화 (현재는 기존 product 매핑 로직 재사용)
- Orchestrator 가 workflow 상태를 바꾸는 자동화 ( stage `in_progress` 전환)

---

## 3. 장기 로드맵 (순서 미정)

| 버전 | 주제 | 문서 |
|---|---|---|
| `v1.3.x` | 자율 실행 엔진 | `docs/v1.3-autonomous-engine.md` |
| `v1.4.x` | 스킬 자유도 | `docs/v1.4-skill-freedom.md` |
| `v1.5.x` | 지식 온톨로지 | `docs/v1.5-knowledge-ontology.md` |
| `v1.6.x` | 웹 대시보드 | `docs/v1.6-web-dashboard.md` |

---

## 4. 결정 로그 (주요)

- **2026-04-23** — `<org>/repositories/` 중간 계층 도입. 피어 프로젝트(OpenClaw/Ralph/Hermes) 조사에서 "시스템 폴더 + 코드 섞기" 패턴이 없음을 확인. GitHub flat 관례 재현 논거 철회.
- **2026-04-23** — `add repo` 의 org 판정은 "단일=자동, 복수=cwd→질문" 하이브리드. 묻지 않는 편의 vs 오인 방지 균형.
- **2026-04-23** — Legacy `.git` (v1.1.x 시절 product=repo) 정리는 `sync` 에서 사용자 선택(Normalize vs Keep). 마이그레이션 스크립트는 건드리지 않음 (이미 1.2.0 사용자 존재).
- **2026-04-22** — 한 워크스페이스 = 한 메신저 플랫폼. 복잡한 멀티 어댑터 동시 운영을 단순화. 복수 플랫폼 사용자는 워크스페이스를 여러 개 만들어 분리.
- **2026-04-22** — Organization 자동 clone 기능 제거 (v1.3+로 연기 검토). 사용자가 직접 `git clone`.
- **2026-04-22** — Workspace 루트 이름은 사용자 지정(`.solosquad/` 폴더 감지 기반). 기본 이름 `solosquad`, 페르소나 분리용 다중 루트 허용.
- **2026-04-22** — Windows 기본 경로 `~/Documents/solosquad-repos` 폐기. v1.2.0 단일 트리 루트로 통일.
- **2026-04-22** — 문서 파일명(v1.2.2, v1.2.3 등)은 작업 블록 라벨로 유지하고, npm 버전은 semver에 맞춰 1.1.5 다음 점프를 `v1.2.0`으로 정함. 문서 라벨 ↔ npm 버전은 1:1 매칭 아님.
- **2026-04-21** — 버전 표기는 `vN.N.N` 3자리 고정. 2자리(`v1.2`)는 문서 내 참조 약어로만, 공식 릴리스는 항상 3자리.
- **2026-04-21** — v1.1.3~v1.1.5는 작은 hotfix 연쇄로 빠르게 출시 (dotenv·update·Windows claude.cmd).

---

## 5. 관련 문서

- **아키텍처:** `docs/architecture.md`
- **설치 가이드:** `docs/setup-guide.md`
- **업데이트/마이그레이션 (사용자용):** `docs/upgrade-migration-guide.md`
- **클라우드 배포:** `docs/cloud-deployment.md`
- **메신저 디버깅 (v1.1.3-1.1.5 이력):** `docs/v1.2.1-messenger-debugging.md`
- **안전/보안:** `docs/v1.2-safety-security.md`
- **v1.2.2 구조 재편 스펙:** `docs/v1.2.2-terminology-layout.md`
- **v1.2.3 마이그레이션 프레임워크:** `docs/v1.2.3-migration-process.md`

---

## 6. 외부 레퍼런스

- https://github.com/openclaw/openclaw — npm 퍼블리시 + `update`/`doctor` 패턴 참고
- https://github.com/666ghj/MiroFish — 멀티 에이전트 시뮬레이션
- https://github.com/anthropics/claude-code — Claude Code CLI 공식
- https://github.com/karpathy/autoresearch — 리서치 자동화 참고
