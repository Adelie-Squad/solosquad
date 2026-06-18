# schedule 정의의 모든 것 — 스케줄링 시스템·프로액티브 에이전트 전수 분석과 SoloSquad 전략

> **청자:** SoloSquad 개발자(본인). dev 워크플로·내부 구현 관점의 설계 메모이며,
> 확정 기획(PRD)이 아니라 방향 탐색이다. v1.3.2 `schedule-manager`(`docs/prd/v1.3.2-domain-lifecycle-managers.md` §8) 의 근거 문서.
>
> **문서 목적.** "좋은 schedule 란 무엇인가"의 단일 레퍼런스. SoloSquad 에서 schedule =
> `schedules/<id>.md`(프롬프트) + cron 시간, node-cron 이 워크스페이스 timezone 으로 routine
> 실행(morning/evening brief·compaction·housekeeping). 현재 `ROUTINES[]` **하드코딩** →
> **동적·사용자 정의 가능 레지스트리**로 가려는 게 목표. 스케줄링 시스템 10종(cron·Quartz·K8s
> CronJob·Temporal Schedules·Airflow·GitHub Actions·systemd timer·n8n·RRULE·EventBridge) +
> 프로액티브 AI 에이전트(ChatGPT Tasks·Claude Routines/loop·Zapier·Make·LangChain ambient) 를
> 전수 조사해 **객관적 현황 → 인사이트 → SoloSquad 전략** 순으로 정리한다.
>
> **조사 방법 주의.** 병렬 리서치 에이전트의 웹 조사(2026-06-18). 일부 제품(ChatGPT Tasks 한도
> 등)은 help center 가 봇 차단 → 2차 출처. 본문에 [미검증]/[2차] 표기. verbatim 인용 전 라이브
> 재확인 권장.

---

## 목차

- **Part A** — TL;DR
- **Part B** — 객관적 현황: 스케줄링 시스템 10종 (config 모델)
- **Part C** — 어려운 문제 (timezone/DST·미스드런·중첩·idempotency·지터·드리프트·관측)
- **Part D** — 프로액티브/앰비언트 AI 에이전트 패턴
- **Part E** — 사용자 대면 schedule 작성 UX
- **Part F** — 인사이트 (수렴점·차이점)
- **Part G** — SoloSquad 적용 전략 (동적 레지스트리 스키마)
- **Part H** — 궁극의 체크리스트
- **출처**

---

# Part A — TL;DR

1. **스케줄 프리미티브의 보편 슈퍼셋:** recurrence 표현식 · **IANA timezone 이름** · overlap/동시성 정책 · 미스드런/catch-up 정책 · 지터 · start/end 경계 · enable/pause · 보관/이력.
2. **timezone 은 절대 offset 아닌 IANA *이름* 으로 저장**(DST 전환규칙은 이름만 보유, 규칙은 정부가 바꿈). K8s `timeZone` 은 IANA 강제, `CRON_TZ` 거부.
3. **정확히-한번 실행은 불가능.** 모든 스케줄러는 적어도-한번 → routine 프롬프트는 **idempotent** 필수. node-cron 은 in-memory(영속·catch-up 없음, 프로세스 살아있을 때만 발화).
4. **catch-up 은 bounded 가 합의.** Airflow 3.x 가 기본을 **off** 로 뒤집음(replay-all 위험). Temporal 은 `catchupWindow` 로 제한. node-cron 은 catch-up **아예 없음**.
5. **사용자 UX 4동작:** 프리셋 + "Custom" 탈출구 / 입력은 **translate-then-confirm**(cronstrue 영어 readback) / 저장 전 **다음 N회 실행 미리보기**(UTC·Local 토글) / **pause ≠ delete**.
6. **SoloSquad 의 schedule↔프롬프트 분리는 이미 존재**(`getSchedulesDir()` + `loadRoutinePrompt()`). 빠진 건 **레지스트리의 동적화 + config 프리미티브 명시 + validate**. node-cron v4 가 `noOverlap`·`maxRandomDelay`(지터)를 공짜로 제공 — 활용.

---

# Part B — 객관적 현황: 스케줄링 시스템 10종

## B.1 config 모델 비교

| 시스템 | recurrence | timezone | 중첩/동시성 | 미스드런/catch-up | 지터 | start/end | pause | 이력 |
|---|---|---|---|---|---|---|---|---|
| **Vixie cron** | 5필드 + `@`-strings | env `TZ`/`CRON_TZ` | 없음 | 없음 | 없음 | 없음 | 주석처리 | 없음 |
| **Quartz** | 6–7필드 + `L W #` | 트리거별 | `@DisallowConcurrent` | **misfire instr.** | 없음 | start/end | 가능 | job store |
| **K8s CronJob** | 5필드 | `timeZone`(IANA) | **`concurrencyPolicy`** | `startingDeadlineSeconds` | 없음 | 없음 | `suspend` | `*JobsHistoryLimit` |
| **Temporal Schedules** | cron/calendar/interval | `timezoneName` | **6-way overlap** | **`catchupWindow`** | **`jitter`** | `startAt`/`endAt` | `paused`+note | recent/upcoming |
| **Airflow** | cron/timetable/asset | tz-aware | `max_active_runs` | **`catchup`**(3.x=off) | 없음 | `start/end_date` | pause DAG | 전체 이력 |
| **GitHub Actions** | 5필드(`@` 거부) | UTC(+IANA opt) | 없음(best-effort) | 없음(드롭가능) | 없음 | 없음 | disable/enable | run 로그 |
| **systemd timer** | `OnCalendar=` | system/UTC | service 레벨 | **`Persistent=`** | **`RandomizedDelaySec`** | 없음 | enable/disable | `list-timers`+journal |
| **n8n** | 프리셋 + 6필드 cron | workflow/instance | — | 없음 | 없음 | 없음 | activate/deactivate | 실행 로그 |
| **RRULE(RFC5545)** | `FREQ/INTERVAL/BY*` | `DTSTART;TZID` | n/a | n/a | n/a | `UNTIL`/`COUNT` | n/a | n/a |
| **EventBridge Sched.** | `rate`/`cron`/`at` | IANA | 없음 | (start/end) | **FlexibleTimeWindow** | `Start/EndDate` | disable | next-10 미리보기 |
| **node-cron (현재)** | **5/6필드** | **`timezone`** | **`noOverlap`(v4)** | **없음** | **`maxRandomDelay`(v4)** | 없음 | `start()/stop()` | 없음 |

## B.2 핵심 관찰

- **cron 의 함정** — DOM·DOW 가 **둘 다 제한(neither `*`)이면 OR 매치**, AND 아님(`crontab(5)`).
- **Quartz** — misfire instruction(`FIRE_ONCE_NOW`/`DO_NOTHING`/`SMART_POLICY` 기본). 임계 60s.
- **K8s CronJob** — `concurrencyPolicy`(Allow/Forbid/Replace), `startingDeadlineSeconds`, `suspend`, history limit(성공 3·실패 1).
- **Temporal** — 가장 풍부: Spec/Action/Policy/State. overlap 6종(SKIP 기본·BUFFER_ONE·BUFFER_ALL·CANCEL_OTHER·TERMINATE_OTHER·ALLOW_ALL), `catchupWindow`(기본 1년·최소 10s), pause-on-failure.
- **GitHub Actions** — 최소 간격 **5분**, "고부하 시 지연·드롭 가능", 기본 브랜치 최신 커밋만, **60일 무활동 시 자동 비활성화**(공개 repo).
- **systemd** — `Persistent=`(부팅 시 미스드런 1회 실행 = catch-up), `RandomizedDelaySec`+`FixedRandomDelay`(host별 결정적 지터), 모노토닉 타이머(`OnUnitActiveSec=`).
- **cron 필드 정렬 분기** — 5필드(cron/K8s/GitHub) vs 6필드 초-우선(Quartz/n8n/**node-cron**) vs 6필드 연-말(AWS). 복붙 시 조용히 어긋남.

---

# Part C — 어려운 문제 (성숙 시스템의 해법)

1. **Timezone & DST** — wallclock 02:30 은 연 2회 모호(spring-forward 없음 / fall-back 두번). **IANA 이름 저장, offset 금지** — 이름만 DST 전환규칙 보유. 합의 완화책: **00:00–03:00 회피 또는 UTC 스케줄**. AWS: spring-forward 없는 시각 **skip**, fall-back **1회**.
2. **미스드런/catch-up/backfill** — 3전략 트레이드: *전부 replay*(Airflow `catchup=True`: 정확하나 스탬피드+중복처리 위험) / *지금 1회*(systemd `Persistent`·Quartz `FIRE_ONCE_NOW`) / *skip*(현재-상태 작업에 가장 안전). Airflow 가 3.x 에서 기본 off 로 뒤집음. Temporal 은 `catchupWindow` 로 bound. node-cron 은 `execution:missed` 이벤트만 내고 재실행 안 함.
3. **중첩 방지** — N+1 을 N 실행 중 시작 금지. K8s `Forbid`, Temporal `SKIP`/`BUFFER_ONE`, node-cron v4 `noOverlap`. 가드 없으면 TTL 분산 lease(flock/DB advisory/Redis SET NX).
4. **Idempotency** — 정확히-한번 전달 **수학적 불가** → 적어도-한번. catch-up·재시도·overlap-replace·split-brain 모두 중복 유발. 필수: **idempotency key**(보통 결정적 `{job}:{scheduled_time}`) + `ON CONFLICT DO NOTHING`. K8s 문서: 스케줄링은 *approximate*, "두 Job 생성될 수도".
5. **지터 / thundering herd** — 다수 에이전트가 같은 순간(`0 * * * *`) 발화 → 동기 스파이크. AWS/Marc Brooker: "backoff 제거가 아니라 지터 추가", **Full Jitter 최선**. systemd `RandomizedDelaySec`+`FixedRandomDelay`.
6. **클럭 드리프트 — wall vs monotonic** — wall(`CLOCK_REALTIME`)은 역행/도약 가능(NTP·DST·관리자), monotonic 은 전진만. 규칙: **wall 은 *언제* 캘린더 이벤트가 due 인지, monotonic 은 *경과시간/간격* 측정**. 두 wall 값 빼서 경과 측정 금지.
7. **과거 실행 관측** — last/next-run·성공실패·duration + **조용한 미스 탐지**(그냥 멈춘 job 은 실패 이벤트 안 냄 → 실패율 메트릭에 안 보임). systemd `list-timers`, K8s `lastScheduleTime`. 베스트: **dead-man's-switch/heartbeat** 가 *부재*에 경보.

---

# Part D — 프로액티브/앰비언트 AI 에이전트 패턴

**전환: reactive(pull) → proactive(push).** 프로액티브 에이전트는 "프롬프트 없이 대신 행동 — 조건 모니터·작업 스케줄". LangChain *ambient agents*(2025-01): "이벤트 스트림 청취·행동", 두 특성("인간 메시지가 유일 트리거 아님" + "복수 동시 실행") + HITL 모드(Notify/Question/Review).

**시간트리거 vs 이벤트트리거.** Claude Code 문서가 명시 구분: 시간(`/loop`·cron) = "배포 폴링·PR 베이비싯"; 이벤트(Channels/webhook) = "폴링 대신 발생 즉시 반응". SoloSquad brief 는 **시간트리거/digest** 케이스.

**Digest/briefing 이 지배적 프로액티브 유스케이스** — morning brief(Gemini Daily Brief: Gmail+Calendar+Tasks 합성), end-of-day digest, daily standup. Anthropic Routines 예시: 야간 트리거가 "Slack 에 요약 게시 → 팀이 정돈된 큐로 하루 시작". = SoloSquad morning/evening-brief.

**제품별 recurrence UX + 최소 간격(핵심 차별점):**

| 제품 | recurrence UX | 최소 간격 | 기타 | 비고 |
|---|---|---|---|---|
| ChatGPT Tasks | NL + daily/weekly/monthly + Custom | **15분** | ≤10 active·≤4/hr | beta, 복잡 recurrence 오류 [2차] |
| Zapier Schedule | hourly/day/week/month + 주말토글 | ~플랜 폴링 | "설정시각 수 분 내" | |
| Make.com | interval/day/weekday/dates + CRON | **15분**(플랜) | ~100 run/분 | [2차] |
| Claude `/loop` | `5m`식 → cron | 1분 | 50 task/세션·**7일 만료**·catch-up 없음 | |
| Claude Routines(cloud) | 프리셋 + custom cron | **1시간** | 일일 run cap | |

**거의 보편 신뢰성 디스클레이머:** 모두 정확 타이밍을 헤지 — Zapier "수 분 내", Claude 최대 30분 지터+catch-up 없음, ChatGPT beta 오류. **"정확 시각"은 마케팅이지 보장 아님.** [ChatGPT 수치 2차 — help center 봇 403].

---

# Part E — 사용자 대면 schedule 작성 UX

수렴 패턴 4동작:
1. **프리셋 + "Custom…" 탈출구** — Google/Apple/Outlook 캘린더 모두 Daily/Weekly/Monthly/Custom, **RRULE 을 숨은 직렬화**로(의도적 천장 — 네이티브 UI 가 모든 RRULE 표현 못함). 80% 는 4–5 프리셋, "Custom"은 raw cron 아닌 구조화 빌더.
2. **모든 cron/NL 입력은 translate-then-confirm** — **cronstrue 식 영어 readback**("`*/5 * * * *`"→"Every 5 minutes") 항상 표시. NL→cron(cronslator/crontab.guru)은 "every weekday at 9am"→`0 9 * * 1-5`; readback 이 NL 모호성 안전장치.
3. **저장 전 다음 N회 미리보기 + UTC/Local 토글** — EventBridge "next 10 dates, UTC vs Local"가 골드스탠다드. 전방 투영이 DOM/DOW·timezone 실수를 조용한 미스 전에 잡는 최저비용 수단.
4. **pause 가 기본 가역 컨트롤, delete 는 teardown 전용** — Temporal `Pause()`+`note`(왜), K8s `suspend`(config 보존), GitHub 60일 자동비활성화는 과한 가드의 반면교사.

**가드레일:** (a) 하드 최소 간격(거부 또는 auto-bump — GitLab 은 sub-hour auto-adjust), (b) 소프트 "빈번하나 허용" 경고, (c) 인라인 문법 검증, (d) 영어 readback + next-runs 의미 검사.

**가장 깊은 교훈 — picker 가 아니라 데이터 모델.** Fowler *Recurring Events for Calendars*: 매 occurrence 를 materialize 하지 말고 **"이 날짜에 이벤트가 발생하는가?"에 답하는 Schedule** 을 조합형 **Temporal Expression** 으로 모델. RRULE 과 프리셋+Custom UI 의 지적 토대.

---

# Part F — 인사이트

## F.1 강한 수렴 (정착된 베스트프랙티스)
- **IANA timezone 이름**이 timezone 프리미티브(offset 금지).
- **overlap 정책**이 1급 필드(K8s·Temporal·node-cron v4).
- **bounded catch-up** > 무제한 replay(Airflow off·Temporal 윈도).
- 동기/fleet 스케줄엔 **지터**(Full Jitter 레퍼런스).
- **pause ≠ delete**(pause 는 config 보존).
- 저장 전 **next-runs 미리보기 + 영어 readback**.
- **idempotency 필수**(전달은 적어도-한번).
- 신뢰성은 **best-effort**, 정확-시각 아님.

## F.2 의미있는 분기 (명시적 결정 필요)
- **cron 필드 수/정렬** — 5필드 vs 6필드 초-우선 vs 6필드 연-말. *node-cron 은 5/6 초-우선 — 하나 골라 문서화.*
- **DOM/DOW 둘 다 제한** — Vixie cron OR vs AWS 금지. node-cron 은 cron 의 OR.
- **`@daily` 류 문자열** — cron/K8s/Airflow 지원, GitHub 거부.
- **catch-up 기본** — 제각각; node-cron 은 아예 없음.
- **최소 간격** — 1분(Claude `/loop`)~1시간(Claude cloud) — 기술 아닌 제품정책 선택.

---

# Part G — SoloSquad 적용 전략

현재 코드(`src/scheduler/routines.ts` `ROUTINES[]` 하드코딩 + `src/scheduler/index.ts` `cron.schedule(s.cron, …, { timezone })` workspace tz 기본 `Asia/Seoul`; 프롬프트는 `loadRoutinePrompt()` → `getSchedulesDir()` override 체인). **schedule↔프롬프트 분리는 이미 존재** — 빠진 건 *레지스트리 동적화* + *config 프리미티브 명시* + *validate*.

## G1. 동적 schedule 레지스트리 (P0 — v1.3.2 §7)
`ROUTINES[]` 하드코딩 제거 → `schedules/` 디렉터리(또는 `.solosquad/schedules.yaml` manifest)에서 routine 정의 로드. 수렴 슈퍼셋 기반 권장 스키마(각 `schedules/<id>.md` 백킹):
- `id`, `enabled`(pause, delete 아님)
- `cron`(필드 수 = node-cron 5/6 초-우선 **문서화**) **and/or** preset(`@daily`·`weekday@HH:MM`) — 기존 `timeToDailyCron`/`weeklyToCron` 을 preset 레이어로 유지
- `timezone` — 워크스페이스 IANA tz 상속, offset 금지
- `overlap`: `skip`(기본) — node-cron v4 `noOverlap` 공짜, 없으면 routine별 in-flight lock
- `jitter` — node-cron v4 `maxRandomDelay`; routine 늘면 필수(매 routine 정시 회피)
- `catchup`: 기본 **off**(node-cron 현실·Airflow 3.x 일치); 추가 시 bound
- 옵션 `startAt`/`endAt`, last/next-run 보관(관측)

## G2. `validateSchedule` (P0)
cron 표현식 파싱, `kind` enum, `channel` 존재, 프롬프트 파일 존재성. 저장 전 **next-N 미리보기**(워크스페이스 tz) + cronstrue 영어 readback. 최소 간격 가드.

## G3. idempotency + 조용한 미스 경보 (P1)
node-cron 은 in-memory(영속·catch-up 없음, 프로세스 살아있을 때만). 따라서 routine 프롬프트는 **idempotent** 해야 하고, **dead-man's-switch**(routine 부재 시 경보)를 둬야 — 성숙 시스템과 동일.

## G4. orphan 3개 처리 (P2)
`trace-rotate` → `system-housekeeping` 에 흡수됨(삭제 후보). `bot-health-check`·`leading-indicator` → 관측 레이어(세션 추적·budget 질의) 의존 → v1.4.0 까지 추적 또는 동적 레지스트리 위 opt-in 배선.

## G5. 사용자 UX (P1)
NL/preset → cron, 영어 readback, next-N 미리보기, pause 토글. `solosquad schedule create/list/edit/enable/disable/delete` CLI(현재 `run-routine` 수동 실행 + enable 플래그만).

---

# Part H — 궁극의 체크리스트

좋은 schedule 정의·검증 시:

- [ ] timezone 이 **IANA 이름**인가(offset 아님), 워크스페이스 tz 상속하는가
- [ ] cron **필드 수/정렬**(node-cron 5/6 초-우선)이 문서화됐고 입력이 거기 맞는가
- [ ] 저장 전 **next-N 실행 미리보기** + **영어 readback** 을 봤는가
- [ ] **overlap 정책**(기본 skip)이 있는가 — 긴 routine 이 겹치지 않는가
- [ ] **catch-up 기본 off** 인가(필요 시 bounded)
- [ ] routine 프롬프트가 **idempotent** 한가(중복 발화 안전)
- [ ] routine 多 시 **지터**가 있는가(정시 thundering herd 회피)
- [ ] **pause** 가 가역 컨트롤로 있는가(delete 와 구분)
- [ ] 최소 간격 가드가 있는가
- [ ] **조용한 미스 경보**(dead-man's-switch)가 있는가
- [ ] DST 위험창(00:00–03:00) 회피 또는 UTC 고려했는가

---

## 출처

### 스케줄링 시스템
- cron — https://man7.org/linux/man-pages/man5/crontab.5.html
- Quartz — https://www.quartz-scheduler.org/api/2.3.0/org/quartz/CronTrigger.html · best-practices
- K8s CronJob — https://kubernetes.io/docs/concepts/workloads/controllers/cron-jobs/
- Temporal Schedules — https://docs.temporal.io/schedule
- Airflow — https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/cron.html
- GitHub Actions schedule — https://docs.github.com/actions/using-workflows/events-that-trigger-workflows
- systemd timer — https://man7.org/linux/man-pages/man5/systemd.timer.5.html
- n8n Schedule Trigger — https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/
- RFC 5545 (RRULE) — https://www.rfc-editor.org/rfc/rfc5545.txt
- AWS EventBridge Scheduler — https://docs.aws.amazon.com/scheduler/latest/UserGuide/schedule-types.html

### 어려운 문제
- 지터 — https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/
- recurring 데이터 모델 — https://martinfowler.com/apsupp/recurring.pdf

### 프로액티브 에이전트 / UX
- LangChain ambient agents — https://www.langchain.com/blog/introducing-ambient-agents
- Claude Routines — https://code.claude.com/docs/en/routines · scheduled-tasks
- cronstrue — https://github.com/bradymholt/cRonstrue · crontab.guru — https://crontab.guru/

## 레포 내 관련 코드
- `src/scheduler/routines.ts`(`ROUTINES[]`·`loadRoutinePrompt`·`timeToDailyCron`/`weeklyToCron`)
- `src/scheduler/index.ts`(`startScheduler`·`cron.schedule … { timezone }`) · `src/scheduler/memory.ts`
- `src/util/paths.ts`(`getSchedulesDir` override 체인) · `schedules/*.md`(4 active + 3 orphan)
- `src/scheduler/freq-keyword-miner.ts` · `trajectory-extractor.ts`(미배선 마이너)

> **node-cron 현실 메모:** v4 는 `noOverlap`·`maxRandomDelay`(지터) 제공, `execution:missed` 이벤트 발화하나 **catch-up 없음·in-memory**. 동적 레지스트리는 이 제약 위에서 설계.
