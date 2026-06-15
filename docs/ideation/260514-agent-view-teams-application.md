# Agent View / Agent Teams → SoloSquad 적용 ideation

- **출처 문서**: `docs/reference/claude-agent-team.md` (§1 Agent View 공식문서, §2 HN 요약, §3 Agent Teams 블로그)
- **작성일**: 2026-05-14
- **상태**: ideation (plan 승격 전 단계, 채택/기각 결정 필요)
- **청자**: SoloSquad 개발자(본인)

## 배경

Anthropic이 2026년 2월 공개한 Agent Teams + Claude Code v2.1.139의 Agent View는 SoloSquad의 핵심 가치 영역(다중 에이전트 오케스트레이션)과 정면으로 겹친다. 그러나 두 시스템은 **타깃 사용자**가 다르다:

- **Claude Code Agent Teams**: 터미널에 앉아 있는 개발자, 단발성 팀 구성
- **SoloSquad**: messenger 너머 1인 창업자, 24/7 상주 워크플로우

따라서 경쟁이 아닌 **패턴 차용** 관점에서 정리한다. 아래 7개 제안은 SoloSquad 본체에 적용 가능한 후보이며, v0.6 이후 plan으로 승격할지 결정한다.

## 제안 A — Plan Approval을 PM stage 라이프사이클에 통합 (우선순위: 높음)

**관찰**: Agent Teams는 위험한 작업에 대해 *팀원이 read-only Plan 모드에서 계획 수립 → lead가 자율 승인 기준에 따라 승인/거부* 패턴을 가진다. SoloSquad PM은 현재 stage delegation 시 plan/build 구분이 있지만, lead(PM)의 "승인 기준"이 프롬프트에 명시되지 않는다.

**제안**:
- `assets/orchestrator/SKILL.md`에 `approval_criteria` 절을 추가 — PM이 stage별로 거부 기준을 사전 선언 (예: "DB 스키마 변경 plan은 자동 거부", "테스트 미포함 plan 거부").
- `workflows/<id>/_status.yaml`의 stage 상태에 `plan_pending` → `plan_approved` 단계 삽입.
- 위험도 높은 stage(`engineering/architect`, `engineering/security-engineer`, 모든 마이그레이션)에 기본 적용.

**임팩트**: 자율 모드(v0.4 goal-runner)에서 PM이 destructive 작업을 사전 차단. 사용자 개입 빈도 감소.

**리스크**: stage당 1회 왕복 증가 → 라우틴 처리 시간 ↑.

## 제안 B — Workflow 내 mailbox 사이드 채널 (우선순위: 중)

**관찰**: 현재 SoloSquad의 agent 간 통신은 `_handoff.md`(stage 종료 시 단방향). Agent Teams는 mailbox로 1:1/broadcast 직접 통신을 지원해, 병렬 stage가 끝나기 전에 교차 검증이 가능하다.

**제안**:
- `workflows/<id>/_messages.jsonl` append-only mailbox 도입. 각 줄: `{ts, from, to, kind: "note"|"question"|"ack", body}`.
- PM에게만 read 권한, team subagent에게는 자신 앞 메시지만 read.
- **broadcast 금지**: 본 문서가 명시한 "비용이 팀 규모에 비례" 경고를 그대로 수용. 1:1 또는 `to: pm`만 허용.

**임팩트**: 크로스레이어 작업(프론트엔드 + 백엔드 + 테스트 병렬)에서 인터페이스 합의를 stage 종료 전에 확정 가능.

**리스크**: messenger UX 노출 시 복잡도 ↑ → 초기엔 파일 시스템만, Discord 표면화는 보류.

## 제안 C — File-disjoint task lock을 reconciler에 보강 (우선순위: 중)

**관찰**: Anthropic이 공개한 C 컴파일러 프로젝트(16 에이전트 / 2주)는 `current_tasks/` 디렉토리 파일락으로 중복 claim을 방지했다. SoloSquad `WorkflowReconciler`(v0.3.0)는 crash recovery는 처리하지만 **동시 stage의 파일 영역 충돌 방지**는 없다.

**제안**:
- stage 시작 시 `workflows/<id>/locks/<path-hash>.lock` 생성 (target_repo 내 글로브 패턴 기록).
- 다른 stage가 동일 또는 겹치는 글로브를 요구하면 reconciler가 `blocked` 상태로 유지.
- `src/engine/guards.ts`(v0.4 미구현) 첫 가드로 채택.

**임팩트**: 자율 goal 사이클에서 file overwrite 사고 방지. 본 문서가 "tasks must be file-disjoint"를 핵심 합의로 강조한 것과 정합.

**리스크**: 글로브 충돌 판정 로직 복잡도. 초기엔 디렉토리 prefix 매칭만.

## 제안 D — `solosquad agents` CLI (우선순위: 낮음)

**관찰**: Agent View는 백그라운드 세션을 한 화면 테이블로 모니터링한다. SoloSquad의 `solosquad status`는 단발성 스냅샷이라 long-running 라우틴 추적이 어렵다.

**제안**:
- `solosquad agents` (또는 `solosquad workflow watch`) 신규 CLI — `<org>/workflows/*/`와 `<org>/goals/*/`(v0.4)의 현재 상태를 라이브 테이블로 표시.
- Discord `#workflow` 채널의 콘솔 대응물. 토큰을 추가 소비하지 않는 로컬 파일 polling만.

**임팩트**: 개발자/파워유저가 messenger 없이 터미널 모니터링. 본인 개발 워크플로 직결.

**리스크**: 우선순위 낮음 — `solosquad status` 보강이 더 저렴.

## 제안 E — Hook 점진 채택 (TaskCompleted 대응) (우선순위: 중)

**관찰**: Agent Teams는 `TaskCompleted` hook의 exit code 2로 완료를 차단하고 피드백을 재주입한다. SoloSquad는 23:00 PM Compaction이 유사 역할이지만 stage-level이 아니라 일 단위다.

**제안**:
- `_status.yaml` stage 항목에 `quality_gate: {script, on_fail}` 필드 추가.
- 예: `quality_gate: {script: scripts/lint.sh, on_fail: revise}` → 실패 시 stage를 `needs_revision`으로 마킹 + handoff에 실패 로그 자동 첨부.
- Hook 자체를 SoloSquad가 새로 만드는 게 아니라 **Claude Code의 hooks를 stage 라이프사이클에 매핑**.

**임팩트**: 자율 모드에서 PM이 stage 결과를 사후 검증하지 않아도 품질 게이트 자동화.

**리스크**: Windows/Unix 스크립트 호환성(이미 cross-platform 규칙 존재이므로 관리 가능).

## 제안 F — `/loop` 메타포로 goal-runner 노출 (우선순위: 낮음)

**관찰**: Claude Code `/loop`은 동적 self-pacing 반복. v0.4 goal-runner의 keep/discard 사이클이 메커니즘적으로 동일.

**제안**:
- `solosquad goal run --loop`로 노출. `/loop`처럼 사이클 간격을 모델이 self-pace (cron 강제 안 함).
- 비용 가드(제안 G)와 묶어서 도입.

**임팩트**: cron 기반보다 진행상황 반응형 사이클이 자율 워크플로에 자연스러움.

**리스크**: 토큰 비용 폭주 가능 — 단독 도입 금지, 제안 G와 동시.

## 제안 G — 토큰 예산 가드 정식화 (우선순위: 높음)

**관찰**: Agent Teams는 단일 세션 대비 5~7배 토큰. C 컴파일러 사례 $20K/2주는 SoloSquad 자율 goal 사이클에서도 재현 가능한 위험.

**제안**:
- `src/engine/guards.ts`에 `BudgetGuard` 정식화: per-goal / per-day / per-workflow 토큰 상한.
- 상한 초과 시 PM에게 alarm + goal 자동 일시정지.
- `workspace.yaml`에 `budgets.token.daily`, `budgets.token.per_goal` 필드 추가.

**임팩트**: 자율 모드의 가장 큰 운영 리스크 차단. v0.4 immutable engine 영역 확장으로 적합.

**리스크**: 사용자 알람 피로 → 임계치를 단계화(soft warn → hard pause).

## 우선순위 정리

| 제안 | 우선순위 | v0.6 plan 후보 | 비고                          |
| :--- | :------- | :------------- | :---------------------------- |
| A    | 높음      | ○              | 자율 모드 안전성 핵심         |
| G    | 높음      | ○              | 비용 폭주 차단, A와 묶음 권장 |
| B    | 중        | △              | messenger UX 영향 검토 후    |
| C    | 중        | △              | engine guards 첫 가드로 적합  |
| E    | 중        | △              | hook 호환성 검증 필요         |
| D    | 낮음      | ×              | status 보강으로 충분 가능     |
| F    | 낮음      | ×              | G와 묶지 않으면 도입 금지     |

## 미해결 질문

- Plan Approval(A)이 자율 모드(v0.4)에서 사용자 개입을 강제하면 "24/7 자율"이라는 핵심 가치와 충돌하지 않는가? → `approval_criteria`가 충분히 구체적이면 lead가 자율 승인 가능하다는 본 문서 서술에 의존.
- Mailbox(B)를 도입하면 `_handoff.md` 프로토콜이 부분 무력화되는가? → 둘은 보완관계로 설계(handoff=stage 종료 시 정식 인계, mailbox=stage 내 ad-hoc).
- File lock(C)이 SoloSquad의 PM 위임 모델(Claude Code Task 도구)과 시점이 맞는가? → Task 도구 호출 시점은 reconciler가 가로채기 어려움. lock은 PM 프롬프트 사전 합의로만 강제 가능 — 검증 필요.
- 토큰 가드(G)의 default 상한은? → C 컴파일러 사례를 hard 상한으로 보고 일반 goal은 1/100 수준($200/goal 가정)부터 시작 검토.

## 다음 액션

- 제안 A + G를 v0.6 plan(`docs/plan/v0.6-default-workflow-tuning.md`) §최신 절에 검토 항목으로 추가 — *결정 보류, ideation 단계로 표기*.
- 나머지는 본 문서에 보관, v0.7 plan 초안 작성 시 재검토.
