# 2026-06-16 — 커스터마이즈 ↔ upstream 개선 reconciliation: 레퍼런스 패턴 조사

## TL;DR
- 생태계는 "기본 파일을 복사해 사용자가 편집"(cookiecutter/yeoman)에서 **"버전드 패키지 + shadow-override"**(Claude Code 플러그인, copier 3-way merge, oh-my-zsh custom/)로 수렴 중.
- Tier-1 레퍼런스 phuryn/pm-skills(12k★)조차 자체 copy-edit를 버리고 **Claude Code 플러그인 마켓플레이스**(`claude plugin marketplace add`)로 배포 — 합의 신호.
- SoloSquad의 현행 "SKILL.md를 워크스페이스로 복사→편집"은 ecosystem이 떠나는 모델. 런타임이 Claude Code이므로 **그 플러그인 precedence/마켓플레이스를 차용**하는 게 최저비용 경로.

## 신호

| 출처 | 신호 | 캡처 일시 |
|---|---|---|
| [Claude Code — Create plugins](https://code.claude.com/docs/en/plugins) (1차) | 플러그인 = 버전드 패키지(`plugin.json` `version`, 생략 시 commit SHA). "users only receive updates when you bump this field." standalone(`.claude/`, 개인·비갱신) vs plugin(버전·마켓·공유) 이분. **project/user `.claude/agents/`가 동명 plugin agent를 override** — 편집이 아니라 별도 파일 shadow. | 2026-06-16 |
| [Claude Code — Subagents 정밀도/Tembo·hidekazu](https://code.claude.com/docs/en/sub-agents) (1차+2차) | precedence: managed > `--agents` flag > project `.claude/agents/` > user `~/.claude/agents/` > plugin agents. 동명 시 상위 우선. settings도 동형 cascade(enterprise>cli>local>project>user). | 2026-06-16 |
| [copier — updating.md](https://github.com/copier-org/copier/blob/master/docs/updating.md) (1차) | `copier update` = 3-way merge: 저장된 `_commit`(template SHA) 기준으로 **옛 버전 재렌더 → 사용자 현재본과 diff 추출 → 새 template 적용 후 diff 재적용**. 충돌은 `--conflict inline`(git 마커) / `rej`(.rej). `.copier-answers.yml`이 메타데이터. 깨지면 `copier recopy`. | 2026-06-16 |
| [oh-my-zsh — Customization wiki](https://github.com/ohmyzsh/ohmyzsh/wiki/Customization) (1차) | `~/.oh-my-zsh/custom/`는 git-ignored → 업데이트가 **절대 안 덮음**. 단 custom 안의 community plugin은 각자 git repo라 **수동 `git pull`** — 보존은 자동, 콘텐츠 전파는 수동. | 2026-06-16 |
| [phuryn/pm-skills](https://github.com/phuryn/pm-skills) (1차) | 100+ PM 스킬/커맨드를 **Claude Code 플러그인 마켓플레이스로 배포**(`claude plugin marketplace add phuryn/pm-skills`). 자체 설치/복사 메커니즘 없이 런타임의 플러그인 시스템에 위임. auto-load + `/cmd` 듀얼 트리거. | 2026-06-16 |

## 3축 분석

### 하네스 엔지니어링 — 상
이 조사의 본질 축. 발견된 4가지 reconciliation 패턴:
1. **전용 custom 존(보존)** — oh-my-zsh `custom/`, Claude Code `.claude/`. 기본값을 편집하지 않고 별도 위치에 얹음. 업데이트가 침범 못 함. *보존엔 강하나 전파는 수동.*
2. **버전드 패키지 + shadow-override(보존+전파)** — Claude Code 플러그인. `plugin.json version`으로 갱신 경계 명시 + 마켓플레이스 auto-update + 동명 override. 기본값은 패키지로 교체되고, 사용자 override는 별도 파일이라 무손상.
3. **3-way template merge(전파 자동화)** — copier/cruft. "어느 버전에서 갈렸나"(`_commit`)를 박제했다가 old→new diff를 사용자 편집본에 패치. copy-edit 모델의 유일한 전파 해법.
4. **불투명 엔진 + 확장점** — React/Next. 프레임워크는 의존성으로 박제, 콘텐츠는 ship 안 함 → 문제 자체가 소거.

핵심 통찰: **편집(mutation)은 충돌을 낳고, 추가(overlay/shadow)는 안 낳는다.** 잘 설계된 도구는 사용자가 "파일을 편집"하게 두지 않고 "override를 추가"하게 한다.

### 멀티 에이전트 — 중
agent 정의의 배포·override가 multi-agent 커스터마이즈 표면. Claude Code의 precedence(project > user > plugin agent)는 "팀 공유 기본 에이전트 + 사용자 로컬 override"를 동명 shadow로 해결 — handoff/라우팅 자체는 아니지만, 에이전트 롤스터를 버전·계층으로 관리하는 모델이 SoloSquad의 4-main/20-specialist 배포에 직접 대응.

### 24/7 자동화 — 하
직접 축 아님. 약한 접점: 플러그인 마켓플레이스의 **auto-update cadence**(version bump → 자동 수신)는 "무인 유지보수"의 일종. SoloSquad가 자율 루프 중 스킬 갱신을 받아야 한다면 version-pinning이 인간 개입 없는 안전 갱신 경계를 줌. 그 외 cron/트리거와는 무관.

## SoloSquad 정합성

> 청자 = SoloSquad 개발자. 결론은 product 기능이 아니라 **배포/하네스 아키텍처**.

| 채택 가능성 | 충돌 지점 | 통합 비용 | 제안 액션 |
|---|---|---|---|
| **next-version** (overlay 실배선) | 문서가 광고한 `~/.solosquad/` user-global tier가 SKILL 해석 경로에 미배선(`paths.ts`는 워크스페이스 tier만) | 소 | `getAgentsDir/getSkillsDir` 등에 home-tier(`~/.solosquad/`) 조회 추가 → oh-my-zsh custom/ 동형 "절대 안 덮는 존" 완성 |
| **experimental** (3-way merge) | 현행 migrate는 `fs.existsSync` 가드로 "있으면 스킵" → 개선 전파 불가. copy-edit 모델의 구조적 한계 | 중~대 | 워크스페이스에 "어느 엔진 버전에서 seed됨" 매니페스트(copier `_commit`식) 박제 → `solosquad update`가 old→new diff를 사용자 SKILL에 패치(충돌 마커) |
| **experimental** (런타임 위임) | SoloSquad는 SKILL을 워크스페이스 파일로 ship. Claude Code 플러그인 모델과 이중 관리 | 중 | SoloSquad 기본 스킬/에이전트를 **Claude Code 플러그인으로 패키징**(`plugin.json` version + 마켓) → 사용자는 `.claude/`에서 shadow-override. 복사·재발명 제거, precedence를 런타임에 위임 |
| **not-applicable** (4번 불투명 엔진) | SoloSquad의 가치가 ship하는 콘텐츠(프롬프트/워크플로) 자체라 콘텐츠를 숨길 수 없음 | — | React식 "콘텐츠 미배포"는 부적합 — SoloSquad는 콘텐츠가 제품 |

**헤드라인 권고(dev):** SoloSquad 런타임이 Claude Code인 이상, customization↔upstream 문제를 **자체 재발명하지 말고** Claude Code 플러그인 시스템(버전드 패키지 + 마켓 + 동명 override precedence)에 정렬하는 게 최저비용·최고합의 경로. 단기로는 ② `~/.solosquad/` overlay 실배선(소비용·즉효), 중기로 ③ 기본 스킬의 플러그인화 또는 ① copier식 매니페스트 도입.

**베이스라인 대비 차분:** 2026-05-11/05-13 베이스라인은 각 레퍼런스를 "기능" 단위로 스냅샷했음. 본 레코드는 **횡단 축(배포/갱신 아키텍처)** 으로 재절단 — phuryn/pm-skills가 자체 메커니즘이 아니라 Claude Code 플러그인에 위임했다는 점이 베이스라인엔 없던 새 사실(생태계의 플러그인 표준화 수렴).

## Update 2026-06-16 — Tier-1 보강 (OpenClaw #2 / Hermes #3 / gstack #4)

초판이 Tier-1 셋(OpenClaw·Hermes·gstack)을 "이 축은 Claude Code/copier가 정면"이라 임의로 누락 → 스킬 anti-pattern(정합성 누락) 시정. 셋을 직접 조사하니 **각각 다른 입장**이라 4패턴 분류를 보강함.

| 출처 | 신호 | 캡처 일시 |
|---|---|---|
| [OpenClaw update guide](https://blink.new/blog/openclaw-update-upgrade-guide-2026) · [safe-upgrade](https://github.com/unicornnoway/openclaw-safe-upgrade) (2차+1차) | `openclaw update` = install 감지 → 다운로드 → **`openclaw doctor`가 config 마이그레이트** → gateway 재시작 → **health check → 실패 시 자동 rollback**(이전 config 자동 복원). `openclaw.json`에 `autoCheck/autoInstall`. | 2026-06-16 |
| [Hermes Agent docs](https://hermes-agent.nousresearch.com/docs/) · [hermes-agent.org](https://hermes-agent.org/) (1차) | 스킬은 **에이전트가 생성/패치**: 5+ tool call 후 agentskills.io 표준으로 skill doc 자동 작성, 기존 스킬과 모순 시 **사용 중 patch**. FTS5 + LLM 요약 메모리. 즉 "ship한 스킬을 사람이 편집"이 아니라 **로컬 생성·자기 큐레이션**. | 2026-06-16 |
| [garrytan/gstack](https://github.com/garrytan/gstack) (1차) | 설치 = `git clone … ~/.claude/skills/gstack && ./setup`. 35개 slash command가 git repo의 markdown. 갱신 = **`git pull`**, 커스텀 = markdown 편집 → pull 시 충돌(=포크 문제 그대로). 94k★인데도 reconciliation은 raw git. | 2026-06-16 |

**3축 델타:**
- **하네스 — 상:** 4패턴에 좌표 2개 추가. OpenClaw = **①·③의 변형 "health-gated migrate+auto-rollback"**(데이터 보존 자동화. 단 *config 마이그레이션*이지 *편집된 스킬에 upstream 개선 전파*는 아님 — reconciliation의 절반만). Hermes = **④(콘텐츠 미배포)의 능동형** — 스킬을 ship하지 않고 *로컬 생성*하니 upstream은 "생성기"만 갱신, 사용자 스킬은 안 건드림 → 문제 자체가 소거. gstack = **패턴 0(clean git clone/fork)** — 사용자가 앞서 직관한 "git=clone" 모델 그 자체. 94k★ 인기여도 reconciliation은 미해결.
- **멀티에이전트 — 중:** gstack·Hermes 둘 다 `~/.claude/skills/`에 거주(Claude Code 스킬 로딩 차용). 롤 기반 에이전트(gstack: CEO/Designer/Eng…)를 git repo로 배포 → SoloSquad의 4-main/20-specialist 배포 비교군.
- **24/7 — 중(↑):** OpenClaw의 **health-check 게이트 자동 rollback**이 무인 갱신의 안전 경계로서 직접 차용감. SoloSquad migrate는 backup + *수동* `--rollback`만 — health-gated 자동 복원은 없음.

**SoloSquad 정합성 추가:**
| 채택 가능성 | 충돌 지점 | 통합 비용 | 제안 액션 |
|---|---|---|---|
| **immediately** (OpenClaw식 health-gate) | 현 migrate는 backup 후 실패해도 자동 복원 안 함(수동 `--rollback`) | 소 | `migrate --apply` 후 `doctor` health check → 실패 시 직전 백업 자동 restore. 봇 graceful-drain(v1.2.8)과 결합 |
| **experimental** (Hermes식 생성형) | SoloSquad 스킬은 정적 ship. trajectory→skill 자동 생성은 큰 패러다임 변화 | 대 | 사용자 노하우를 "파일 편집"이 아니라 "에이전트가 trajectory에서 스킬 학습"으로 → 편집 충돌 자체 소거(장기 비전) |
| **not-applicable** (gstack clone-own) | 일반 사용자에 git pull 충돌 떠넘기는 모델 — SoloSquad가 의도적으로 피한 것 | — | 반례로 기록: 인기(94k★)가 reconciliation 해결을 뜻하지 않음. SoloSquad는 더 나은 길을 가야 함 |

**정정:** 초판 헤드라인("Claude Code 플러그인 정렬이 최저비용")은 유지되나, **OpenClaw의 health-gated auto-rollback은 그와 독립적으로 즉시 차용 가능**한 별개 이득(데이터 보존 축). 둘은 보완재 — 플러그인 정렬=전파, health-gate=보존.

## Open Questions
- [ ] Claude Code 플러그인의 skill/agent override가 SoloSquad의 3-tier(workspace/org/bundle) 의미론과 정확히 어떻게 합쳐지나? 이중 precedence 충돌 가능성.
- [ ] copier식 3-way merge를 마크다운 SKILL(코드 아닌 산문)에 적용 시 conflict 품질? 산문은 줄단위 diff가 거칠 수 있음.
- [ ] SoloSquad 스킬을 플러그인화하면 워크스페이스 `.solosquad/` 모델과 병존? 마이그레이션 경로?
- [ ] `~/.solosquad/` overlay 실배선의 회귀 위험(테스트가 home-tier를 가정하지 않음) 점검 필요.

## 출처
- Claude Code — Create plugins: https://code.claude.com/docs/en/plugins (1차)
- Claude Code — Create custom subagents: https://code.claude.com/docs/en/sub-agents (1차)
- copier — updating.md: https://github.com/copier-org/copier/blob/master/docs/updating.md (1차)
- copier — Updating a project (docs): https://copier.readthedocs.io/en/stable/updating/ (1차)
- oh-my-zsh — Customization wiki: https://github.com/ohmyzsh/ohmyzsh/wiki/Customization (1차)
- phuryn/pm-skills: https://github.com/phuryn/pm-skills (1차)
- (2차 교차) Tembo — Claude Code Subagents Guide: https://www.tembo.io/blog/claude-code-subagents
- (2차 교차) hidekazu-konishi — Claude Code Features & Settings Reference 2026: https://hidekazu-konishi.com/entry/claude_code_features_settings_reference_2026.html
- (Update) OpenClaw Update/Upgrade Guide 2026: https://blink.new/blog/openclaw-update-upgrade-guide-2026
- (Update) unicornnoway/openclaw-safe-upgrade: https://github.com/unicornnoway/openclaw-safe-upgrade (1차)
- (Update) Hermes Agent Documentation (Nous Research): https://hermes-agent.nousresearch.com/docs/ (1차)
- (Update) garrytan/gstack: https://github.com/garrytan/gstack (1차)
