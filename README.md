# Solo Founder Agents

> 1인 창업자를 위한 24/7 AI 비서 시스템. Claude Code를 활용해 제품별 맞춤 에이전트를 운영한다.

---

## 전제 조건

| 항목 | 필수 여부 |
|------|-----------|
| [Claude Code Max 플랜](https://claude.ai) | 필수 |
| Docker Desktop | 필수 |
| Python 3.10+ | 필수 |
| Discord Bot Token | 필수 |
| GitHub PAT | 선택 (레포 자동 생성) |

---

## 설치 (3단계)

### 1. 클론
```bash
git clone <이 레포 URL>
cd <레포 디렉토리>
```

### 2. .env 작성
```bash
cp .env.example .env
# .env 파일 열어서 값 채우기
```

### 3. 설치 실행
```bash
python setup.py
```

설치 마법사가 다음을 처리한다:
- 오너 프로필 설정 → `core/OWNER.md` 자동 반영
- 제품/조직 등록 (여러 개 가능)
- 제품별 디렉토리 + CLAUDE.md + 메모리 자동 생성
- Docker 빌드 및 실행

---

## 핵심 개념: 제품별 격리

제품을 여러 개 등록하면, 각각 독립된 공간이 생긴다.

```
~/repos/
├── product-a/           ← 제품 A의 전용 공간
│   ├── CLAUDE.md        ← 자동 생성 (제품 A 전용 컨텍스트)
│   ├── product/         ← 브리프, 주간 상태
│   ├── memory/          ← 가설, 실험, 결정, 시그널
│   │   └── routine-logs/ ← 루틴 실행 로그
│   └── projects/        ← 프로젝트별 격리
│       └── pmf-validation/
│           ├── CLAUDE.md
│           └── ...
├── product-b/           ← 제품 B의 전용 공간
│   └── ...
└── product-c/
    └── ...
```

각 제품의 AI 에이전트는 **해당 제품의 컨텍스트만** 볼 수 있다. 다른 제품의 정보는 차단된다.

---

## 사용법

### Discord에서 명령하기
봇을 초대한 서버의 `#owner-command` 채널에 메시지를 보내면, 키워드를 분석해 적절한 에이전트가 자동 라우팅된다.

```
너: 랜딩페이지 카피 초안 써줘
봇: [제품명 (content-writer)] ...
```

60+ 키워드 → 23개 에이전트 자동 매칭. 키워드 미매칭 시 일반 모드로 응답.

### 새 프로젝트 생성
```bash
python cli/new_project.py
```
인터랙티브 UI로 제품 선택 → 프로젝트 타입 → 에이전트 선택 → 디렉토리 자동 생성.

### 전체 현황 확인
```bash
python cli/status.py
```

### 수동 루틴 실행
```bash
python cli/run_routine.py                    # 인터랙티브 선택
python cli/run_routine.py signal-scan        # 특정 루틴 직접 실행
python cli/run_routine.py -p my-product      # 특정 제품만
python cli/run_routine.py --all              # 전체 루틴 순차 실행
```

### 프로젝트 디렉토리에서 직접 작업
```bash
cd ~/repos/my-product/projects/pmf-validation
claude
# CLAUDE.md가 자동 로딩되어 컨텍스트 격리된 상태로 시작
```

---

## 자동 루틴 스케줄

| 시간 | 루틴 | 보고 채널 | 메모리 저장 |
|------|------|-----------|-------------|
| 06:00 매일 | Morning Brief | `#daily-brief` | - |
| 12:00 매일 | Signal Scan | `#signals` | `signals.jsonl` |
| 16:00 매일 | Experiment Check | `#experiments` | `experiments.jsonl` |
| 22:00 매일 | Daily Log | `#daily-brief` | `decisions.jsonl` |
| 일 20:00 | Weekly Review | `#weekly-review` | `decisions.jsonl` |

- 루틴 결과에서 ```` ```json ``` ```` 블록을 자동 추출해 JSONL 메모리에 append
- 모든 루틴 로그는 `memory/routine-logs/`에 항상 파일 저장
- 타임존은 `docker-compose.yml`의 `TZ` 환경변수로 변경 가능

---

## 3-Layer 컨텍스트 아키텍처

```
Layer 0: Universal (core/)        → 모든 세션에 공유 (오너 프로필, 원칙, 스타일)
Layer 1: Product (~/repos/{slug}/) → 제품별 격리 (브리프, 메모리)
Layer 2: Project (projects/{id}/)  → 프로젝트별 격리 (에이전트, 실험)
```

---

## 구조

```
(이 레포)
├── setup.py               ← 설치 마법사
├── docker-compose.yml     ← 크로스플랫폼 실행
├── core/
│   ├── OWNER.md           ← 오너 프로필 (setup.py가 자동 설정)
│   ├── PRINCIPLES.md      ← 의사결정 원칙
│   ├── VOICE.md           ← 글쓰기 스타일
│   └── products.json      ← setup.py가 자동 생성
├── routines/              ← 루틴 프롬프트 (수정 가능)
├── src/
│   ├── bot.py             ← Discord 봇 + 에이전트 라우팅
│   └── scheduler.py       ← 24시간 루틴 실행 + 메모리 자동 저장
├── cli/
│   ├── new_project.py     ← 프로젝트 생성
│   ├── status.py          ← 현황 대시보드
│   └── run_routine.py     ← 수동 루틴 실행
├── orchestrator/          ← 프로젝트 워크플로우 조율
├── agents/                ← 23개 전문 에이전트
│   ├── _teams/            ← 팀별 공유 지식
│   ├── strategy/          ← 전략팀 (7 agents)
│   ├── growth/            ← 그로스팀 (4 agents)
│   ├── experience/        ← 경험팀 (4 agents)
│   └── engineering/       ← 엔지니어링팀 (8 agents)
└── templates/             ← PRD, 핸드오프, 상태 템플릿
```

---

## 팀 기반 에이전트 (23개)

| 팀 | 에이전트 | 역할 |
|----|---------|------|
| **Strategy** | PMF Planner, Feature Planner, Policy Architect, Data Analyst, Business Strategist, Idea Refiner, Scope Estimator | 전략, 기획, 분석 |
| **Growth** | GTM Strategist, Content Writer, Brand Marketer, Paid Marketer | 마케팅, 브랜딩 |
| **Experience** | User Researcher, Desk Researcher, UX Designer, UI Designer | 리서치, 디자인 |
| **Engineering** | Creative Frontend, FDE, Architect, Backend Developer, API Developer, Data Collector, Data Engineer, Cloud Admin | 개발, 인프라 |

---

## 시스템 관리

```bash
# 재시작
docker compose restart

# 로그 확인
docker compose logs -f

# 중지
docker compose down

# 업데이트 후 재빌드
git pull && docker compose build && docker compose up -d
```

---

## 루틴 커스터마이징

`routines/` 폴더의 `.md` 파일을 수정하면 된다. 재빌드 불필요.

```bash
# 예: Morning Brief 프롬프트 수정
vim routines/morning-brief.md
docker compose restart scheduler
```

---

## FAQ

**Q: Claude Code 인증은?**
A: Claude Code Max 플랜 구독 후, Docker 컨테이너 내부에서 한 번만 로그인.
`docker compose exec bot claude login`

**Q: 제품을 나중에 추가하려면?**
A: `python setup.py` 재실행. 기존 설정 유지하고 제품만 추가.

**Q: 루틴 시간대가 다르면?**
A: `docker-compose.yml`의 `TZ` 환경변수 수정.

**Q: Windows에서 경로 구분자?**
A: `REPOS_BASE_PATH`에 `/` 슬래시 사용. Docker가 변환해준다.

**Q: 에이전트 라우팅이 잘못되면?**
A: `src/bot.py`의 `AGENT_ROUTES` 딕셔너리에서 키워드-에이전트 매핑을 수정.

---

## Contributing

자세한 내용은 [CONTRIBUTING.md](CONTRIBUTING.md) 참조.

## License

MIT License
