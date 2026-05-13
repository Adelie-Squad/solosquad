# 2026-05-13 — Tier 1 확장: paperclip / claw3d / Ralphathon

> Event Record. 2026-05-11 baseline-survey 7개 레퍼런스에 3건 추가(#8–#10). 사용자 지정 즉시 승격(Tier 2→1 2회 관측 규칙 미경유 — §Open Questions 4 참조). 본 레코드는 베이스라인 대비 차분 형태.

> **청자 주의**: 본 레코드의 "SoloSquad 정합성" 표는 **SoloSquad 개발자(본인)** 의 채택 여부 평가다. end-user 제품 기능 백로그가 아니다.

## TL;DR
- **Ralphathon**(Ralph Loop 해커톤 문화)은 **본인 개발 워크플로에 즉시 시험 가능한 가장 저비용 신패턴** — Anthropic이 2025-12 stop-hook 플러그인으로 공식화. 다음 기능 1개를 ralph 루프로 야간 빌드 시도가 1순위 액션.
- **paperclip**은 "에이전트 거버넌스 인프라화" 패러다임을 OSS로 압축 — **본인 dev 환경(단일 Claude Code 워크플로)** 엔 과잉이지만, budget envelope 패턴만 발췌해 본인 dev 비용 통제에 차용 검토.
- **claw3d**는 새 카테고리(supervision/visualization layer)를 시사 — 솔로 개발자가 자기 터미널을 직접 보는 현재로선 `not-applicable`. 향후 멀티-에이전트 dev 워크포스 운용 시 재평가 후보.

---

## 신호

| 출처 | 신호 | 캡처 |
|---|---|---|
| [paperclipai/paperclip](https://github.com/paperclipai/paperclip), [paperclip.ing](https://paperclip.ing/) | OSS 멀티에이전트 오케스트레이션 — "human control plane for AI labor". org chart, 역할/보고 라인, 월예산 한도(100% 도달 시 auto-pause), 승인 게이트, immutable audit log. 멀티런타임(Claude/OpenClaw/Cursor) | 2026-05-13 |
| [iamlukethedev/claw3d](https://github.com/iamlukethedev/claw3d), [claw3d.ai](https://www.claw3d.ai/) | 3D 가상 오피스로 에이전트 활동 가시화. OpenClaw/Hermes 등 런타임 무관 supervision UI. Three.js + WebSocket gateway. 로그/대시보드 대체 메타포 | 2026-05-13 |
| [ghuntley.com/ralph/](https://ghuntley.com/ralph/) (Huntley, 2025-07-14 원문) | Ralph Loop 정의: `while :; do cat PROMPT.md \| claude-code; done`. 1 task / loop, fix_plan.md 헬스 시그널, 테스트 통과 시 commit + 태그(0.0.0→0.0.1), reset/reboot 옵션 | 2026-05-13 |
| [HumanLayer — Brief History of Ralph](https://www.humanlayer.dev/blog/brief-history-of-ralph) (Dex Horthy) | 타임라인: 2025-06 meetup → 2025-07 블로그 → 2025-08 HN "while loop ships 6 repos overnight"([repomirrorhq/repomirror](https://github.com/repomirrorhq/repomirror/blob/main/repomirror.md)) → 2025-10 Claude Code Anonymous SF → 2025-12 **Anthropic 공식 플러그인(stop-hook 메커니즘)** → 2026-01-01 "Ralph Wiggum Showdown" 라이브 비교 스트림 | 2026-05-13 |
| [snwfdhmp/awesome-ralph](https://github.com/snwfdhmp/awesome-ralph) | 큐레이션: ralph-claude-code, choo-choo-ralph, snartank/ralph, smart-ralph, ralph-orchestrator(Rust+7백엔드), oh-my-ralph(Python), ralph-loop-agent(Vercel TS SDK), multi-agent-ralph-loop. 커뮤니티: r/ralphcoding, Discord(`discord.gg/MUyRMqKcWx`) | 2026-05-13 |
| [Dev Interrupted — Inventing the Ralph Wiggum Loop](https://devinterrupted.substack.com/p/inventing-the-ralph-wiggum-loop-creator) | Huntley 인터뷰. "the loop is the hero, not the model" — 모델 능력보다 루프 구조가 결과를 결정한다는 명제 | 2026-05-13 |
| Huntley CURSED 사례 (위 ghuntley.com/ralph/ 본문 + [VentureBeat 보도](https://ghuntley.com/ralph/)) | 3개월 단일 루프로 LLVM 백엔드 보유 프로그래밍 언어 완성. $50k 도급 견적 MVP를 API $297로 납품한 SFO 엔지니어 사례 | 2026-05-13 |

§1 예외 적용(Ralphathon): 1차 GitHub 출처 없음. 위 4개 채널(Huntley 블로그·HumanLayer 분석·awesome-ralph 큐레이션·Dev Interrupted 인터뷰)이 **재참조 가능 + 독립 운영자** 기준 충족. "YC 해커톤" 표현은 출처마다 "Y Combinator 해커톤" 또는 "어느 해커톤"으로 엇갈림 — 안전한 표현은 "2025-08 HN에 보고된 어느 해커톤에서 단일 야간에 6개 repo 출하" (대표 사례: repomirrorhq/repomirror).

---

## 레퍼런스별 상세

### 8. paperclipai/paperclip
- **정체**: Node.js 서버 + React UI로 구성된 멀티 에이전트 오케스트레이션 플랫폼. MIT, self-host. 별도 paperclip 계정 불필요.
- **핵심 패턴**:
  - **Org chart 모델** — 역할/보고 라인을 데이터로 모델링, 사용자(=board)가 hire/strategy/budget 승인.
  - **Budget envelope** — 에이전트별 월예산. 100% 도달 시 atomic execution 중단(자동 pause). runaway 토큰 비용 방지.
  - **Heartbeat 실행** — 영속 상태로 재시작 없이 multi-step 작업 재개.
  - **런타임 무관** — Claude Code, Codex, OpenClaw, Cursor 등 BYO agent.
  - **Audit log immutable** — 의사결정/오버라이드 전부 기록, 보드 수준 통제.
- **3축 매핑**:
  - 하네스: **중** — runtime-agnostic shim. 영속 상태 + heartbeat은 컨텍스트 운영의 외부화지만, 컴팩션/메모리 구조는 자체 발명 없음
  - 멀티에이전트: **상** — org-chart 거버넌스 + audit log는 핸드오프 인프라화의 가장 명시적 레퍼런스
  - 24-7 자동화: **상** — 예산 게이트가 자율 의사결정 경계의 새로운 표준 후보 (autoresearch의 metric gate와 대칭)

### 9. iamlukethedev/claw3d
- **정체**: 3D 가상 오피스 visualization layer. MIT, self-host. 매니지드 호스팅 $29/월 출시 예정.
- **핵심 패턴**:
  - **Spatial presence** — 에이전트를 office worker로 시각화, 로그/대시보드 대체.
  - **Runtime-agnostic** — OpenClaw/Hermes/custom HTTP/번들 demo gateway 호환.
  - **운영 기능 통합** — standup, PR 리뷰, 세션 관리, QA 파이프라인, 스킬 학습을 워크스페이스 안에서.
  - **인프라** — Node.js Studio 서버 + Three.js 렌더링 + WebSocket 프록시.
- **3축 매핑**:
  - 하네스: **—** — 하네스 패턴 없음 (관찰 레이어)
  - 멀티에이전트: **중** — 공유 spatial state, 런타임 무관 supervision. 협업 모델 자체를 새로 만들진 않음
  - 24-7 자동화: **중** — supervision이 사실상 human-in-the-loop 위치. 대시보드 polling을 공간 메타포로 대체

### 10. Ralphathon (Ralph Loop 해커톤 문화)
- **정체**: Geoffrey Huntley가 2025-07-14 공개한 **bash while-loop 코딩 에이전트 패턴**과 그 주변 해커톤·커뮤니티 문화. 단일 제품이 아닌 기술 + 운영 노하우 + 행사 클러스터.
- **핵심 패턴**:
  - 루프 본문은 단일 프롬프트 파일 재투입. 에이전트는 파일/git 히스토리를 읽어 이전 진척 회복.
  - **1 task / loop**, fix_plan.md를 헬스 시그널로 모니터, 자주 폐기·재생성.
  - 테스트 통과 시 commit + semantic tag(0.0.0→0.0.1). 미해결 시 codebase reset + 루프 reboot.
  - **2025-12 Anthropic 공식화**: Claude Code stop-hook 플러그인으로 외부 bash 루프 없이 세션 종료를 가로채는 방식 표준화.
- **운영 경험치(해커톤·커뮤니티 사례)**:
  - 2025-08 HN: 어느 해커톤에서 단일 야간에 6 repo 출하(repomirrorhq/repomirror 대표).
  - CURSED 프로그래밍 언어: Huntley 단독 3개월 루프, LLVM 백엔드 + macOS/Linux/Windows 바이너리.
  - SFO 엔지니어: $50k 도급 견적 MVP를 API $297로 납품.
  - 커뮤니티: Reddit `r/ralphcoding`, Discord, Matt Pocock·BoundaryML·Dev Interrupted 팟캐스트.
- **3축 매핑**:
  - 하네스: **상** — 컨텍스트 윈도우 종료를 트리거로 외부 상태(파일/git)에서 재구성하는 패턴. Anthropic stop-hook 표준화로 1급 레퍼런스 진입
  - 멀티에이전트: **—** — 단일 에이전트 루프. multi-agent-ralph-loop 같은 변형이 있으나 핵심 패턴은 단일
  - 24-7 자동화: **상** — 새 트리거 유형 "스펙 충족 루프"(autoresearch의 metric gate와 대칭). 자율 의사결정 경계가 가장 공격적인 사례

---

## 베이스라인(2026-05-11) 대비 차분

### 차분 1 — 24-7 트리거 분류에 "spec-gate" 추가 (개발 방법론 직접 차용 가능)
베이스라인 D축은 cron / metric delta / external signal / conversation auto-load의 4종 분류였음. Ralphathon은 **5번째 트리거 유형 "스펙 충족 루프(spec-gate)"** 를 추가.

| 트리거 유형 | 레퍼런스 | 본인 개발 방법론 채택 가능성 |
|---|---|---|
| Cron | OpenClaw | dev 환경엔 무관 |
| Metric delta (metric-gate) | karpathy/autoresearch | ML 실험형 작업에만 적용. 일반 dev엔 좁음 |
| External signal | MiroFish, Hermes | 트리거가 외부 의존, dev 일과엔 부적합 |
| Conversation auto-load | phuryn, Hermes | 이미 Claude Code skill auto-load로 부분 적용 중 |
| **Spec-gate (while-loop)** | **Ralphathon + Anthropic 2025-12 stop-hook 플러그인** | **즉시 시험 가능** — spec.md 작성 → ralph 루프 → 야간 빌드 |

→ **본인 dev 사이클에 가장 저비용으로 도입 가능한 신패턴은 spec-gate.** Anthropic 공식 플러그인이 stop-hook 메커니즘으로 활성화 비용을 0에 가깝게 만듦.

### 차분 2 — 핸드오프 위에 거버넌스 계층 — 본인 dev 환경엔 과잉
베이스라인 B는 "gstack/SoloSquad/Hermes 모두 _handoff 산출물 패턴"으로 컨센서스 확인. paperclip은 그 위에 **승인 게이트 + 예산 envelope + immutable audit log** 를 인프라로 묶음. → **그러나 본인은 현재 단일 Claude Code 세션에서 단발 작업**. paperclip 전체를 dev 도구로 들이는 건 과잉. 가져갈 가치가 있는 부분은 **budget envelope 패턴만** (본인 dev 토큰 비용 통제용).

### 차분 3 — supervision layer는 솔로 dev엔 무관, 멀티-에이전트 dev 워크포스 운용 시 재평가
베이스라인 3축은 모두 **실행** 관련. claw3d는 **관찰** 레이어를 단독 카테고리로 제시. 솔로 개발자가 본인 터미널을 직접 보는 한 supervision UI는 가치 0. **본인이 paperclip식 멀티-에이전트 dev 운용을 시작하는 시점이 와야** 의미가 생김 — 그 시점까지 보류.

---

## SoloSquad 정합성 (개발자 = 본인의 채택 여부)

평가축 우선순위: ① **본인 dev 워크플로·방법론** 채택 → ② SoloSquad **harness/runtime 내부** 차용 → ③ end-user 기능(고려 후순위).

| 레퍼런스 | 채택 가능성 | 충돌 지점 (개발자 본인 컨텍스트) | 통합 비용 | 제안 액션 |
|---|---|---|---|---|
| Ralphathon (Ralph Loop) | **`immediately`** (dev 방법론) | 본인이 현재 단발 Claude Code 세션 위주로 작업. Ralph 루프는 "스펙 충족까지 자율 반복" — 무인 시간(야간/외출) 활용 못 하던 일정을 활용 가능으로 전환. 충돌이라기보다 미사용 자원. | 매우 낮음 — Anthropic 2025-12 stop-hook 플러그인 설치 + spec.md 작성 | (1) 다음 SoloSquad 기능 1개(예: `solosquad sync` 정리 작업)를 spec.md로 정의 후 ralph 루프 야간 시범. (2) 결과 git 히스토리·비용·완성도를 캡처 → 이후 본인 dev 표준 사이클에 ralph 모드 편입 여부 결정. (3) **별개 결과로** harness 내부(claude-runner)에 spec-gate 모드 이식 여부는 시범 후 판단 |
| paperclip — budget envelope 패턴만 | `experimental` (dev 비용 통제) | 본인이 Claude Code 단일 워크플로. paperclip 전체(org chart + 승인 + audit)는 멀티-에이전트 운용 전제로 과잉. 단, **budget envelope** 자체는 본인의 일일/주간 Claude 토큰 비용 캡으로 직접 차용 가치 | 낮음 (패턴만 모방 — 환경변수 + 일별 사용량 트래커) | paperclip 직접 도입은 ❌. 본인 dev 환경에 토큰 비용 알람(예: 일 $X 도달 시 stop)을 별도 셸 스크립트/Claude Code hook로 구현. paperclip 전체 도입은 본인이 paperclip식 멀티-에이전트 dev 워크포스로 전환할 때 재평가 |
| paperclip — 전체 (org chart + 멀티런타임 오케스트레이션) | `not-applicable` (현 단계) | 1인 dev + 단일 모델. org chart/role/보고 라인은 dev 환경에 의미 없음 | 높음 | 보류. 본인이 dev에 Codex/Cursor를 병행 사용하기 시작하면 그 시점 재평가 |
| claw3d | `not-applicable` | 솔로 개발자가 본인 터미널·git diff를 직접 봄. 3D supervision UI는 정보 추가 0 | 매우 높음 | 직접 도입 ❌. paperclip 전체 도입 시점이 와야 함께 재평가 |

---

## Open Questions

- [ ] **Ralph 시범의 첫 타겟**은 무엇으로 잡을 것인가? (요건: 스펙이 명확히 적힐 수 있고, 테스트로 종료 판정이 가능하며, 야간 단위로 끝날 분량. 현 백로그에서 후보 추리기)
- [ ] Anthropic 2025-12 Ralph stop-hook 플러그인의 인터페이스 — cli 옵션 / 환경 변수 / hook config 중 무엇으로 노출되는가? 본인 dev 환경에서 활성화 절차 1회 확인 필요.
- [ ] Ralph 시범 결과가 좋다면, SoloSquad **harness 내부**(claude-runner)에 spec-gate 모드를 이식하는 결정은 별개 — 어떤 데이터(완성률/비용/회복불능 실패 빈도)를 기준으로 판단할 것인가?
- [ ] 본인 dev 비용 통제용 budget envelope을 paperclip 패턴에서 모방할 때, 일/주/월 중 어느 캡을 우선할 것인가? 도달 시 행동(알람만 vs 자동 stop)?
- [ ] **운영 규칙 보완**: 이번 3건은 사용자 지정으로 Tier 2 미경유 직접 승격됨. SKILL.md §1 승격 규칙("Tier 2 2회 관측")만으로는 신규 등장 OSS를 빠르게 추적할 수 없음. "사용자 지정 즉시 승격" 트랙을 명시화할 것인가?

---

## 다음 추적 사이클 영향

| 항목 | 조정 |
|---|---|
| 2026-05-17(일) 주간 스캔 대상 | 7 → 10건. 신규 3건 첫 주간 변화 추적 시작 |
| 2026-05-31 Monthly Digest | **본인 Ralph 시범 1회 결과**(시도했다면) + paperclip budget envelope 모방 도입 여부 1차 평가 |
| Anthropic Ralph 플러그인 추적 | 별도 Event Record 후보 — stop-hook 인터페이스가 안정화 / 변경되면 즉시 capture |

---

## 출처

1. https://github.com/paperclipai/paperclip
2. https://paperclip.ing/
3. https://github.com/iamlukethedev/claw3d
4. https://www.claw3d.ai/
5. https://ghuntley.com/ralph/ — Huntley 원문 (2025-07-14)
6. https://www.humanlayer.dev/blog/brief-history-of-ralph — Dex Horthy 타임라인
7. https://github.com/snwfdhmp/awesome-ralph — 커뮤니티 큐레이션
8. https://devinterrupted.substack.com/p/inventing-the-ralph-wiggum-loop-creator — Dev Interrupted 인터뷰
9. https://github.com/repomirrorhq/repomirror — "6 repos overnight" 대표 사례
10. https://github.com/snarktank/ralph — PRD-driven 변형
11. https://itnext.io/ralph-loop-is-innovative-i-wouldnt-use-it-for-anything-that-matters-cd92f2f0df2e — 비판적 시각(Simon Wang)
12. https://paddo.dev/blog/ralph-wiggum-autonomous-loops/ — Claude Code 구현 가이드

---

## 변경 이력
- 2026-05-13: 최초 작성. SKILL.md §1 Tier 1 표가 7→10개로 확장된 변경(같은 날 커밋)에 대한 베이스라인 차분 레코드. 사용자 지정 즉시 승격(Tier 2 미경유) 1차 사례 — §Open Questions 4에서 운영 규칙 보완 제기.
