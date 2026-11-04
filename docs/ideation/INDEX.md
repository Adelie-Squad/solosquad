# Ideation INDEX — org 계층 (발산 · cross-repo)

> 제품 관점 발산/탐색(왜·만약). 결정 전, 폐기 안 함. 여러 repo 가 참조 가능.
> 신규는 `<name>_<YYMMDD>.md` 규칙. (docs 스킬 §2)

| 파일 | |
|---|---|
| [260514-agent-view-teams-application.md](260514-agent-view-teams-application.md) | |
| [260514-harness-pattern-adoption.md](260514-harness-pattern-adoption.md) | |
| [260522-author-guard-handle-decoupling.md](260522-author-guard-handle-decoupling.md) | |
| [260522-cli-auto-update.md](260522-cli-auto-update.md) | |
| [260523-multi-agent-v1.1-synthesis.html](260523-multi-agent-v1.1-synthesis.html) | |
| [260605-ochestrator-session.md](260605-ochestrator-session.md) | |
| [260610-messenger-streaming-and-artifacts.md](260610-messenger-streaming-and-artifacts.md) | |
| [260617-skill-md-authoring-best-practices.md](260617-skill-md-authoring-best-practices.md) | |
| [260618-agent-authoring-best-practices.md](260618-agent-authoring-best-practices.md) | |
| [260618-cron-authoring-best-practices.md](260618-cron-authoring-best-practices.md) | |
| [260618-goal-authoring-best-practices.md](260618-goal-authoring-best-practices.md) | |
| [260618-workflow-authoring-best-practices.md](260618-workflow-authoring-best-practices.md) | |
| [260621-multi-repo-execution.md](260621-multi-repo-execution.md) | |
| [260621-workflow-goal-planning-evolution.md](260621-workflow-goal-planning-evolution.md) | |
| [260623-squad-org-restructure.md](260623-squad-org-restructure.md) | |
| [260625-ai-planning-insights.md](260625-ai-planning-insights.md) | |
| [260712-long-horizon-codex-goals-vs-fable5.md](260712-long-horizon-codex-goals-vs-fable5.md) | 장기작업 가이드 대조: Codex Goals(완료계약·6필드) vs Fable 5(프롬프팅). 공통점 8·차이 7·적용 7 |
| [260712-ralphthon-icml-review-and-passing-paper.md](260712-ralphthon-icml-review-and-passing-paper.md) | Ralphthon ICML: 리뷰 rubric(4축+overall)·auto-research·"통과하는 paper" 역설계. 형식규격(2단10pt·4p·Impact Statement 필수)·double-blind·타임라인. ref: icml2026/ |
| [260803-solosquad-architecture-redesign.md](260803-solosquad-architecture-redesign.md) | **설계 개선 제안 (4축·18안건 + 항목별 1차 개선안).** 언어/배포·토폴로지·멀티LLM·하네스. 핵심: Track 0 HARD GATE 를 "언어 ADR"→"하네스 인터페이스 ADR" 로 교체 요구. v1.5.0 PRD 상위 종합 |
| [260810-hermes-agent-orchestration-topology.md](260810-hermes-agent-orchestration-topology.md) | **Hermes Agent 실측 조사 (1차 소스 only, 3부).** §A 현재 구조 — 오케스트레이션 3축(delegate_task 휘발성 팬아웃 · Kanban 영속 큐 · profile routing) · 멀티LLM 3층(메인/보조슬롯 12종/위임 + auth_type 5종·자격증명 풀·MoA·Codex ACP) · 세션 레인/화신 분리 · 컨텍스트. §B SoloSquad 환류. **§C 시간축(21,615 커밋) — 되돌린 결정 9건 · 되돌리지 않은 흐름 5건 · 보안 연쇄 10건 · 거절 루브릭/Footprint Ladder.** 최강 신호: **"모델에게서 노브를 5개월간 5회 회수, 반전 0회"**. **M9·M12·M13·§A3·§C1·§C3·§D2 에 입력** |
| [260810-openclaw-orchestration-topology.md](260810-openclaw-orchestration-topology.md) | **OpenClaw 실측 (385k★·77,813커밋).** Hermes 짝 문서 — 같은 문제에 **반대 답**. 서브에이전트=**1급 세션**(`agent:*:subagent:<uuid>`) · `context: fork` 허용 · push announce + `sessions_yield` · **배달 내구성**(30분 재시도·7일 보존·수동 retry) · worktree/visible 스폰 · ACP 런타임. AGENTS.md 독트린 — *"silent failure > crash"* · *"기본값이 곧 제품"* · **버그수정 production LOC net ≤ 0** · SQLite only |
| [260810-gstack-skill-harness.md](260810-gstack-skill-harness.md) | **gstack 실측 (127k★·362커밋, 수렴 곡선).** **빌드타임 프리앰블 합성**(`SKILL.md.tmpl` → `preamble-tier 1~4`, 범위 밖이면 빌드 실패) · **planted-bug 결과 평가**(LLM judge, *"ConnectionRefused was PASS"* 사고) · ETHOS 3원칙(Boil the Ocean — Hermes/OpenClaw 절제 규범과 **정면 대립**) · `SPAWNED_SESSION` 호스트 감지 · 소켓 분리 > 헤더 추론 |
| [260810-bmad-method-skill-lifecycle.md](260810-bmad-method-skill-lifecycle.md) | **BMAD-METHOD 실측 (51k★·16개월·메이저 6회).** SoloSquad 와 **문제 구조가 가장 가까움**. **필드 단위 3단 병합**(bundle→team→user, 병합 규칙 명시 + 스크립트 실패 시 산문 폴백) · 정체성 고정/페르소나 설정 · **v6-shims 의도전달 폐기 정책**("제거는 v7 컷, 6.x 마이너 절대 금지") · **2패스 검증기**(결정론 13 + 추론 13, 통과분 제외) · 2026-07~08 대통합(스킬→렌즈, **한 아티팩트=한 오너**) |
| [260810-pm-skills-marketplace.md](260810-pm-skills-marketplace.md) | **pm-skills 실측 (25k★·62커밋·코드 0줄).** **명사/동사 축** — Skills=개념(자동 로드) / Commands=절차(명시 호출). **배송 단위를 넘는 하드 참조 금지**(§B2 선행 제약) · 개수·목록·버전 정합 CI · "노출 지점 표" · **자산은 언어 중립이나 모델 중립은 아니다**(`Opus 4.8-tuned` 릴리스). primitive 선택표의 마지막 조각 |
| [260821-planning-agent-positioning.md](260821-planning-agent-positioning.md) | **포지셔닝 재정의 제안 (딥리서치 2라운드 · 서브에이전트 118 · 감사통과 근거 144).** 핵심: **"문제 정의"는 공백이 아니다** — spec-kit `assess`(1st-party, *"the missing discovery track"* · go/**kill**) · BMAD `forge-idea`(*"rejecting it … are all complete outcomes"*) · Keel 이 같은 어휘를 이미 쓴다. `bundle`=역할 팀 프로비저닝 + `squad` 확장 → **"에이전트 팀"도 차별점 아님**. **남은 빈틈 = 후보 횡단 지속 상태**(Hezo *"nothing leaks between them"* · assess `<slug>/` · Claude Code *"Per repository"* 3소스가 같은 곳에서 멈춤). **멀티 프로덕트의 자기모순**(Altman *"No great company … started doing multiple things at once"*) → **동시운영이 아니라 깔때기의 폭**으로 해소. **chief↔pm 은 fork 로 재프레이밍**(*"the same … message history as the main session"*) — 비용은 2단이 아니라 **의무 릴레이**. 표면=코어/표면 분리(*"the same underlying engine"*) · 비개발자 해법은 CLI 가 아니라 **별도 표면(Cowork)**. 수익=**채널에 결제 없음**(문서 98KB 0건) → OSS + **유료 상태 백엔드**. **"차별성"은 팔 수 없다**(수렴 b=0.871 · *"Inequality between workers decreased"*) → **경계 판단 19%p**. §11 **모순 검수 체크리스트**(같이 넣으면 안 되는 쌍 8종) |
| [260818-long-horizon-multi-agent-runtime.md](260818-long-horizon-multi-agent-runtime.md) | **장기작업 멀티에이전트 + 런타임/러너 실측 (딥리서치 2건 합본 · 서브에이전트 217 · 소스 53).** Hermes/OpenClaw/Claude Code **외부 대조군**. §B 자식=실행 vs 세션(Codex `AgentGraphStore` 영속 계보 · ACP `session/load` 는 **선택 능력**, `session/save` 없음 · `CLAUDE_CONFIG_DIR`/`CODEX_HOME` 이전으로 durable resume). §C 동시성 실측(Codex `max_threads` **6** · `max_depth` **1**=Hermes 와 독립 일치 · **worktree 격리 실패**·9.82GB/20분). §D 컴팩션 정량(96k→**~3%** 잔존 · 요약이 **FIFO 절단보다 나빴다** · Pass² 간극=**비결정성** · 벽시계 **62%**). §E 조율은 손해(오케스트레이터·토론이 **독립앙상블에 파레토 지배**). §F **세션 소유권 5답**(호출자/런타임/분할/에이전트/durable). §G **thread 1급화의 대가=락+10분 만료** → Assistants 2026-08-26 폐기. §H durable≠checkpoint(**전 프레임워크가 checkpoint 까지만**). §J 반대논거의 **경계**: "MAS 는 컨텍스트 열화 치료제이지 추론 업그레이드가 아니다". **M9·M10·M12·§C1 입력** |
| [260818-agent-distribution-channels.md](260818-agent-distribution-channels.md) | **에이전트 배포·유통 채널 비교분석 (딥리서치 · 서브에이전트 111 · 소스 27).** §C **MCP 2026-07-28 무상태화**(`Mcp-Session-Id` 제거·핸드셰이크 제거·DCR→CIMD·SSE 정식폐기·12개월 유예정책). §D `.dxt`→**`.mcpb`** (필수 6필드 · **`uv` 타입으로 5–10MB→~100KB** · **서명 없음**). §E plugin vs Gemini extension vs SKILL.md(**version 필드 부재** · `allowed-tools` Experimental). §F **npx vs uvx — Windows `spawn uvx ENOENT` 2년 재발**·`update-shell` 버그. **폴리글랏(npm 런처+플랫폼 바이너리) 권고**. §G `curl\|sh` **파이프 탐지 공격 PoC 실증**. §I **사고 3건**(postmark-mcp rug pull·CVE-2025-6514 CVSS 9.6·MCPoison) + **TPA**. §K **7기준 12채널 비교표**. `curl-publish.md` **대체** |
| [AI_Agent_Harness_Report.md](AI_Agent_Harness_Report.md) | |
| [curl-publish.md](curl-publish.md) | ⚠️ 출처 없는 LLM 설명 덤프. → [260818-agent-distribution-channels.md](260818-agent-distribution-channels.md) 가 1차 소스 기반으로 **대체** |
| [multi-agent-directory.md](multi-agent-directory.md) | |
| [workshop-solosquad-description.md](workshop-solosquad-description.md) | |
