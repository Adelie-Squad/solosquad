# RUN — "시작" 무인 실행 사양 (가상 시장 수요검증 시뮬레이션)

> **트리거:** 사용자가 **"시작"** 한 마디 → 아래를 **처음부터 끝까지 자율 실행**, 실행 중 **사용자에게
> 질문 0**. 산출 = ICML 4p 익명 paper(`reports/paper/main.pdf`) + Title + Abstract.
> **실행 주체:** 이 Claude Code 세션이 도구(bash·파일·verifier 서브에이전트)로 파이프라인을 구동.
> **설계 근거:** `skills/workflow-manager/assets/workflows/research/research-workflow.md`(자율 3h·no-blocking·Track2 검증) ·
> `research-plan.md`(가설·rubric·유효성 설계) · [[260712-long-horizon-codex-goals-vs-fable5]] · [[260712-ralphthon-icml-review-and-passing-paper]].

---

## 0. Pre-flight — "시작" **전에** 해소 (무인 중엔 fallback, 절대 대기 안 함)

| 의존 | 필요 이유 | 미해소 시 fallback(자동, 질문 없음) |
|---|---|---|
| **VESSL 로그인** (`vessl configure`) | A100 GPU 실험 | GPU 없이 **API-페르소나 경로**(General Track 1, A100 미의존)로 진행 + 한계 명시 |
| **MiroFish repo URL** | 시뮬 엔진 | v1.4.3 설계의 **최소 다중에이전트 시뮬레이터 자체 구현**으로 대체 |
| **HF 토큰** (Nemotron gated) | 페르소나 데이터 | 소규모 오픈 시드 세그먼트로 대체 + 표본 한계 명시 |

> 위 3개가 준비되면 GPU+MiroFish+Nemotron 정식 경로. 안 되면 **fallback으로 그냥 진행**(no-blocking).
> "시작" 시점의 상태를 setup 단계가 감지해 경로를 자동 선택한다.

## 1. 잠금 결정 (LOCKED — 실행 중 변경·질문 금지)

- **트랙:** Track 1 (AI Scientist). 시간 안전상 **General Track 1 경로 기본**, GPU/MiroFish는 가용 시 메커니즘으로.
- **가설/rubric:** `research-plan.md` §3·§5 그대로 (방향 ≥4/5 + baseline 우위 + ECE≤0.15 + 누출통제 + verifier overall≥4).
- **5 사례(익명화):** Dropbox · Zappos · New Coke · IBM · Buffer.
- **Baseline:** 무작위 · 무시뮬 LLM 추측 · base-rate.
- **이미지:** `quay.io/vessl-ai/torch:2.3.1-cuda12.1` (MiroFish 핀 있으면 매칭).
- **Paper:** `reports/paper/main.tex` (익명 blind, 본문 ≤4p, refs·appendix 별도).
- **검증:** verifier 서브에이전트(별도 컨텍스트)가 openagentreview 4축 채점 → **overall≥4 AND rubric 통과** 시 수렴.
- **날조 0:** 모든 수치·인용은 실제 run/log 앵커. `\TODO{}` 는 로그에서만 채움.

## 2. 익명성 ↔ repo 기입 결정 (사용자 지시 정합)

사용자: "paper에 이 저장소와 로그 기입". 그러나 **double-blind = 식별정보 금지**(org명 `Adelie-Squad` 노출 시 desk-reject 리스크). **해소:**
- **제출(blind) PDF:** "Software and Data" 절에 **익명 저장소**로 표기(현 main.tex 반영). 로그는 익명 참조.
- **실제 URL `https://github.com/Adelie-Squad/solosquad`** = camera-ready 스왑용으로 main.tex 주석 + 본 문서에 기록. 채택 후 `\usepackage[accepted]{icml2026}` 로 전환하며 de-anonymize.
- 결과물이 repo에 올라가는 사실은 유지 — 단 **리뷰 시점엔 익명**. (Ralphthon이 익명성 미강제라고 사용자가 확인하면 실 URL로 교체.)

## 3. 파이프라인 (무인 · 타임박스 ~4h)

```
[setup 0–20m] → [자율 루프 ~3h] → [수렴] → [paper 채움·컴파일] → [self-review] → 종료
```

**S1. Setup (~20m):** pre-flight 상태 감지 → 경로 선택(정식/fallback). VESSL run 생성(GPU 경로면
`vessl run create -f ~/vessl-ralphthon/notebook.yaml`). 페르소나 로드. 익명화 사례 코퍼스 구성(예측 전
ground-truth 격리). rubric 고정 재확인.

**S2. 자율 실험 루프 (~3h · no-blocking):** `research-plan.md` §6 로드맵 순서 —
`baseline-and-harness → 5case-blind-backtest → calibration → ablation → leakage-audit`.
각 실험: `26xxxx_<name>/experiment-plan.md`(goal 6필드) 작성 → 실행 → `experiment-result.md`
(claim inventory = 주장→로그 앵커, epistemic 라벨) → **verifier 서브에이전트 채점** → 미달이면 comments
반영해 재시도. **막히면 최선안+`blocked` 플래그 후 계속, 대기 없음.** 우선순위: H1(백테스트) 필수 →
예산 남으면 H2→H3→H4.

**S3. 수렴/종료 판정:** rubric 통과(verifier overall≥4) **또는** 시간·예산 도달 → `final-result.md`
작성(종합 판정+confidence, rubric 대조, 기능화 권고=v1.4.3). 미통과여도 **정직한 산출로 종결**(과장 금지).

**S4. Paper 채움·컴파일:** `final-result.md`+로그로 `main.tex` 의 `\TODO{}` 를 **로그 앵커 값으로만** 채움.
Title/Abstract 확정. `pdflatex+bibtex+pdflatex×2` 로 `reports/paper/main.pdf`. **하드게이트 검사:
본문 ≤4p · 익명(저자·소속·감사문 0) · Impact Statement 존재 · 실 repo명 blind에 미노출.**

**S5. Self-review:** 같은 verifier로 4축 자가채점 → 최저축 있으면 S4 보강 1회 → 최종.

## 4. 무인 자율 규율 (실행 내내 주입 · 문서1 §2.4)

1. **근거 기반:** 진행/결과 보고 전 각 주장을 이 세션 tool result에 대조. 증거 없으면 서술 금지.
2. **no-blocking:** 되돌릴 수 있으면 묻지 말고 진행. 사람 필요 상황 = 대기 아니라 `blocked` 플래그+최선안.
3. **완료=증거:** 완료는 verifier 통과로만. 예산 도달 = 자동완료 아님, 요약.
4. **파괴/비가역만 정지:** 그런데 무인이라 정지=중단 플래그(대기 아님).
5. **시간 역산:** paper 컴파일·self-review 버퍼 확보 위해 자율 루프는 전체 예산의 ~75%에서 소프트 마감.

## 5. 산출물

| 산출 | 위치 |
|---|---|
| 연구 과정(계획·실험·종합) | `docs/research/virtual-market-demand-simulation/` |
| **최종 paper(제출물)** | `reports/paper/main.pdf` (+ `main.tex`·`references.bib`) |
| Title / Abstract | paper 내 + 종료 보고에 별도 표기 |
| 원시 로그(증거) | `docs/research/.../26xxxx_*/` + (GPU) VESSL/W&B |

## 6. 종료 조건 · 실패 처리

- **정상 종료:** `main.pdf` 생성 + 하드게이트 통과 + self-review 완료 → 종료 보고(판정·paper 경로·Title·Abstract).
- **부분 종료:** 시간 도달 시 그때까지 최선 결과로 paper 작성(미통과 축 명시). **날조로 채우지 않음.**
- **치명 실패(컴파일 불가 등):** 원인 + 부분 산출 보고 후 종료(무한 재시도 금지).

---

## ▶ 준비 완료 체크 (지금)

- [x] paper 스캐폴드 `reports/paper/`(main.tex·references.bib·스타일)
- [x] research-plan(유효성 설계) · research-workflow(자율 규율) · 본 RUN 사양
- [x] VESSL CLI·키(권한 600·pub 파생)·notebook.yaml
- [ ] **VESSL 로그인** (미완 — 안 하면 fallback 경로로 진행)
- [ ] **MiroFish repo URL** (미제공 — 안 주면 자체 시뮬레이터로 대체)
