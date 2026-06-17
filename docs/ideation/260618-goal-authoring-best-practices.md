# goal 정의의 모든 것 — 자율 목표지향 에이전트·메트릭 루프 전수 분석과 SoloSquad 전략

> **청자:** SoloSquad 개발자(본인). dev 워크플로·내부 구현 관점의 설계 메모이며,
> 확정 기획(PRD)이 아니라 방향 탐색이다. v1.3.2 `goal-manager`(`docs/prd/v1.3.2-domain-lifecycle-managers.md` §6) 의 근거 문서.
>
> **문서 목적.** "좋은 goal 이란 무엇인가"의 단일 레퍼런스. SoloSquad 에서 goal =
> `goal.md`(frontmatter + `## Metrics` name/formula/source/threshold/direction + `## Pipeline`
> 에이전트 stage + `## Budget` + `## Termination`), 자율 엔진이 keep/discard 사이클 실행
> (git snapshot → pipeline → metric 측정 → ALL pass 시 commit 아니면 revert → results.tsv →
> 3연속 keep 수렴 / budget·discard-streak 정지). 자율 목표지향 시스템 6종(Codex `/goal`·Karpathy
> autoresearch·AutoGPT/BabyAGI·Voyager·Reflexion·SWE-agent) + 목표/메트릭 프레임워크(OKR·SMART·
> eval-driven·Goodhart·reward hacking) + 최적화 루프(hill-climbing·진화·DSPy·best-of-N·early-stop)
> 를 전수 조사해 **객관적 현황 → 인사이트 → SoloSquad 전략** 순으로 정리한다.
>
> **조사 방법 주의.** 병렬 리서치 에이전트의 웹 조사(2026-06-18). 일부 1차 페이지(OpenAI
> faulty-reward·DeepMind spec-gaming)가 403/PDF 파싱불가 → 2차 출처 교차. 본문 [미검증]/[2차] 표기.

---

## 목차

- **Part A** — TL;DR
- **Part B** — 객관적 현황: 자율 목표지향 시스템 6종
- **Part C** — 목표/메트릭 설계 프레임워크 (OKR·SMART·eval·Goodhart)
- **Part D** — 최적화/반복 루프 (hill-climbing·진화·DSPy·best-of-N·수렴)
- **Part E** — 실패 모드 & 가드레일
- **Part F** — 인사이트 (수렴점·차이점)
- **Part G** — SoloSquad 적용 전략 (`goal.md` 매핑)
- **Part H** — 궁극의 체크리스트
- **출처**

---

# Part A — TL;DR

1. **모든 자율 시스템에 반복되는 2층 패턴 = 휘발성 goal(지금 할 일, 진행 중 재도출/폐기) 위의 영속 guide(과제 넘어 유지되는 지식·제약).** Codex `/goal`(휘발, 4000자 cap) vs `AGENTS.md`(영속)가 가장 명확한 의도적 분리.
2. **SoloSquad 의 `goal.md`(frontmatter + Metrics)는 영속 정책 + 동결 평가기**, **각 사이클 pipeline 실행은 휘발 시도**, **keep/commit vs discard/revert 는 승격 게이트** — 6개 시스템에 직접 매핑.
3. **엔진 = git 을 체크포인트 기질로 쓰는 hill-climbing keep-discard 루프 + verifier 기반 수용 게이트** — AIMA accept-if-better + SWE-bench fixed-commit-재측정 + Keras early-stopping(patience) 패턴 그대로. "3연속 keep 수렴" = patience plateau, "budget/discard-streak 정지" = hard cap + no-progress.
4. **메트릭 = name/formula/source/threshold/direction** 은 교과서적 metric-provenance + SMART-measurability. **ALL pass 요구**(하나 아님)는 Goodhart 게이밍에 저항하는 **guardrail-metric** 패턴.
5. **최대 갭 / 신호:** ⑴ 순수 hill-climbing 은 local optima 에 갇힘 — 진화/best-of-N 이 탈출 추가(비용↑). ⑵ **goal authoring 보조 부재**(현재 템플릿 주석 읽고 수기 편집). ⑶ **semantic 검증 부재**(source 파일 존재성·formula 평가가능성·pipeline agent 실존). ⑷ 동일 출력 반복 **loop-detection 부재**(discard-streak 와 별개).

---

# Part B — 객관적 현황: 자율 목표지향 시스템 6종

## B.1 Codex `/goal`(휘발) + `AGENTS.md`(영속) — 분리의 정본
- **`/goal <objective>`** = 휘발·스레드 부착 목표. 자율 계획·실행, `/goal pause|resume|clear` 로 lifecycle. "objective 는 비어있지 않고 ≤4,000자". 작업 중 활성 스레드에 부착 — transient·명시적 clear 가능. (검증됨: codex/cli/slash-commands)
- **`AGENTS.md`** = 영속 표준 정책. "에이전트용 README". 매 task 전 읽고 **루트→하위 계층 병합**(가까운 디렉터리가 후순위 = override, 기본 32 KiB cap).

## B.2 Karpathy `autoresearch` — 메트릭 게이팅 + git keep/discard (우리와 최근접)
- 루프: 단일 편집가능 파일 `train.py` 수정 → 정확히 5분 학습 → 메트릭 1개 평가 → keep/discard → 반복(~12 실험/시, ~100 야간).
- **goal = 동결 메트릭 1개**: `val_bpb`(validation bits-per-byte, minimize), vocab-size 무관(공정 비교).
- 결과(1차, Karpathy X): nanochat depth=12 튜닝 ~20개 개선이 **전부 additive 하고 depth=24 로 전이**.
- [미검증] git-reset-on-regression 메커니즘은 커뮤니티 재구현엔 명시, 원 README 엔 암시만.

## B.3 AutoGPT / BabyAGI — goal → task 분해/큐
- **BabyAGI:** goal = 단일 **objective** 가 모든 task 생성/우선순위 지배. 루프: 첫 task pull → 실행 → vector DB 저장 → "objective 와 직전 결과 기반 새 task 생성·재우선순위". 3 에이전트(Execution·Task-Creation·Prioritization).
- **AutoGPT:** 고수준 goal → "자율 task 분해". [미검증: 1차 README 미fetch]
- 패턴: 영속 objective + 휘발 재생성 task 큐.

## B.4 Voyager — open-ended goal + 자동 커리큘럼 + skill library
- 3부: ⑴탐색 최대화 자동 커리큘럼 ⑵실행가능 코드의 ever-growing skill library ⑶환경피드백·실행오류·self-verification 반영 반복 프롬프팅.
- 커리큘럼(goal 제안): GPT-4 가 난이도 균형 + 신규성 편향으로 다음 task 제안.
- skill library: description 임베딩으로 인덱싱, 미래 유사상황 검색 = 영속·전이가능 역량층.
- self-verification(성공 측정): GPT-4 가 비평가 — 프로그램이 task 달성했는지 판단, 아니면 수정 비평.

## B.5 Reflexion — 언어적 자기반성 + 에피소드 메모리
- 메커니즘: 가중치 갱신 아닌 "언어 피드백" — task 피드백을 언어로 반성, 반성 텍스트를 에피소드 메모리 버퍼에 유지(Ω≈1–3).
- 3 컴포넌트: Actor·Evaluator(task 메트릭→reward)·Self-Reflection. 정지: Evaluator pass 또는 max trials. HumanEval 91% pass@1(GPT-4 80% 대비).

## B.6 SWE-agent — GitHub 이슈가 goal, ACI 가 제약층
- goal = GitHub 이슈; 수정 시도.
- 핵심 ACI(Agent-Computer Interface): LLM 전용 액션 어휘(보기/검색/편집/테스트)가 raw shell 보다 우수.
- 성공 = SWE-bench resolved rate(논문 12.5% pass@1). NeurIPS 2024.

## B.7 2층 패턴 종합

| 시스템 | 휘발 goal | 영속 guide |
|---|---|---|
| Codex | `/goal` objective + 세션 프롬프트 | `AGENTS.md`(계층 병합, 매 task 전) |
| autoresearch | `train.py` 후보 편집 | 동결 `val_bpb` + git 히스토리 |
| BabyAGI | 큐의 task | 고정 user objective |
| Voyager | 다음 커리큘럼 task | ever-growing skill library |
| Reflexion | 현재 trial | 반성의 에피소드 메모리 |
| SWE-agent | GitHub 이슈 | ACI(고정 액션 어휘/가드레일) |

두 강화 하위패턴: **(a)** 성공을 휘발 추론루프 밖 안정 평가기로 외부화(val_bpb·SWE-bench·GPT-4 critic). **(b)** 반복 = keep-or-discard, 통과한 것만 영속층 승격. **SoloSquad 직접 매핑:** `goal.md` frontmatter + Metrics = 영속 정책 + 동결 평가기; 사이클 pipeline = 휘발 시도; keep/commit vs discard/revert = 승격 게이트.

---

# Part C — 목표/메트릭 설계 프레임워크

- **OKR** — Objective(정성 "무엇") + Key Results("구체적·시한·도전적이나 현실적" 정량, "회색지대 없음", 3–5개). "I will (O) as measured by (KR)". Grove→Doerr→Google.
- **SMART** — Doran(1981): Specific·Measurable·**Assignable·Realistic·Time-related**("Achievable/Relevant"는 후대 drift).
- **Eval-driven development** — 만들기 전 eval 정의. OpenAI: "구현·테스트 전 시스템 거동 명세". Anthropic: eval = "입력 → 채점 로직 → 성공 측정", "같은 spec 읽는 둘 사이 모호성 해소", 실패 20–50개로 시작.
- **Goodhart's law** — 원본(1975): "통계 규칙성은 통제 압력이 가해지면 붕괴". 대중형(Strathern 1997): "측정이 타겟이 되면 좋은 측정이기를 그친다".
- **Specification gaming(DeepMind, Krakovna 2020):** "의도한 결과 없이 목표의 문자적 명세를 만족하는 거동". 예: 보트레이스 루프·GenProg list-truncation. [2차: DeepMind 블로그 403, Krakovna 1차 블로그 교차]
- **Reward hacking(OpenAI):** CoT 모니터링이 출력만 보는 것보다 reward hacking 더 잘 탐지; "나쁜 생각" 벌하면 의도를 숨김. [2차: openai.com 403 → 검색요약 의역]
- **Metric provenance/reproducibility** — 메트릭을 코드로(name·계산타입·컬럼·필터) 정의해 "모호하지 않고 재현가능". lineage(어떻게 계산) + provenance(무엇을 신뢰). [vendor/practitioner 출처]
- **Leading vs lagging** — leading(예측·영향가능하나 불확실) vs lagging(고확실·저영향, 바꾸기엔 늦음). 둘 다.
- **Single vs composite(guardrail)** — North Star + **guardrail metric**("악화를 허용 안 하는 임계 아래 메트릭") = 단일메트릭 Goodhart 압력의 실무적 해독제.

**SoloSquad 함의:** 각 메트릭의 name/formula/source/threshold/direction = 교과서적 metric-provenance + SMART. **ALL pass 요구**(하나 아님) = Goodhart 게이밍 저항 guardrail-metric 패턴.

---

# Part D — 최적화/반복 루프

- **Hill-climbing(keep-discard)** — "greedy local search": 최선 이웃으로, `VALUE(neighbor) ≤ VALUE(current) 면 current 반환`. 히스토리 없음, local maxima 에 막힘.(AIMA)
- **진화/유전** — population + FITNESS-FN + SELECT + crossover + mutate; "충분히 적합 or 시간 경과까지". 단일상태 hill-climbing 이 못 벗어나는 local optima 탈출(mutation/crossover 전역 커버).
- **DSPy optimizers** — metric = "출력 평가 → 점수(높을수록 좋음)". BootstrapFewShot 은 metric 통과 trace 만 유지; MIPROv2 는 미니배치 점수로 Bayesian 최적화.
- **Reflexion** — 언어적 자기반성이 반복 신호; 메모리 bounded; Evaluator-pass 또는 max trials 정지.
- **Best-of-N** — N개 후보 생성 + verifier 최고 선택; GSM8K 에서 verification 을 ~30× 모델크기로 스케일. 주의: reward model BoN 은 "reward hacking 취약".
- **수렴/early-stopping** — patience("개선 없는 epoch 수 후 정지") + min_delta(개선 기준) + restore_best_weights(최선 체크포인트 복원).(Keras)
- **Budget control** — hard limit(임계서 정지) + soft limit(경고/저하). 표준 정지: max_iterations·token/cost budget·no-progress. [vendor 블로그; "agent ~4×, multi-agent ~15× 토큰" Anthropic 수치는 2차]
- **결정성/검증(SWE-bench)** — "고정 base_commit 에 patch 적용 후 테스트"; resolved = FAIL_TO_PASS 달성 + PASS_TO_PASS 보존(회귀 가드); Docker 재현; flaky 제거.

**SoloSquad 함의:** 엔진 = **git 체크포인트 기질의 hill-climbing keep-discard + verifier 수용 게이트**(snapshot 에서 메트릭 재측정, ALL pass 면 commit 아니면 revert) = AIMA accept-if-better + SWE-bench fixed-commit-재측정 + Keras patience 그대로. **갭:** 순수 hill-climbing 은 local optima 에 갇힘 — 진화/best-of-N 이 탈출 추가(비용↑).

---

# Part E — 실패 모드 & 가드레일

| 실패 모드 | 증거(1차) | 가드레일 |
|---|---|---|
| Reward hacking / spec gaming | CoastRunners 보트가 respawn 점수로 루프, 충돌하며 인간 20%↑ (OpenAI faulty-reward); Krakovna 마스터 리스트 | 인간 데모/피드백; 복수 메트릭; guardrail 임계 |
| Reward-model 과최적화 | Gao/Schulman/Hilton: 학습된 proxy 를 한계 넘어 최적화하면 "reward model 결함 증폭, 진짜 목표 저하" | 최적화 압력 bound(KL); early stopping |
| 진동/비수렴 | "Breaking Agents": 에이전트가 "재귀적 실패 상태 지속, 같은 오류 행동 반복"(증폭 시 >80% 실패) | max-iteration + 반복상태 loop-detection |
| 메트릭 과적합(ML Goodhart) | Manheim & Garrabrant: Regressional/Extremal/Causal/Adversarial Goodhart | 복수 메트릭; 인과구조 이해 |
| Scope creep / goal drift | Anthropic agentic misalignment(목표충돌 시 협박/사보타주 최대 96%); 컨텍스트 압력 하 goal drift | 비가역 행동 인간 승인; 최소권한; 런타임 모니터 |
| Runaway 비용/루프 | Anthropic: 자율성 = "비용↑, 복합 오류 가능성" | 정지조건; OpenAI SDK tripwire 가 토큰소비 전 hard-halt; 빌링 budget cap |

**성숙 bounding(합의):** max iterations + 정지조건(Anthropic); tripwire hard-halt(OpenAI SDK); 비가역 행동 인간 승인 게이트; 샌드박싱 + 매 스텝 환경 ground-truth; 빌링 cost cap. [미검증: Gao 함수형 PDF 파싱불가(정성만 확인), OpenAI 페이지 403, 2026 goal-drift 논문 abstract 수준].

**SoloSquad 함의:** git-revert-on-fail + discard-streak 정지 + budget cap + "ALL pass" 가 문서화된 bound 대부분 커버. 잔여 노출: ⑴선택 메트릭의 Goodhart — composite/guardrail 로 완화. ⑵verifier 자체 게이밍(BoN/reward-hacking 교훈) — 신뢰가능·게이밍-어려운 metric source 권고. ⑶동일 pipeline 출력 반복 **loop-detection 부재**(discard-streak 와 별개).

---

# Part F — 인사이트

## F.1 강한 수렴 (1차 출처)
1. **repo-root markdown 지시 파일이 보편·상호운용** — AGENTS.md(6만+ 프로젝트, Linux Foundation), CLAUDE.md, `.github/copilot-instructions.md`, Cursor rules(이제 AGENTS.md 도 읽음).
2. **agent loop = LLM + 툴 + 환경피드백, 정지조건까지 반복** — Anthropic "매 스텝 환경 ground truth".
3. **실행가능 테스트 통한 verification-as-gate, SWE-bench Verified 가 공통 벤치**(FAIL_TO_PASS/PASS_TO_PASS).

## F.2 의미있는 분기
1. **config 활성화 의미** — always-on(AGENTS.md/Codex) vs glob-scoped/on-demand(Cursor `.mdc`·Claude path-scoped).
2. **guidance vs enforcement** — Anthropic 명시: CLAUDE.md 는 "context, 강제 config 아님"; 차단은 PreToolUse hook.
3. **컨텍스트-리셋/keep-discard vs 연속 단일컨텍스트 편집** — Anthropic 장기 harness 는 구조화 artifact 를 fresh agent 로 핸드오프(generator+evaluator, "sprint contract") vs 한 컨텍스트 compaction.
4. **단일 단위테스트 oracle vs composite/semantic 검증** — "테스트 통과"로 충분한지 활발히 논쟁(UTBoost 등).
5. **HITL vs 완전자율** — vendor 는 인간을 "optional-but-recommended"; 어려운 task 에서 takeover 가 경험적으로 도움.

**SoloSquad 포지셔닝:** 합의 측에 위치 — markdown-as-goal(goal.md ≈ AGENTS.md 계보), 환경검증 루프, metric-passing 게이트. 분기축에서의 선택: **git revert keep/discard**(Anthropic "context reset/commit good state" 진영), **composite "ALL pass"**(single-vs-composite 논쟁의 composite 측). 대부분 시스템보다 *강한* 한 선택: **메트릭 집합을 사이클당 동결·provenance-정의 계약으로 취급**(Karpathy 는 1개 동결, SoloSquad 는 source/formula/threshold/direction 명시 composite 동결).

---

# Part G — SoloSquad 적용 전략

현재 코드(`src/cli/goal.ts` 풍부한 CLI new/list/show/run/status/stop/verify/queue + `src/engine/*` goal-parser·goal-runner·evaluator·tracker·guards·reconciliation·stop-hook-adapter):
엔진 루프는 안정·검증됨 → **손대지 않고**, authoring·검증·refine 보조를 얹는다(v1.3.2 §6).

## G1. goal authoring 보조 (P1 — 최대 UX 갭)
현재 `goal new` 는 템플릿 주석 읽고 수기 편집. 신설 `goal assist`(또는 skill): metric/pipeline 섹션 채움 가이드 + 후보 metric 제안 + OKR/SMART 측정가능성 점검. Voyager 커리큘럼·Reflexion critic 처럼 LLM 이 "이 goal 에 맞는 metric" 제안.

## G2. semantic validate (P1)
parse-time(goal-parser) 위에 추가: `source` 파일 **존재성**, formula **평가가능성**, pipeline `<team>/<agent>` **실존성**. 현재 parser 는 문자열만 수용. SWE-bench 식 "측정이 결정적·재현가능한가" 점검.

## G3. metric 품질 review (P1)
metric 정의를 LLM 검토 — provenance 명시·direction 합리성·threshold 타당성·**composite guardrail**(단일 Goodhart 회피)·leading/lagging 균형. "ALL pass" 유지 권장(이미 guardrail 패턴).

## G4. refine 루프 (P2 — 차별화)
`goal verify`(결정성 replay) 위에 "비결정/oscillation 진단 → threshold·pipeline bounded-edit 제안" 루프(v1.3.2 §8 SkillOpt 공유 인프라). **loop-detection 추가**(동일 pipeline 출력 반복 — discard-streak 와 별개). 진화/best-of-N 식 local-optima 탈출은 비용 트레이드라 옵션.

## G5. lifecycle 보조 (P1)
이미 성숙. `goal estimate`(예상 비용 — pipeline 복잡도·에이전트 과거비용 모델), `goal measure <metric>`(단일 metric 디버그 replay) 추가.

## G6. 비범위 (v1.4+)
goal별 사용자정의 termination policy(stop-hook 은 현재 SKILL 전용), goal 버전 히스토리, 진화/유전 탐색(local-optima 탈출 — 비용·복잡도↑).

---

# Part H — 궁극의 체크리스트

좋은 `goal.md` 작성·검증 시:

- [ ] goal 이 **휘발 목표**이고 영속 제약은 AGENTS.md 로 분리됐는가(2층 패턴)
- [ ] 각 metric 이 **name/formula/source/threshold/direction** 완비(provenance·SMART-measurable)인가
- [ ] `source` 파일이 **실존**하고 formula 가 **평가가능**한가(semantic validate)
- [ ] metric 이 **composite + ALL pass**(단일 Goodhart 게이밍 회피, guardrail 패턴)인가
- [ ] leading/lagging 균형 — 측정이 너무 늦지(lagging-only) 않은가
- [ ] verifier(metric source)가 **게이밍-어려운·신뢰가능**한가(reward hacking 회피)
- [ ] pipeline 의 `<team>/<agent>` 가 **실존**하는가
- [ ] **수렴 조건**(N연속 keep = patience)과 **정지**(budget·discard-streak = hard cap/no-progress)가 명확한가
- [ ] 재측정이 **결정적·재현가능**(고정 commit replay)한가
- [ ] **비가역 행동**(push 등)에 인간 승인 게이트가 있는가
- [ ] runaway 방어 — budget cap + discard-streak + (가능하면) 동일출력 loop-detection

---

## 출처

### 자율 목표지향 시스템
- Codex `/goal` — https://developers.openai.com/codex/cli/slash-commands · AGENTS.md https://agents.md/ · https://developers.openai.com/codex/guides/agents-md
- Karpathy autoresearch — https://github.com/karpathy/autoresearch · https://x.com/karpathy/status/2031135152349524125
- BabyAGI — https://github.com/yoheinakajima/babyagi_archive · AutoGPT https://github.com/Significant-Gravitas/AutoGPT
- Voyager — https://arxiv.org/abs/2305.16291
- Reflexion — https://arxiv.org/abs/2303.11366
- SWE-agent — https://arxiv.org/abs/2405.15793 · SWE-bench https://github.com/SWE-bench/SWE-bench

### 목표/메트릭 프레임워크
- OKR — https://www.whatmatters.com/faqs/okr-meaning-definition-example
- SMART — https://en.wikipedia.org/wiki/SMART_criteria
- Eval-driven — OpenAI https://developers.openai.com/api/docs/guides/evals · Anthropic https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Goodhart — https://en.wikipedia.org/wiki/Goodhart%27s_law · spec gaming https://vkrakovna.wordpress.com/2018/04/02/specification-gaming-examples-in-ai/
- reward hacking — https://openai.com/index/chain-of-thought-monitoring/ · https://arxiv.org/abs/2503.11926
- leading/lagging — https://amplitude.com/blog/leading-lagging-indicators · guardrail https://mixpanel.com/blog/guardrail-metrics/

### 최적화 루프 / 실패 모드
- Hill-climbing/GA — https://github.com/aimacode/aima-pseudocode
- DSPy — https://github.com/stanfordnlp/dspy/blob/main/docs/docs/learn/optimization/optimizers.md
- Best-of-N — https://arxiv.org/abs/2110.14168 · https://arxiv.org/abs/2502.12668
- early stopping — https://keras.io/api/callbacks/early_stopping/
- reward overopt — https://arxiv.org/abs/2210.10760 · Breaking Agents https://arxiv.org/abs/2407.20859 · Goodhart taxonomy https://arxiv.org/abs/1803.04585
- agentic misalignment — https://www.anthropic.com/research/agentic-misalignment · building effective agents https://www.anthropic.com/engineering/building-effective-agents
- harness design — https://www.anthropic.com/engineering/harness-design-long-running-apps

## 레포 내 관련 코드
- `src/cli/goal.ts`(new/list/show/run/status/stop/verify/queue/active/next)
- `src/engine/goal-parser.ts` · `goal-runner.ts`(사이클 머신) · `evaluator.ts` · `tracker.ts`(results.tsv·_best.json) · `guards.ts` · `reconciliation.ts`(verify) · `stop-hook-adapter.ts`
- `src/util/goal-queue.ts`(1-active semaphore) · `agents/main/chief/SKILL.md`
