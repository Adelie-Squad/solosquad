# 장기 작업 가이드라인 — Codex "Goals" vs Claude Fable 5 프롬프팅

> **유형:** ideation (발산 · 결정 전 · 폐기 안 함)
> **작성:** 2026-07-12
> **청자:** SoloSquad 개발자(본인). 두 벤더가 "장기 실행(long-horizon) 작업"을 어떻게
> 다루라고 지시하는지 대조하고, SoloSquad 의 5 primitive(skill/agent/workflow/goal/cron)와
> 자율 엔진·bot·supervisor·cron 오케스트레이션에 무엇을 반영할지 본다.
> **연관:** [[260618-goal-authoring-best-practices]] · [[260621-workflow-goal-planning-evolution]] ·
> [[260605-ochestrator-session]] · v1.4.x 세션 오케스트레이션(`solosquad start`)

**소스**
- Codex: OpenAI Cookbook — *Using Goals in Codex* (`developers.openai.com/cookbook/examples/codex/using_goals_in_codex`)
- Claude: *Claude Fable 5 프롬프트 작성하기* (`platform.claude.com/docs/ko/.../prompting-claude-fable-5`)

---

## 0. 한 줄 대조

두 문서는 같은 문제("에이전트가 몇 시간~며칠짜리 목표를 사람 없이 끝까지 밀고 가게 하기")를
**정반대 레이어**에서 푼다.

- **Codex Goals = 제품 기능(primitive).** 스레드에 붙는 상태 객체(`/goal … pause/resume/clear`)로
  "완료 계약(completion contract)"을 외부화한다. 루프·continuation·budget 판정을 **하네스가** 관리한다.
- **Fable 5 = 모델 역량 + 프롬프팅 패턴.** 전용 "goal" 커맨드가 없다. 모델의 네이티브
  장기 지속성이 이미 좋아졌으니, **시스템 프롬프트 몇 줄**로 같은 행동(끝까지 진행·근거 기반 보고·
  적절한 지점에서만 정지)을 유도한다.

→ SoloSquad 는 이미 `goal` primitive 를 가지고 있으므로 **Codex 쪽 구조가 우리 goal 스펙의 청사진**,
**Fable 쪽 프롬프트가 우리 자율 엔진/supervisor 의 시스템 프롬프트 재료**가 된다.

---

## 1. Codex "Goals" 요지

### 1.1 정의 — Prompt 가 아니라 "완료 계약"
- **Prompt:** "다음 이걸 해" → 작업 → 결과 → 대기.
- **Goal:** 작업 → 증거 확인 → (미충족 & 예산 남음) 계속 / (충족·블록·예산소진) 정지.
- 스레드-스코프 지속 객체. 매 턴 목표를 재진술할 필요 없이 "이 결과가 참이 될 때까지 계속" 을 유지.

### 1.2 좋은 Goal 의 6 구성요소 + 템플릿
```text
/goal [원하는 최종 상태] verified by [구체적 증거] while preserving [불변 제약].
Use [허용 입력/경계]. Between iterations, [다음 행동 결정 정책].
If blocked, [정지 조건 + 필요한 입력].
```
| 요소 | 의미 |
|---|---|
| **Outcome** | 측정 가능한 최종 상태 (예: "p95 지연 120ms 미만") |
| **Verification surface** | 증거 출처 — 벤치마크·테스트 스위트·아티팩트·로그 |
| **Constraints** | 작업 중 회귀하면 안 되는 것 (예: correctness suite green 유지) |
| **Boundaries** | 허용 파일·도구·리소스·repo |
| **Iteration policy** | 매 시도 후 다음 행동을 어떻게 고르나 |
| **Blocked condition** | 언제 멈추고, 무엇이 있어야 풀리나 |

예시:
- 성능: `/goal Reduce p95 checkout latency below 120 ms, verified by checkout benchmark, while keeping correctness suite green.`
- 연구: 헤드라인 결과 재현 시도 → 검증 → **확정/근사 재구성/블록된 주장/불확실성** 4구간으로 분리한 리포트로 종료.

### 1.3 자율 루프의 안전 경계 (bounded autonomy)
- Continuation 은 **안전 경계에서만** 판정: ① 턴 완료 후 ② 스레드 idle ③ 큐에 사용자 입력 없음 ④ 예산 남음 & 증거상 목표 미충족.
- 핵심 원리: **목표는 지속하되, 완료는 증거가 결정한다.** (모델의 자기 판단이 아니라 verification surface)
- 예산 도달 시: **자동 완료가 아니라** 진행/블로커 요약을 생성.
- 생명주기는 사용자 통제: `/goal`, `pause`, `resume`, `clear`. Goal 은 전역 메모리가 아니라 스레드에 붙어 조사 맥락·검사 이력을 보존.

### 1.4 언제 쓰나 / 안 쓰나
- **쓴다:** 결승선은 명확하나 경로가 불확실 / 반복적 증거 확인(최적화·디버깅·테스트·연구) / "계속해" 를 반복하게 되는 상황.
- **안 쓴다:** 일회성 편집·설명·간단 리뷰 / 완료기준 없는 모호한 목표 / 즉시 멈추는 게 맞는 작업.
- 연구 전용: **claim inventory** (주장→증거 매핑), 재현 정도를 epistemic 라벨로 구분(정확 재현/근사/블록/불확실).

---

## 2. Fable 5 프롬프팅 요지 (장기 실행 관점)

### 2.1 역량 향상 (마이그레이션 유발점)
장기 자율(며칠짜리 목표 지향 실행), 명확한 난제의 **첫 시도 정확성**, 비전, 엔터프라이즈
워크플로, 코드 리뷰/디버깅 재현율, 모호성 탐색, **위임·협업**(병렬 서브에이전트·피어 통신).

### 2.2 하네스 재구성 신호 — "기본적으로 더 긴 턴"
- 개별 요청도 high/xhigh 에서 수 분, 자율 실행은 수 시간. → **클라이언트 타임아웃·스트리밍·진행표시기
  조정, 블로킹 대신 예약 작업으로 비동기 확인**.
- 모호할 때 과도한 계획 방지: *"When you have enough information to act, act. … give a recommendation, not an exhaustive survey."*

### 2.3 Effort = 지능/지연/비용의 주 레버
- 대부분 **high 기본**, 최난도 **xhigh**, 일상 medium/low. Fable 의 low 도 종종 구모델 xhigh 능가.
- high 에서 요청 안 한 리팩토링 방지 지시("A bug fix doesn't need surrounding cleanup…").

### 2.4 장기 실행용 핵심 프롬프트 4종
1. **근거 기반 진행 보고 (anti-fabrication):** *"Before reporting progress, audit each claim against a tool result from this session. Only report work you can point to evidence for…"* — 조작된 상태 보고를 거의 완전히 제거.
2. **체크포인트 정지 규율:** *"Pause for the user only when the work genuinely requires them: destructive/irreversible action, real scope change, or input only they can provide. … ask and end the turn, rather than ending on a promise."*
3. **경계 명시:** 문제 서술/질문일 뿐이면 산출물은 *평가*다. 고치지 말고 보고하고 정지. 상태 변경 명령 전 증거가 그 특정 행동을 지지하는지 확인.
4. **자율 파이프라인 system-reminder:** *"You are operating autonomously. The user is not watching… For reversible actions that follow from the original request, proceed without asking. … Before ending your turn, check your last paragraph. If it is a plan/question/promise, do that work now with tool calls."*

### 2.5 그 밖의 스캐폴딩
- **병렬 서브에이전트**: 자주 위임, 블로킹 대신 오케스트레이터↔서브에이전트 비동기, 장기 서브에이전트는 캐시 읽기로 비용·병목 절감.
- **메모리 시스템**: "파일당 교훈 하나 + 최상단 한 줄 요약". 과거 세션을 서브에이전트로 리뷰해 부트스트랩. → *SoloSquad 의 auto-memory 와 사실상 동일 설계.*
- **컨텍스트 예산 불안 억제**: 남은 토큰 카운트다운을 노출하지 마라. 노출 불가피 시 *"You have ample context remaining. Do not stop, summarize, or suggest a new session…"*
- **요청뿐 아니라 이유**: *"I'm working on [larger task] for [who]. They need [what output enables]. With that in mind: [request]."*
- **최종 요약 가독성**: 오래 무관찰로 일했으면 최종 메시지는 재-접지(re-grounding). 작업용 속기(화살표 체인·즉석 라벨) 버리고 결과부터, 완전한 문장으로.
- **send_to_user 도구**: 턴 종료 없이 사용자가 *그대로* 봐야 할 산출물/수치/직접 답변 전달. 도구 정의만으론 부족 — 시스템 프롬프트에 유도 지시 필수. 서술·추론은 라우팅 금지.
- **권장 스캐폴딩:** 난이도 상단부터 / 장기작업엔 **명시적 자체검증**(새 컨텍스트 verifier 서브에이전트 > 자기비평), `Run this every [X interval], verifying … against the specification` / 구모델용 과규범 스킬 리팩토링 / **추론 재현 지시 금지**(`reasoning_extraction` 거부 → Opus 폴백 증가).

---

## 3. 공통점

| # | 공통 원리 | Codex | Fable 5 |
|---|---|---|---|
| C1 | **목표는 지속, 완료는 증거가 결정** | verification surface 필수 필드 | "audit each claim against a tool result" |
| C2 | **Bounded autonomy — 안전 경계에서만 정지/판정** | idle·큐 없음·예산 남음 | 파괴/비가역/스코프변경/사용자 전용 입력에서만 pause |
| C3 | **진행 상황 조작 방지** | 증거 기반 continuation 판정 | 근거 없는 진행 주장 금지 |
| C4 | **예산 인식 + 한계 시 요약** | budget 도달 → 진행/블로커 요약 | (반대로) 예산 카운트다운 노출 억제 후 요약 유도 |
| C5 | **비동기·비블로킹 하네스** | continuation 은 idle 경계에서 | 타임아웃·예약작업으로 재구성 |
| C6 | **별도 컨텍스트 검증** | evidence source 외부화 | verifier 서브에이전트 > 자기비평 |
| C7 | **정지/인간 개입 지점의 명시적 정의** | blocked condition 필드 | 체크포인트 정지 규율 |
| C8 | **모호성 = 즉시 착수, 과계획 금지** | narrow enough to audit, broad enough for discovery | "act… recommendation not exhaustive survey" |

한 문장: **둘 다 "지속되는 목표 + 증거로만 판정하는 완료 + 안전 경계 정지 + 근거 기반 보고"** 라는
동일 골격을 공유한다.

---

## 4. 차이점

| 축 | Codex Goals | Fable 5 |
|---|---|---|
| **레이어** | 제품 기능/커맨드 primitive | 모델 역량 + 프롬프트 패턴 |
| **루프 소유** | 하네스가 continuation/budget 관리 (상태기계 외부화) | 모델 네이티브 지속성 + system prompt 로 유도 |
| **검증** | *구조적 필수 필드*(verification surface) | *프롬프팅 규율*("도구 결과 대조") — 직접 넣어야 함 |
| **예산** | 명시적 생명주기(도달 시 요약) | 카운트다운 **노출 금지** 권고 |
| **동시성** | 스레드당 단일 목표 | 다중 스트림·병렬 서브에이전트 강조 |
| **생명주기 제어** | `/goal pause/resume/clear` (사용자) | "계속해"/system-reminder 로 재개 |
| **정지 명세** | blocked condition 을 goal 문장에 인코딩 | 시스템 프롬프트의 체크포인트 규칙 |

핵심 긴장: Codex 는 **완료 계약을 객체로 굳혀** 재현·감사 가능하게 만든다(경직·명시적).
Fable 은 **모델을 신뢰하고 얇은 지시로** 같은 행동을 유도한다(유연·과규범 경계).
→ SoloSquad 는 **Codex 의 구조를 goal 스펙에**, **Fable 의 얇은 지시를 실행 시스템 프롬프트에** 나눠 쓰면 양쪽 장점을 취한다.

---

## 5. 핵심 인사이트 (SoloSquad 렌즈)

1. **"완료는 증거가 결정한다" 가 두 문서의 최대 공약수.** 우리 `goal` primitive 와 supervisor 의
   종료 판정이 *모델의 자기 선언*이 아니라 *tool result / eval*에 걸려 있어야 한다. 이건 이미
   [[260625-ai-planning-insights]] 의 "Eval = 심장" 테제와 정확히 맞물린다 — goal 의 verification
   surface = 그 goal 의 eval.
2. **Fable 의 "긴 턴 → 비동기 하네스" 경고가 v1.4.x 방향을 사후 검증.** `solosquad start`(bot+cron+
   supervisor, double-fire guard)가 바로 "블로킹 대신 예약·비동기 확인" 의 구현이다. 남은 건
   **진행 보고의 근거화**(C1/C3)를 supervisor·bot 메시지에 심는 것.
3. **goal 스펙에 빠진 6번째 필드 = blocked condition.** 현재 우리 goal 이 outcome/verify 는 있어도
   "언제 멈추고 무엇이 있어야 풀리나" 를 강제하지 않으면, 자율 실행이 무한 루프거나 조기 종료한다.
4. **verifier 서브에이전트(별도 컨텍스트) > 자기비평** — workflow 의 verify 스테이지가 정확히 이 패턴.
   goal/cron 실행 결과도 self-critique 대신 별도 에이전트 검증으로 돌릴 여지.
5. **메모리 설계 수렴.** Fable 의 "파일당 교훈 하나 + 한 줄 요약 + 중복 금지·오답 삭제" 는 우리
   auto-memory(MEMORY.md 인덱스 + 파일당 사실) 규약과 판박이. 이미 정답 경로에 있음을 확인.

---

## 6. SoloSquad 적용점 (실행 후보)

### 6.1 `goal` primitive — Codex 6필드를 authoring 규약으로
[[260618-goal-authoring-best-practices]] 를 6필드(outcome/verification/constraints/boundaries/
iteration-policy/**blocked-condition**) 체크리스트로 격상. 특히 **verification surface 를 필수**로 하고,
"이 goal 의 eval 은 무엇인가?" 를 저장 전 게이트로.

### 6.2 자율 엔진 / supervisor 시스템 프롬프트 — Fable 4종 이식
- **근거 기반 보고**(§2.4-1)를 supervisor/bot 진행 메시지 생성에 삽입 → "테스트 통과했다" 류 미검증 주장 차단.
- **자율 파이프라인 reminder**(§2.4-4)를 cron/goal 무인 실행 컨텍스트에 상시 주입 ("사용자 미관찰, 되돌릴 수 있으면 묻지 말고 진행, 마지막 문단이 약속이면 지금 실행").
- **체크포인트 정지 규율**(§2.4-2) → 파괴/비가역/스코프변경에서만 사용자 호출.

### 6.3 continuation 판정 — Codex 안전 경계 채택
supervisor 의 "계속/정지" 판정을 ① 턴 완료 ② idle ③ 사용자 입력 큐 없음 ④ 예산 남음 & goal.eval 미충족 —
4조건 AND 로 명문화. cron double-fire guard 와 같은 계열의 안전 경계.

### 6.4 send_to_user ↔ 메신저 스트리밍
[[260610-messenger-streaming-and-artifacts]] 의 스트리밍/아티팩트가 Fable 의 send_to_user 역할.
"산출물·구체 수치·직접 답변만 verbatim, 서술/추론은 라우팅 금지" 규율을 메신저 전송 계층에 반영.

### 6.5 effort 정책 — primitive 별 기본값 문서화
skill/agent/workflow/goal/cron 각각의 기본 effort 를 명시(예: 일상 cron=low/medium, goal 자율 실행=high,
최난도 workflow verify=xhigh). Fable "low 도 구모델 xhigh 급" 을 근거로 기본값 하향 검토.

### 6.6 예산 UX — 카운트다운 노출 억제
장기 goal/workflow 실행 중 모델에 "남은 토큰" 을 직접 노출하지 않도록 점검(Fable 이 조기 요약·세션
분할 제안을 유발한다고 명시). 노출 불가피하면 "ample context remaining" 안심 문구.

### 6.7 프롬프트/스킬 감사 — 과규범 제거 + 추론 재현 지시 삭제
Fable 권고대로 구모델용으로 쓴 과규범 스킬을 리뷰·감량하고, **"추론을 응답에 재현/전사하라" 류
지시를 전 스킬에서 감사·제거**(`reasoning_extraction` 거부 → Opus 폴백 증가 리스크). 우리 primitive
문서들이 지금도 이런 지시를 담고 있는지 스윕 필요.

---

## 7. 열린 질문 / 다음 액션

- [ ] 현재 `goal` 스펙에 blocked-condition·verification-surface 가 강제되는가? (미강제면 §6.1 반영)
- [ ] supervisor/bot 진행 메시지가 tool result 근거로 검증되는가, 아니면 모델 서술을 그대로 신뢰하는가? (§6.2)
- [ ] cron/goal 무인 컨텍스트에 자율 reminder 가 상시 주입되는가? (§6.3-4)
- [ ] 전 primitive 스킬에서 "추론 재현" 류 지시 스윕 → Fable 폴백 리스크 제거 (§6.7)
- [ ] primitive 별 기본 effort 표를 architecture 나 각 authoring 문서에 명문화 (§6.5)
