# Ralphthon ICML — 리뷰 지침 · auto-research · "통과하는 paper" 역설계

> **유형:** ideation (발산 · 결정 전 · 폐기 안 함)
> **작성:** 2026-07-12
> **청자:** SoloSquad 개발자(본인). **산출 목표 = ICML 리뷰 가이드/프로세스를 준수하고
> 리뷰를 통과하는 2–4p workshop paper (+ self-review)**. 리뷰 rubric 을 먼저 확정하고
> 거기서 paper 를 역설계한다. SoloSquad 의 auto-research/harness 관점 적용점도 함께.
> **연관:** [[260712-long-horizon-codex-goals-vs-fable5]] · [[260625-ai-planning-insights]]("Eval=심장") ·
> [[260605-ochestrator-session]] · auto-research/verify 스킬

**소스 & 접근 상태**
- ✅ ICML 2026 Reviewer Instructions — `icml.cc/Conferences/2026/ReviewerInstructions`
- ✅ Ralphthon Track 1 Agent Review Skill — `openagentreview.org/skill.md`
- ✅ Ralphthon 레포 — `github.com/team-attention/ralphthon-icml`
- ✅ Notion Participant Guide — 원문을 사용자가 직접 제공(URL 은 로그인 게이트로 자동 접근 불가였음). §1.4·§3·타임라인 반영.
- ✅ 공식 ICML 2026 LaTeX 템플릿 일체 — 로컬 `docs/ideation/reference/icml2026/`(§1.4 형식 규격의 근거).

**공식 링크:** 제출/리뷰/상태 `openagentreview.org` · 스킬 `github.com/team-attention/ralphthon-icml` ·
VESSL 크레딧 `claim-vessl-credits.team-attention.com` · 발표 슬라이드 `ralphthon-icml-presentation.team-attention.com/slides.bi.html` ·
이벤트 `luma.com/hjuo7auc`. **Discord 는 제출물 아님 — 모든 공식 제출·리뷰는 OpenAgentReview 에서.**

---

## 0. 큰 그림 — 두 트랙, 한 rubric

Ralphthon = Codex 지원 "Auto Research" ICML 워크샵 대회. Ralph Loop(자동 연구 루프)를 돌려
결과물을 낸다. NAVER D2SF 서울. 팀 1–4명, **정확히 한 트랙 선택, 팀당 1 엔트리**.
가장 먼저 준비할 것: **PDF · Title · Abstract**.

| | Track 1 · AI Scientist | Track 2 · Review Agent |
|---|---|---|
| 산출 | **익명 short-paper PDF + Title + Abstract**, 17:00까지 **self-review** | Review Agent 접근/개발과정 설명하는 **익명 technical-report PDF + Title + Abstract** |
| 분량 | **4페이지 하드리밋**(refs/appendix 제외), ICML 2026 LaTeX 스타일, double-blind 익명화 | **동일 — 4페이지 하드리밋**, 동일 형식 |
| 부속 | 코드/로그/W&B 링크 **선택** | Review Agent(`review-agent.md`) freeze·재사용 |
| 우리 목표 | ★ **이것** — 리뷰 통과하는 paper | (Track2-only path 로 재사용 가능) |

**형식 필수:** 공식 ICML 2026 LaTeX 스타일 파일(`icml2026.zip`) · **저자·소속 제거(double-blind)** ·
본문 최대 4p(references/appendices 제외).

핵심 통찰: **Track 1 paper 가 통과하려면, Track 2 가 그 paper 를 무엇으로 채점하는지를 먼저 알아야 한다.**
그 채점기는 두 겹 — ① ICML 공식 rubric(내용 기준) ② openagentreview 제출 스키마(형식·증거 기준).
paper 는 이 둘을 **동시에 만족하도록 역설계**한다.

---

## 1. ICML 2026 리뷰 rubric — paper 가 넘어야 할 바(bar)

### 1.1 4개 평가 축 (각 1–4: 4 excellent·3 good·2 fair·1 poor)
| 축 | 리뷰어가 묻는 것 | paper 가 확보할 것 |
|---|---|---|
| **Soundness** | 주장이 이론/실험으로 잘 뒷받침되나? 방법 타당·강약점 정직 평가? | 재현 가능한 증거, 정직한 한계 서술 |
| **Presentation** | 명료·구조·선행연구 맥락화. 전문가 재현 가능한 디테일? | 재현 충분 디테일, 문헌 위치잡기 |
| **Significance** | 중요 문제와의 관련성, 미래 연구/실무 영향 | "왜 중요한가" 명시 |
| **Originality** | 새 통찰/방법/이론/데이터 or 조합. **완전 신규 방법 불필요** | 기존 조합의 새 관점도 인정됨 |

### 1.2 리뷰 폼 구조 (paper 가 각 칸을 "채워주게" 만들 것)
- **Summary** — 비판 없는 저자 친화 요약.
- **Strengths/Weaknesses** — 4축 모두 건드리는 실질 평가.
- **Key Questions (3–5)** — 답변이 평가를 바꿀 수 있는 질문.
- **Limitations** — 저자가 한계·사회적 영향을 충분히 논했나.
- **Overall (1–6)**: 6 Strong Accept ·5 Accept(technically solid, high impact) ·**4 Weak Accept(현실적 통과선)** ·3 Weak Reject ·2 Reject ·1 Strong Reject.
- **Confidence (1–5)** · **Ethical flag(Y/N)** · **Compliance(LLM 정책·CoC)** · **Final Justification(rebuttal 후)**.

### 1.3 프로세스·정책 (준수 대상)
- **LLM 정책**: 리뷰어는 배정 정책 준수. Position track 은 **Policy A(리뷰에 LLM 전면 금지)**. 위반 시 본인 논문 desk-reject 리스크.
- **저자 측 GenAI**: LLM 사용 허용하나 전 콘텐츠 책임은 저자("AI slop"·표절 리스크). **프롬프트 인젝션 금지 + 탐지기 가동** ← auto-generated paper 는 여기 특히 조심.
- 기밀유지, 담합 금지, 3라운드 토론(각 5,000자), Final Justification.
- **Confidence(1–5)**: 5=수학/디테일까지 확인한 확신 … 1=추측성(분야 밖·난해). 증거량에 정직하게.
- **Comment 필드 성격**: (인간) 참가자에게 **AI 에이전트·paper 를 개선할 건설적 제안** — 파괴적 지적이 아니라 개선 지향.

**Ralphthon 당일 타임라인(압축 재현):** 09:30 등록·팀구성 → 10:00–11:00 오프닝(Codex Goal/W&B/VESSL) →
11:00–12:30 **research spec** → 12:30–15:30 **Ralph Loop** → 15:30–16:30 사람 편집·최종제출 →
**16:30 제출 하드컷 + 매칭 스냅샷** → 16:35–17:00 Track1 self-review / Track2 claim-read-review-post →
17:00–17:30 1차 심사·파이널리스트 → 17:30–18:30 포스터 → 18:30–19:00 최종 심의 → 19:00–19:30 수상작 oral → 19:30–20:00 시상.

### 1.4 형식 규격 — 실제 ICML 2026 스타일 파일 기준 (형식 실격 방지)
로컬 `docs/ideation/reference/icml2026/` 에 공식 템플릿 일체 존재:
`example_paper.tex`(작성 골격) · `icml2026.sty`/`.bst` · `fancyhdr/algorithm/algorithmic.sty` ·
`example_paper.bib` · `example_paper.pdf`(컴파일 예시) · `icml_numpapers.pdf`(그림 예시).

**레이아웃(임의 변경 금지 — "do not compress vertical spaces"):**
- **2단 컬럼**, 폭 6.75in × 높이 9.0in, 컬럼 간격 0.25in, 좌 0.75in·상 1.0in 여백. US letter 기준.
- 본문 **10pt Times**, 행간 11pt. 제목 **14pt bold**(content word 대문자). 섹션 헤딩 11pt bold(최대 3레벨).
- **Abstract = 단일 문단, 약 4–6문장**(초과 시 교정 대상).
- 그림 캡션은 **아래**, 표 캡션은 **위**. 참고문헌 **APA**(natbib + `icml2026.bst`).

**제출 위생(위반 = 미리뷰/실격):**
- `\usepackage{icml2026}`(blind). `[accepted]` 는 채택 후에만. **저자·소속·감사문 넣으면 리뷰 안 됨** — 자기인용도 3인칭.
- **PDF 단일 파일**(본문+refs+appendix 한 파일). Type-1 폰트만. Word 불가.
- **분량**: 템플릿 기본은 8p지만 **Ralphthon 은 4p 하드리밋**(refs/appendix 제외)으로 오버라이드 — 4p 가 지배 규칙.

**⚠️ Impact Statement 필수(놓치기 쉬운 감점).** ICML 은 broader impact/윤리 statement 를 **required** 로
요구(번호 없는 절, page limit 미포함, refs 앞). 특별 우려 없으면 템플릿 제공 boilerplate 를 그대로 써도 됨:
> "This paper presents work whose goal is to advance the field of Machine Learning. There are many potential societal consequences of our work, none which we feel must be specifically highlighted here."

→ 이 한 문단이 리뷰 폼의 **Limitations/사회적 영향** 칸을 직접 방어한다(§1.2). 빠뜨리면 soundness 아닌 곳에서 실점.

---

## 2. openagentreview 제출 스키마 — 형식·증거 계약

Track 2 에이전트(그리고 self-review)가 실제로 POST 하는 필드. **paper 는 이 숫자들이 높게 나오도록,
comments 가 근거를 인용하도록 설계돼야 한다.**

- **Endpoint:** `POST /api/ralphthon/v1/agent-reviews` (Bearer). 배정: `GET /api/ralphthon/v1/assignments/current` — 정확히 10편(real 먼저, rehearsal 라벨).
- **필드/범위:** `soundness 1–4` · `presentation 1–4` · `significance 1–4` · `originality 1–4` · `overall 1–6` · `confidence 1–5` · `comments`(필수, trim, **"Evidence-based" 실질**).
- **제약:** 레거시 산문 필드 거부 · comments 는 증거 기반이어야 함 · **리뷰 창 16:35–17:00 KST 엄수** · API-only.
- rehearsal 논문은 절차상 카운트하나 완료/실격/정렬/수상에 무영향.

→ **ICML 4축과 스키마 4축이 1:1 매핑**(soundness/presentation/significance/originality). paper 최적화 대상이 명확히 4개로 수렴.

---

## 3. auto-research 워크플로 (Ralphthon 레포) — 어떻게 만드나

`auto-research` 스킬 = 상호 배타 3경로:

| 경로 | 요지 | 필요 자원 |
|---|---|---|
| **Training (billable)** | VESSL 고정 cookbook, **단일 A100(비협상)**, `karpathy/autoresearch` baseline, **`train.py` 만** 수정(가설 1·변경 1/후보), baseline 1 + 순차 후보 최대 3, W&B offline-first | A100·VESSL·W&B |
| **General Track 1** | 비-Karpathy 워크플로 or 신뢰가능 기존 증거로 agent workflow+paper+self-review. W&B/VESSL/A100 **불필요** | 가벼움 |
| **Track 2-only** | `review-agent.md` 를 freeze 해 기존 paper 리뷰. compute·repo clone·신규 실험 주장 없음 | 최소 |

**안전 경계(하드):** 커밋된 비밀번호/키 금지 · **결과·인용·수치 날조 금지**(← 탐지기·리뷰가 직격) ·
W&B sync 는 entity/project/visibility 검토+확인 · VESSL 은 live cost card+cleanup 사전승인 · A100 무음 폴백 금지.
Training 경로는 `record_experiment.py` 로 append-only 로컬 기록 후 sync(콘솔/코드/데이터셋/체크포인트/키는 업로드 제외).

설치·검증: `git clone … && python3 -m unittest discover -s tests -v && python3 scripts/validate_plugin.py` → `Validation passed`.

---

## 4. "통과하는 paper" 역설계 — 핵심 인사이트

1. **rubric 이 스펙이다.** paper 를 자유 서술이 아니라 **4축×(1–4) 를 각각 최소 3(good) 이상, overall ≥4(Weak Accept)**
   나오게 하는 산출물로 설계. 각 섹션이 리뷰 폼 칸(Summary/S-W/Questions/Limitations)에 직접 대응하도록 씀.
2. **날조가 유일한 즉사 요인.** auto-generated 라는 특성상 리뷰·탐지기가 **증거 없는 수치/인용**을 가장
   먼저 잡는다. → *모든 claim 은 tool result/W&B run/로그에 앵커*. 이는 [[260712-long-horizon-codex-goals-vs-fable5]]
   의 Fable "audit each claim against a tool result" + Codex "verification surface" 와 **정확히 같은 원리**.
   Ralphthon 안전경계("no fabricated results/citations/metrics")도 동일.
3. **Significance/Originality 는 저비용 고레버리지.** ICML 이 "완전 신규 방법 불필요, 조합·새 관점도 originality"
   라 명시 → 작은 실험이라도 **왜 중요한지 + 무엇이 새로운지**를 1문단씩 명토로 확보하면 fair→good 이동.
4. **Limitations 를 정직하게 = Soundness 점수 방어.** ICML rubric 이 "강약점 정직 평가" 를 soundness 에 포함.
   한계를 숨기면 오히려 감점. self-review 에서 스스로 약점을 짚고 답하는 게 통과 전략.
5. **self-review 는 미리보기이자 리허설.** 같은 4축·같은 evidence-based comments 로 쓰면, Track 2 리뷰가
   나올 때 이미 방어선이 서 있음. self-review 를 "실패한 축 찾기 → paper 보강" 루프로.
6. **General Track 1 경로가 시간 리스크 최소.** 16:30 하드컷 + Ralph Loop 3시간 안에서 A100/VESSL 프로비저닝은
   실패점이 많다. 신뢰가능 기존 증거 기반 경량 경로가 "통과" 목표엔 더 안전(자원 오류로 날리는 시간 제거).

---

## 5. SoloSquad 적용점

1. **auto-research/verify 스킬 ↔ Ralph Loop.** Ralphthon 의 "가설 1·변경 1/후보, baseline+최대3후보,
   offline-first, append-only 기록" 은 우리 workflow verify 스테이지의 실험 규율로 그대로 이식 가능.
   특히 **날조 방지 = tool result 앵커링**은 우리 supervisor 진행보고 규율(이전 문서 §6.2)과 동일 정책.
2. **"rubric 을 스펙으로" = 우리 goal 의 verification surface.** paper 통과 기준(4축 점수)이 곧 그 작업의 eval.
   [[260625-ai-planning-insights]] "Eval=심장" + [[260712-long-horizon-codex-goals-vs-fable5]] goal 6필드와 수렴.
   → SoloSquad goal 에 "산출물이 통과해야 할 rubric" 을 verification 필드로 넣는 패턴의 실증 사례.
3. **review-agent = 재사용 primitive.** `review-agent.md`(freeze 후 재사용)는 우리 agent primitive 의
   "구조화 채점기" 유즈케이스. 우리 code-review/security-review 계열과 같은 계보.
4. **압축된 마감(16:30 하드컷) = 세션 오케스트레이션 스트레스 테스트.** `solosquad start`(bot+cron+supervisor)
   가 3시간 무인 루프 + 하드컷을 견디는지의 실전 벤치가 될 수 있음.

---

## 6. Paper 통과 체크리스트 (실행)

- [ ] **가장 먼저: PDF·Title·Abstract 확보** (11:00–12:30 spec 안에 title/abstract 확정 권장). Abstract 는 단일 문단 4–6문장.
- [ ] **형식 게이트**(로컬 `reference/icml2026/example_paper.tex` 복제 시작): `\usepackage{icml2026}` blind · 2단 10pt Times · **저자·소속·감사문 0(넣으면 리뷰 안 됨)** · 자기인용 3인칭 · PDF 단일파일 Type-1 · 본문 ≤4p(refs/appendix 제외).
- [ ] **Impact Statement 절 포함**(required; 없으면 감점) — 특별 우려 없으면 boilerplate 그대로.
- [ ] 경로 결정: **General Track 1(권장, 시간안전)** vs Training(A100). 16:30 하드컷 역산(코드/로그/W&B 는 선택).
- [ ] paper 골격을 리뷰 폼에 매핑: Summary / Strengths-Weaknesses(4축 전부) / Key Questions(3–5 선제 답변) / Limitations(정직).
- [ ] 4축 각각 **≥ good(3)** 되게: soundness(증거·재현), presentation(재현 디테일·문헌), significance(왜 중요), originality(무엇이 새로운지).
- [ ] **모든 수치·인용을 실제 run/log/tool result 에 앵커** — 날조 0. (탐지기·안전경계 직격 요인)
- [ ] **프롬프트 인젝션 금지** 준수(auto-gen 텍스트에 리뷰어 조작 문구 없게).
- [ ] self-review(17:00 마감)를 4축+evidence-based comments 로 작성 → 최저점 축을 찾아 paper 보강 루프.
- [ ] overall 목표 ≥ 4(Weak Accept). confidence 는 증거량에 정직하게.
- [ ] 제출: **openagentreview.org**(정수 범위·comments trim·레거시 산문 필드 없음). 리뷰 창 16:35–17:00 KST. **Discord 는 제출 아님**.
- [ ] W&B/VESSL 쓰면 sync 전 entity/visibility/cost 확인, 키·데이터셋 업로드 제외.
- [ ] 시작 전: Codex·GitHub·W&B·VESSL 로그인 확인. Track2 면 사전에 skill.md 를 에이전트에 넣고 login→browse→claim→read→post 리허설.

---

## 7. 열린 질문 / 보강 필요

Notion 참가자 가이드 원문 확보로 형식·타임라인·제출 절차는 해소됨(§0–1·§6 반영). 남은 미확인:

- [ ] Ralphthon self-review 와 Track 2 타 에이전트 리뷰의 **가중치**(자기채점 vs 동료채점 비중) — "오후에 다시 안내" 예정.
- [ ] rehearsal 10편 중 real 편수 / 실제 채점 대상 확정 방식(매칭 스냅샷 규칙).
- [ ] auto-generated paper 에 대한 저자측 LLM 정책·표절/AI-slop 탐지 임계.
- [ ] 1차 심사(17:00–17:30) 컷 기준 — overall 평균? 순위? (파이널리스트 선정식 미공개)
