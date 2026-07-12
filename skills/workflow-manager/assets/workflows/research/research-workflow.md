# SoloSquad Research Workflow — 자율 goal 기반 4h 연구 루프

> **역할:** `docs/research/` 의 운영 매뉴얼. `solosquad goal` 로 research 를 시작하면 **~4시간
> 동안 가설 수립 → 실험 → 검증 사이클을 자율 반복**하다가, 유효 결과가 나오면 `final-result.md`
> 로 종결하고 **paper 양식으로 `reports/` 에 저장**한다. Ralphthon 해커톤의 3시간 무인 구간을
> 견디도록 설계한다.
> **근거:** [[260712-long-horizon-codex-goals-vs-fable5]](goal 구조·자율 프롬프트) ·
> [[260712-ralphthon-icml-review-and-passing-paper]](rubric=스펙·리뷰 4축·날조 0) · Ralphthon Participant Guide.

---

## 0. 파이프라인 한눈에

```
[spec] ──▶ [자율 Ralph Loop 3h] ─────────────▶ [수렴] ──▶ [사람 편집] ──▶ [제출]
 사람        가설→실험→검증(반복, 무인)          유효/예산소진    paper 다듬기    hard cut
 O                    X (무인)                       ─             O            ─

기록 흐름:  docs/research/<subject>/            →  reports/<paper>.{tex,pdf}
            research-plan · 26xxxx_*/exp-* · final-result       (ICML 4p 양식)
```

**Ralphthon 타임라인 매핑:**
| 시각 | 단계 | 사람 |
|---|---|---|
| 11:00–12:30 | **spec** — goal 6필드 확정, 데이터 로드, rubric 고정 | O (전면 참여) |
| 12:30–15:30 | **Ralph Loop (3h)** — 자율 가설/실험/검증 반복 | **X (무인 — 본 설계의 핵심)** |
| 15:30–16:30 | **사람 편집** — paper 다듬기·최종 제출 | O |
| 16:30 | **hard cut** + matching snapshot | — |
| 16:35–17:00 | **self-review** 제출(Track 1) | O |

---

## 1. 무인 자율성 설계 (3h — 사람이 지시 못 함)

> Participant Guide: 12:30–15:30 Ralph Loop 동안 사람이 개입하지 않는다. **워크플로가 사람을
> 기다리면 곧 실패**다. 아래 4규칙으로 "묻지 않고 끝까지" 를 강제한다.

1. **블록 조건 사전 해소 (spec 단계에서 전부).** 사람만 줄 수 있는 입력(데이터셋·통과기준·경계)은
   **12:30 이전에 goal 6필드로 고정**한다. 루프 중에는 새 입력이 필요 없어야 한다.
2. **No-blocking 규칙 (Fable §2.4-4).** 되돌릴 수 있는 행동은 **묻지 말고 진행**. 사람 입력이 정말
   필요한 상황이 와도 **대기하지 않고** → 최선안 산출 + `blocked` 라벨로 플래그하고 계속 진행.
3. **증거로 완료 판정 (Codex §1.3 · Fable §2.4-1).** 완료는 *모델 자기 선언*이 아니라
   **verifier subagent 의 리뷰 통과**(§3)로만. 예산/시간 도달 시 **자동 완료 아님** → 진행/블로커 요약.
4. **시간·예산 박스 (무한루프 방지).** 사이클당 예산 + 최대 사이클 수 상한. 도달 시 그때까지의
   **최선 결과로 종결**(수렴 실패도 정직한 산출). 컨텍스트 카운트다운은 모델에 노출 안 함(Fable §2.5).

## 2. goal primitive 개선 (Codex 6필드 + Fable 4프롬프트)

> `solosquad goal` 이 research 를 돌릴 때 아래를 강제/주입한다. (현재 goal 스펙 대비 개선분 — 구현 시 skill/authoring 규약에 반영.)

**(A) Codex 6필드를 goal authoring 필수로** (문서1 §1.2):
`Outcome · Verification surface · Constraints · Boundaries · Iteration policy · Blocked condition`.
특히 **Verification surface(= 이 goal 의 eval)** 와 **Blocked condition** 을 저장 전 게이트로.

**(B) Fable 자율 프롬프트 4종을 무인 실행 컨텍스트에 상시 주입** (문서1 §2.4):
1. **근거 기반 보고** — "진행 보고 전, 각 주장을 이 세션의 tool result 에 대조하라. 증거를 가리킬 수 있는 것만 보고." (날조 차단)
2. **체크포인트 정지 규율** — 파괴/비가역/스코프변경에서만 정지(무인이라 정지=플래그).
3. **자율 파이프라인 reminder** — "너는 자율 실행 중이다. 사용자는 안 보고 있다. 되돌릴 수 있으면 묻지 말고 진행. 마지막 문단이 계획/질문/약속이면 지금 도구로 실행하라."
4. **verifier subagent > 자기비평** — 완료 판정은 별도 컨텍스트 리뷰 에이전트로(§3).

**(C) effort 정책:** research goal 자율 실행 = **high**, 최난도 실험/verify = **xhigh**, 집계 등 기계작업 = low/medium.

## 3. 검증 단계 = Track 2 review 내재화 (핵심)

> 나는 Track 1 이지만, **검증 게이트를 Track 2 review agent 로 설계**한다. 루프는 "독립 리뷰어가
> Weak Accept 이상을 줄 때" 수렴한다 — 이게 "self-review = 리허설"(문서2 §4.5)의 실행형이다.

- **verifier subagent** 가 매 사이클 산출을 **openagentreview 스키마로 채점**:
  `soundness 1–4 · presentation 1–4 · significance 1–4 · originality 1–4 · overall 1–6 · confidence 1–5 · comments(증거 기반)`.
- **수렴 조건:** `overall ≥ 4`(Weak Accept) **AND** 주제 rubric(research-plan §5) 통과. 미달이면
  verifier 의 evidence-based comments 를 다음 사이클 개선 지시로 투입 → 재실험/재작성.
- **분리 컨텍스트 필수**(문서1 C6): 생성한 에이전트가 자기 채점 금지. 새 verifier 가 로그·아티팩트를
  대조해 채점(자기비평보다 강함).
- **날조 게이트:** comments 는 반드시 run/log/수치에 앵커. 증거 없는 주장은 리뷰에서 감점→탈락.

## 4. 사이클 구조 (가설 형성 → 실험 → 검증)

```
while (rubric 미통과 && 예산 남음):
  1. 가설 형성  — 확산→수렴 (§4.1, PM agent 주도)
  2. 실험 실행  — 26xxxx_<name>/experiment-plan.md → 실행 → experiment-result.md (증거 앵커)
  3. 검증       — 수치 eval (§4.3): 주제 rubric 임계 + Track2 verifier(§3)
       ├ 통과 → 루프 종료 → final-result.md
       └ 미달 → 진단을 §4.1 확산 입력으로 → 다음 사이클
  (예산/시간 도달 → 최선 결과로 강제 종료 + 미통과 축 명시)
```

### 4.1 가설 형성 = 확산 → 수렴 (PM agent 주도) 🆕

> **문제(2026-07-12 회고):** 새 가설을 *내 사전지식에서만* 뽑으면 창의성·다양성·확장성이 떨어진다
> (예: 본 연구가 silicon sampling·WTP·conjoint 문헌을 안 보고 재발명). → 가설 형성을 **확산→수렴**
> 2단계로, **PM(오케스트레이터) 에이전트**가 주도한다.

- **확산(divergence) — 넓게 벌린다.** 직전 사이클 진단을 입력으로, PM 에이전트가 **병렬 서브에이전트**로
  후보 가설을 다양하게 생성. **내부 추론에만 의존 금지:**
  - **문헌 조사** — WebSearch/WebFetch로 관련 논문·방법론 탐색(예: silicon sampling, WTP 캘리브레이션,
    conjoint/MaxDiff, task-exchangeable inference). 새 프레임·기법을 후보로 흡수.
  - **인접 도메인·반례** — 다른 분야 유사문제 해법, 우리 결과를 반박할 각도.
  - 산출: 서로 다른 각도의 후보 가설 N개(다양성 = 중복 아님).
- **수렴(convergence) — 하나로 좁힌다.** PM 에이전트가 후보를 채점해 **한 사이클 = 한 가설**:
  (a) 직전 진단을 정면 검정 (b) **반증·측정 가능**(§4.3 수치 eval로 판정되는가) (c) 저비용 우선
  (d) 문헌과의 새 조합/관점(originality). 선택 근거를 experiment-plan에 기록.
- **박제:** 선택 가설 = Codex goal 6필드(experiment-plan.md). 확산의 문헌·탈락 후보는 **버리지 않고 기록**
  (다음 사이클 재료 + paper related-work 자산).

### 4.2 실험 실행
experiment-plan(goal 6필드) → 실행 → experiment-result.md. 모든 수치는 run/log 앵커(날조 0).

### 4.3 검증 = **수치 기반 eval** (질문에 답)

> 각 사이클·연구의 유효성은 **정량 지표를 사전등록 임계와 대조**해 판정한다(모델 자기선언 아님).

- **사이클 eval:** experiment-plan의 pre-registered 지표(예: 판별 분리도 Δ, directional accuracy,
  LOO 정확도, ECE)를 사전 고정 임계와 대조. 예: 본 연구 rubric(research-plan §5) = 방향정확도 ≥4/5
  **AND** baseline 우위 **AND** ECE ≤ 0.15. 이 수치가 이 goal의 **verification surface = eval**.
- **Track2 verifier(§3):** 그 수치 위에서 별도 리뷰 에이전트가 soundness/originality 등 4축 채점
  (수치의 *해석·정직성*을 심사). 수렴 = rubric 임계 통과 **AND** overall ≥ 4.
- **정직성 규율:** 지표가 임계 미달이면 "실패"로 기록(과장 금지). 소표본(N)이면 검정력 한계를 명시
  — 본 연구 C6(N=5 5/5)를 C7(N=14 0.64)이 교정한 것이 그 예.

## 5. 종결 산출 — paper 양식 (`reports/`)

> `final-result.md` 가 서면 결론이라면, **paper 는 그것을 ICML 리뷰 4축이 높게 나오도록 역설계한
> 제출물**이다. `reports/<subject>-<26xxxx>.tex`(+`.pdf`).

**형식 하드게이트 (위반=실격, 문서2 §1.4):**
- 공식 **ICML 2026 LaTeX**(`docs/ideation/reference/icml2026/` 템플릿 복제), 2단 10pt Times.
- **본문 ≤ 4페이지**(refs/appendix 제외) — Ralphthon 하드리밋.
- **완전 익명화**(저자·소속·감사문 0, 자기인용 3인칭) — double-blind.
- **Impact Statement 절 필수**(번호 없음, page limit 미포함) — 없으면 감점.
- PDF 단일 파일, Type-1 폰트.

**구조 = 리뷰 폼에 1:1 매핑 (문서2 §4.1):**
| 섹션 | 겨냥 축 | 확보물 |
|---|---|---|
| Abstract(단일 문단 4–6문장) + Intro | Significance | "왜 중요한가" 명토 |
| Method(재현 가능 디테일) | Presentation·Soundness | 재현 충분 정보 |
| Experiments(blind backtest·baseline) | Soundness | 증거·통계, 정직한 강약점 |
| Related/Novelty(1문단) | Originality | "무엇이 새로운가"(조합·관점도 인정) |
| Limitations | Soundness 방어 | 한계 정직 서술 |
- **모든 수치·인용 → 실제 run/log 앵커. 날조 0**(auto-gen paper 즉사 요인).
- 경로: 시간 안전을 위해 **General Track 1**(A100/VESSL 미의존) — 우리 시뮬은 LLM-페르소나 기반이라 훈련 불요(문서2 §4.6).

**self-review(17:00):** 같은 4축 + evidence-based comments 로 제출 → §3 verifier 결과 재사용.

## 6. 파일 흐름 · 산출 위치 (정합)

| 산출 | 위치 | 성격 |
|---|---|---|
| 연구 계획·실험·종합 | `docs/research/<subject>/` | **과정 기록**(사람 큐레이트) |
| 최종 paper(제출물) | `reports/<subject>-<26xxxx>.{tex,pdf}` | ICML 4p 양식 |
| 원시 런 로그·W&B | (선택) `reports/runs/` or W&B | raw 증거 |

> **정합 결정:** 이전에 열려 있던 `/reports` vs `docs/research/` 이중화 → **역할 분리 확정.**
> `docs/research/` = 과정, `reports/` = paper. v1.4.0/v1.4.3 PRD 의 "산출 `/reports`" 문구는
> "과정 `docs/research/` + paper `reports/`" 로 정합 필요(후속 편집).

## 7. 실패 모드 · 방어 (Ralphthon 리스크)

| 실패 | 방어 |
|---|---|
| 3h 무인 중 사람 대기 | §1 no-blocking + 블록 사전해소 |
| 무한루프(미수렴) | §1-4 시간·사이클 상한 → 최선 결과 종결 |
| 날조(auto-gen 즉사) | §3 verifier 앵커 게이트 + Fable 근거보고 |
| 형식 실격 | §5 하드게이트 체크(익명·4p·Impact) |
| 자원 프로비저닝 실패 | General Track 1(A100 미의존) |
| hard cut(16:30) 초과 | 15:30 사람편집 버퍼 역산, 루프 예산을 15:00에 소프트 마감 |
