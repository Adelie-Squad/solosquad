# 2026-05-11 — Baseline Survey: 7개 레퍼런스 × 3축 진단

> Trend Tracker 에이전트 신설과 함께 작성된 최초 베이스라인. 이후 모든 월간 digest와 신호 레코드는 이 문서의 매핑을 기준선으로 차분(diff)을 기록한다.

## TL;DR
- 7개 레퍼런스 전수 확인, 1건 정정(`harrytang` → **garrytan/gstack** = Y Combinator CEO Garry Tan의 23개 슬래시 스킬 패키지).
- 외부 Markdown 메모리 + 명시적 핸드오프 산출물은 사실상 2026년 컨센서스. SoloSquad는 두 축 모두 정렬되어 있음.
- **가장 큰 갭은 자율 트리거 다양성** — SoloSquad는 cron 5종에 머무는 반면, 레퍼런스 군은 metric delta / external signal / conversation auto-load로 분기 중. 다음 분기 베팅 1순위 후보.

---

## 신호 (1차 출처 + 캡처 일시)

| 출처 | 신호 | 캡처 |
|---|---|---|
| [Anthropic Engineering — Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | Anthropic이 "harness engineering"을 정식 학문 영역으로 선언, initializer + coding agent 이중 하네스 패턴 공개 | 2026-05-11 |
| [Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk) | Subagent spawning + MCP가 SDK 1급 시민, context compaction 내장 | 2026-05-11 |
| [openclaw/openclaw](https://github.com/openclaw/openclaw), [docs](https://docs.openclaw.ai/automation/cron-jobs) | 자연어 cron + `update --channel dev\|stable` 자가 업데이트 채널 — SoloSquad `solosquad update`의 직접 차용원 | 2026-05-11 |
| [NousResearch/hermes-agent](https://github.com/nousresearch/hermes-agent) | 5+ tool-call trajectory를 백그라운드로 YAML+Markdown 스킬로 자동 요약 → 다음 유사 문제에서 자동 로드 | 2026-05-11 |
| [garrytan/gstack](https://github.com/garrytan/gstack) ([ARCHITECTURE.md](https://github.com/garrytan/gstack/blob/main/ARCHITECTURE.md)) | Think→Plan→Build→Review→Test→Ship→Reflect 슬래시 체인, `/pair-agent` 병렬 조율 | 2026-05-11 |
| [phuryn/pm-skills](https://github.com/phuryn/pm-skills) | 8 플러그인 / 65 스킬 / 36 워크플로 — auto-load + slash command 듀얼 트리거 | 2026-05-11 |
| [karpathy/autoresearch](https://github.com/karpathy/autoresearch), [Shopify Engineering 사례](https://shopify.engineering/autoresearch) | ~630 LoC 자율 ML 루프, Shopify 0.8B 모델이 1.6B 베이스라인 +19% (40개 메트릭에 일반화) | 2026-05-11 |
| [666ghj/MiroFish](https://github.com/666ghj/MiroFish), [mirofish.ink](https://mirofish.ink/) | CAMEL-AI OASIS 기반 1M 에이전트 swarm 예측 엔진, 2026-03 GitHub Global Trending 1위 | 2026-05-11 |

---

## 레퍼런스별 상세

### 1. Anthropic — Claude Agent SDK
- **정체**: Claude Code SDK를 범용 에이전트 하네스로 리브랜딩한 공식 프레임워크.
- **핵심 패턴**:
  - Initializer agent가 feature list / git repo / progress 파일을 셋업 → coding agent가 세션마다 점진적 진행 (장기 실행의 표준 분해).
  - Context compaction 표준 기능화.
  - Subagent spawning + MCP가 SDK 1급 시민.
- **3축 매핑**:
  - 하네스: **상** — 컴팩션 + 진행 파일 외부화의 정답 레퍼런스
  - 멀티에이전트: **중** — spawning은 있으나 라우팅/핸드오프는 사용자 정의 영역
  - 24/7: **중** — 직접 스케줄러 아님, multi-session continuity 기초만 제공

### 2. OpenClaw
- **정체**: 메신저 채널(WhatsApp/Telegram/Discord/iMessage) 상주 24/7 퍼스널 어시스턴트 하네스.
- **핵심 패턴**:
  - `update --channel dev|stable` — SoloSquad가 이미 차용 중.
  - 자연어 cron + top-of-hour staggering, `--exact`/`--stagger` 옵션.
  - 메모리는 로컬 Markdown — 사용자 수동 편집 가능.
- **3축 매핑**:
  - 하네스: **상** — Markdown 외부 메모리 + 세션 라우팅 + 컴팩션
  - 멀티에이전트: **하** — 단일 퍼스널 에이전트 중심
  - 24/7: **상** — 카테고리 정의급 레퍼런스 (cron + persistent session + 메신저 polling)

### 3. Hermes Agent (Nous Research)
- **정체**: 2026-02 발표된 "self-improving" 오픈소스 에이전트, OpenClaw 직접 대안.
- **핵심 패턴**:
  - 5+ tool-call trajectory를 백그라운드 프로세스가 자동으로 스킬 markdown으로 요약 → 자동 로드.
  - Hot prompt memory vs cold SQLite+FTS5 아카이브, v0.7.0부터 pluggable.
  - 캐시 인식 시스템 프롬프트 스냅샷 — 학습이 토큰 비용 무한 증가하지 않도록 설계.
- **3축 매핑**:
  - 하네스: **상** — 자가 진화의 가장 완성된 레퍼런스 (skill 자동 생성 + FTS5 회상 + Honcho 유저 모델링)
  - 멀티에이전트: **중** — 스킬을 메모리로 본 단일 에이전트 (협업보다 자기증류)
  - 24/7: **상** — cron + 7개 메신저(Telegram/Discord/Slack/WhatsApp/Signal/Email/CLI) 라우팅

### 4. gstack (Garry Tan) — 사용자 메모: "harrytang"의 정정
- **정체**: YC CEO Garry Tan의 Claude Code 세트업을 오픈소스화한 **23개 슬래시 스킬** 패키지. CEO/Designer/Eng Manager/Release Manager/Doc Engineer/QA 역할을 명령으로 캡슐화.
- **핵심 패턴**:
  - Think → Plan → Build → Review → Test → Ship → Reflect — 이전 슬래시의 산출물이 다음 슬래시의 입력.
  - `/office-hours` → `/plan-eng-review` → `/qa` 체인. **구조화된 핸드오프가 차별점.**
  - `/pair-agent`로 동일 브라우저 분리 탭 병렬 실행 조율.
- **3축 매핑**:
  - 하네스: **중** — 개별 하네스가 아닌 슬래시 프로토콜 강제
  - 멀티에이전트: **상** — 핸드오프 프로토콜의 강한 레퍼런스, SoloSquad `_handoff.md`와 직접 정렬
  - 24/7: **—** — 명시적 스케줄러 없음 (인간 매개 sprint)

### 5. phuryn/pm-skills (Paweł Huryn)
- **정체**: PM 스킬 마켓플레이스. 8 플러그인 / 65 스킬 / 36 체이닝 워크플로. Claude Code, Cowork, Gemini CLI, Cursor, Codex, Kiro 호환.
- **핵심 패턴**:
  - **자동 로딩(대화 컨텍스트 기반) + `/command-name`(명시적 실행)** 듀얼 트리거. 라우팅 모델이 명확히 분리.
  - PM 영역을 discovery / strategy / execution / analytics / GTM / growth 6축 세그먼트. lean canvas / PESTLE / Porter's 5 Forces 등 검증된 프레임워크를 스킬로 인코딩.
- **3축 매핑**:
  - 하네스: **중** — auto-load vs slash 듀얼 모드
  - 멀티에이전트: **중** — 스킬 체이닝이 사실상 마이크로 핸드오프
  - 24/7: **—** — 도메인 지식 라이브러리 포지셔닝

### 6. karpathy/autoresearch
- **정체**: 2026-03-07 공개, ~630 LoC Python. 코딩 에이전트(Claude Code/Codex)에 `program.md`만 주면 ML 실험 자율 반복. 출시 며칠 만에 21k+ stars.
- **핵심 패턴**:
  - read → propose → 5-min train → measure → **commit-if-improved / rollback-if-not** 무한 루프.
  - "One GPU, one file, one metric" 미니멀리즘. 하룻밤 80~100 실험 / 15~20 개선 commit.
  - Shopify가 40+ 사내 메트릭에 일반화 → 0.8B 모델이 1.6B 베이스라인 +19%. **ML 학습을 넘어 "측정 가능한 모든 태스크"로 확장 가능 입증.**
- **3축 매핑**:
  - 하네스: **상** — 메트릭 게이트 + git rollback이 곧 메모리. 가장 미니멀한 자가 진화 레퍼런스
  - 멀티에이전트: **—** — 단일 에이전트 루프
  - 24/7: **상** — 신호 트리거 = "메트릭 개선 여부". autonomous decision의 가장 단순한 형태

### 7. MiroFish (Guo Hangjiang)
- **정체**: 중국 학부생이 만든 multi-agent swarm 예측 엔진. 2026-03 GitHub Global Trending 1위, Shanda 그룹 Chen Tianqiao 투자.
- **핵심 패턴**:
  - 실세계 시드(뉴스/정책/금융 시그널) → 고충실도 병렬 디지털 세계 → 수천~1M 에이전트가 독립 페르소나·장기 메모리로 사회적 상호작용 → 결과를 예측 리포트로 압축.
  - 트위터형/레딧형 두 플랫폼 동시 시뮬레이션.
  - 엔진은 CAMEL-AI **OASIS** — 1M 에이전트, 23종 사회적 행동 지원.
- **3축 매핑**:
  - 하네스: **중** — 에이전트별 개별 메모리 + 페르소나 카드
  - 멀티에이전트: **상** — 극단적 스웜 협업. 라우팅 대신 시뮬레이션된 사회적 그래프
  - 24/7: **중** — 외부 시그널(뉴스 시드)이 시뮬레이션 트리거 (SoloSquad `signal-scan`과 개념적 정합)

---

## 통합 관찰

### A. 외부 Markdown 메모리는 컨센서스
OpenClaw, Hermes, gstack, SoloSquad 모두 Markdown + 가벼운 인덱스(FTS5 / SQLite / JSONL)를 영속 메모리로 채택. 사람이 읽을 수 있고 `git diff`가 가능한 포맷이 사실상 표준. → **SoloSquad는 이미 정렬되어 있음. 추가 베팅 불필요.**

### B. 핸드오프 = 다음 스킬을 위한 명시적 산출물
gstack(design-doc → test-plan), SoloSquad(`_handoff.md`), Hermes(trajectory → skill 자동 요약)가 모두 동일 패턴. → **SoloSquad `_handoff.md`는 컨센서스의 수동 버전. Hermes 식 trajectory 자동 요약을 다음 분기에 검토할 가치 있음.**

### C. 자가 진화의 두 갈래
- (a) **메트릭 게이트 + 코드 rollback** (autoresearch / Shopify)
- (b) **trajectory → skill markdown** (Hermes)

SoloSquad의 routine JSONL 추출은 (a)의 약화된 형태, 수동 SKILL.md 편집은 (b)의 수동 형태. → **양쪽 모두 자동화 여지가 큼.**

### D. 24/7 트리거 다양성 — 가장 큰 격차
| 트리거 유형 | 레퍼런스 | SoloSquad 현황 |
|---|---|---|
| Cron | OpenClaw, SoloSquad | ✅ routine 5종 |
| Metric delta | autoresearch | ❌ 없음 |
| External signal | MiroFish, Hermes | ⚠️ signal-scan은 있으나 read-only |
| Conversation auto-load | phuryn, Hermes | ❌ 없음 (수동 키워드 라우팅) |

→ **SoloSquad는 cron 일변도. 다른 3축 중 최소 1개 채택 검토가 다음 마일스톤 1순위 후보.**

### E. 다중 메신저는 위생 요건
OpenClaw(4 채널), Hermes(7 채널), SoloSquad(Discord/Slack/Telegram). 단일 채널 락인은 2026년 안티 패턴. → **SoloSquad v0.2.0+ 워크스페이스당 1 메신저 정책은 운영 단순화 목적이지만, 사용자 측에서는 채널 선택 자유가 유지됨. OK.**

---

## SoloSquad 정합성 평가

| 레퍼런스 | 채택 가능성 | 충돌 지점 | 통합 비용 | 제안 액션 |
|---|---|---|---|---|
| Anthropic Agent SDK 패턴 | `immediately` | 없음 — 이미 같은 방향 | 낮음 | `architect` 에이전트 SKILL.md에 initializer + coding agent 분해 명시 |
| OpenClaw 자가 업데이트 | (이미 채택) | — | — | `solosquad update` 이미 차용. 추가 변경 없음 |
| Hermes trajectory → skill | `experimental` | routine은 결과만 JSONL로 저장, tool-call trace는 없음 | 중간 | v1.1~v1.2 후보. claude-runner에 trace 옵션 추가 검토 |
| gstack 슬래시 체인 | `next-version` | 키워드 라우팅 vs 슬래시 명령 충돌 가능 | 중간 | `/think` `/plan` `/build` `/ship` 슬래시 추가 (기존 키워드 라우팅과 공존) |
| phuryn auto-load + slash 듀얼 | `next-version` | 현재 키워드만 자동, 명시적 슬래시 없음 | 중간 | gstack 액션과 통합 추진 |
| karpathy autoresearch 패턴 | `experimental` | 메트릭 정의 / git 자동 rollback이 SoloSquad에 없음 | 높음 | 단일 routine(예: experiment-check)에 시범 적용 — metric 정의 + rollback 가드 |
| MiroFish swarm 시뮬레이션 | `not-applicable` | 솔로 파운더 도메인과 무관, 1M 에이전트 인프라 비용 | — | 관찰만 유지 |

---

## Open Questions

- [ ] gstack의 슬래시 체인을 SoloSquad에 도입할 때 기존 `AGENT_ROUTES` 키워드 라우팅과 어떻게 공존시킬 것인가? (둘 다 살릴지, 슬래시 우선으로 통일할지)
- [ ] Hermes trajectory → skill 자동화의 ROI는 어떻게 측정할 것인가? (자동 생성된 스킬의 재사용률 / 정확도)
- [ ] autoresearch 메트릭 게이트를 routine에 도입한다면 어떤 routine부터 시작할 것인가? (experiment-check가 가장 자연스러워 보임)
- [ ] Tier 2 채널에서 2회 이상 관측 후 Tier 1 승격 — 운영 임계치(2회)가 적절한가?

---

## 다음 추적 사이클 예약

| 시점 | 작업 |
|---|---|
| 2026-05-17 (일) | Tier 1 1차 주간 스캔 — 본 베이스라인 이후 변화 차분 |
| 2026-05-31 (말일) | 5월 Monthly Digest |
| 2026-08-11 | 분기 Baseline Survey 갱신 |

---

## 출처

1. https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
2. https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
3. https://github.com/ai-boost/awesome-harness-engineering
4. https://github.com/openclaw/openclaw
5. https://docs.openclaw.ai/automation/cron-jobs
6. https://github.com/nousresearch/hermes-agent
7. https://hermes-agent.nousresearch.com/docs/
8. https://github.com/garrytan/gstack
9. https://github.com/garrytan/gstack/blob/main/ARCHITECTURE.md
10. https://github.com/phuryn/pm-skills
11. https://github.com/karpathy/autoresearch
12. https://shopify.engineering/autoresearch
13. https://github.com/666ghj/MiroFish
14. https://mirofish.ink/

---

## 변경 이력
- 2026-05-11: 최초 작성 (Trend Tracker 에이전트 신설 동시). 사용자가 언급한 "harrytang gstack"은 **`garrytan/gstack`** (YC CEO Garry Tan)으로 정정. 7건 중 "확인 안 됨" 없음.
