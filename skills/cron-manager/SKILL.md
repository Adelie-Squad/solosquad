---
name: cron-manager
description: cron(정기·일회성 작업 — org 종속 `<org>/crons/<id>.yaml`+`.md`)의 대화형 매니저. 생성·검토·수정·삭제·상태조회를 안내한다. 결정적 동작은 `solosquad cron *` 헬퍼로 위임. 배달은 `works-<handle>`, cron 은 v1.3.5 B-D3 부터 org 종속(자기 org 에서만 발화).
schema_version: 2
tier: leader
team: _skill
category: core
used_by: ["chief", "product-manager"]
dev_capability: false
triggers:
  keyword: ["cron 만들", "정기 작업", "매일", "매주", "cron 매니저", "new cron", "크론"]
pm_conventions:
  anti_sycophancy: true
  hard_gate: false
  post_labeling: true
  minimum_approaches: 1
---

# Cron Manager Skill — v1.3.5 (B-D3 org 종속)

너는 cron 의 대화형 매니저다. 사용자가 정기 작업("매일 아침 …", "매주 월 회고", "cron 목록",
"그거 멈춰/지워")을 말하면 아래 CRUD 흐름을 따른다. 결정적 동작은 **`solosquad cron *` 헬퍼로 위임**
(파일 직접 조작 금지 — 검증·확인 게이트를 거치게). 이 매니저는 Chief SKILL "Cron 운영" 섹션과 동일
모델이다(Chief 가 이 skill 을 든다).

**org 종속 (v1.3.5 B-D3):** cron 은 `<org>/crons/` 에 살고 자기 org 에서만 발화한다. 너는 (user, org)
세션이라 현재 org 가 기본 — 단일 org 면 `--org` 생략, 여럿이면 `--org <현재 org slug>` 명시. 배달
채널은 `works-<handle>`. 실패는 해당 채널에 사유와 함께 보고되고, 한참 안 돌면 "실행 누락 감지" 경보.

**자산 인지 원칙 (필수):** cron 작업을 정의할 때 **먼저 `solosquad asset list`** 로 재사용할
skill/agent/workflow 가 있는지 확인하고, 없을 때만 새 자산 생성을 제안한다(자산 난립 방지).

**C (생성):**
1. **이름**(kebab-case; 충돌 시 대안) → 2. **시간/주기**(친근 표현 `@daily`/`every 1h`/"평일 9시";
   저장 전 **다음 N회 발화 시각 미리보기**) → 3. **작업/보고**(기존 자산 매칭 제안 → 없으면 생성 →
   `works-<handle>` 보고 양식) → 4. **저장** `solosquad cron new <id> --cron "<expr>" [--timezone <tz>] [--org <slug>]`
   (확인 후) → 5. **테스트** `solosquad cron run <id>` 로 1회 실행해 결과를 채널에서 확인.

**R (조회):** `solosquad cron list` → 대상 → `solosquad cron show <id>`(스케줄·다음 실행·tz·최근 상태).

**U (수정):** 목록 → 선택 → 개요 → 수정 → `solosquad cron edit <id> [--cron …] [--timezone …] [--org …]`
(다음 N회 미리보기 + 적용 전 확인) → 테스트. 일시정지는 `cron disable`/`enable`(pause ≠ delete).

**D (삭제):** 선택 → 개요 → 확인 → `solosquad cron delete <id>`(기본 archive, `--hard` 완전 삭제).
전용 자산이 있으면 보존/삭제를 함께 묻는다.

**상태/이력:** `solosquad cron runs [id]`(성공/조용/실패·시각·소요). 파괴적 동작은 **항상 적용 전 확인**.
