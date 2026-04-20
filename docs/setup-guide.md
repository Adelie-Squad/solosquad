# SoloSquad 설치 가이드

> 개발 경험이 없어도 따라할 수 있는 설치 안내서

---

## 이 시스템이 뭔가요?

혼자서 제품을 만드는 1인 창업자를 위한 **AI 비서 시스템**입니다.

스타트업에는 전략팀, 마케팅팀, 디자인팀, 개발팀이 필요합니다. 하지만 1인 창업자에게는 이 모든 역할을 혼자 해야 하는 현실이 있습니다. 이 시스템은 **AI가 그 팀원들을 대신**합니다. 설치 한 번이면 24시간 쉬지 않는 AI 팀이 당신 옆에서 함께 일합니다.

---

## 왜 이 시스템인가?

### 1. 25명의 전문 AI 팀원이 생긴다

혼자 일하지만 혼자가 아닙니다. 이 시스템에는 4개 팀, 25명의 AI 전문가가 내장되어 있습니다.

| 팀 | 하는 일 | 소속 에이전트 |
|----|--------|-------------|
| **전략팀** | 시장 분석, 사업 기획, 가설 수립, 일정 산정 | PMF Planner, Feature Planner, Data Analyst, Business Strategist, Idea Refiner, Scope Estimator, Policy Architect |
| **그로스팀** | 마케팅 전략, 콘텐츠 작성, 브랜딩, 광고 | GTM Strategist, Content Writer, Brand Marketer, Paid Marketer |
| **경험팀** | 유저 리서치, 시장 조사, UX/UI 설계 | User Researcher, Desk Researcher, UX Designer, UI Designer |
| **엔지니어링팀** | 프론트/백엔드 개발, API, 데이터, 인프라, 품질, 보안 | Creative Frontend, FDE, Architect, Backend Developer, API Developer, Data Collector, Data Engineer, Cloud Admin, QA Engineer, Security Engineer |

메신저에 "랜딩페이지 카피 써줘"라고 보내면 Content Writer가, "경쟁사 분석해줘"라고 보내면 Desk Researcher가 자동으로 배정됩니다. 누구를 부를지 고민할 필요 없이 **그냥 하고 싶은 말을 하면** 알아서 적절한 전문가가 답합니다.

### 2. 24시간 자동으로 일한다

잠든 사이에도, 다른 일을 하는 동안에도, AI가 알아서 일합니다.

| 시간 | AI가 하는 일 | 왜 필요한지 |
|------|------------|-----------|
| **아침 6시** | 오늘의 브리핑 | 일어나면 바로 오늘 뭘 해야 할지 정리되어 있음 |
| **낮 12시** | 시장 시그널 탐지 | 경쟁사 변화, 고객 트렌드, 기술 변화를 놓치지 않음 |
| **오후 4시** | 실험 상태 점검 | 진행 중인 실험이 잘 되고 있는지 자동 체크 |
| **밤 10시** | 하루 기록 | 오늘 뭘 했고 내일 뭘 이어갈지 자동 정리 |
| **일요일 저녁** | 주간 회고 | 한 주를 돌아보고 다음 주 계획 자동 제안 |

이 결과는 모두 **메신저 채널에 자동 보고**됩니다. 아침에 일어나서 메신저만 열면 오늘 할 일이 정리되어 있습니다.

### 3. 내가 한 모든 결정과 실험이 쌓인다

대부분의 AI 도구는 대화가 끝나면 맥락이 사라집니다. 이 시스템은 다릅니다.

- **가설 관리**: 어떤 가설을 세웠고, 지금 어떤 상태인지 추적
- **실험 기록**: 어떤 실험을 했고, 결과가 어땠는지 자동 기록
- **의사결정 로그**: 언제, 왜 그런 결정을 했는지 근거와 함께 저장
- **시그널 아카이브**: 시장에서 포착한 변화들을 날짜별로 축적

이 기록들은 시간이 지날수록 가치가 올라갑니다. AI가 과거 데이터를 참고해서 더 정확한 분석과 제안을 하게 됩니다.

### 4. 제품이 여러 개여도 섞이지 않는다

1인 창업자는 동시에 여러 제품을 시도하는 경우가 많습니다. 이 시스템은 **3단계 격리 구조**로 제품 간 맥락이 절대 섞이지 않습니다.

```
[공통 레이어]  오너의 일하는 방식, 의사결정 원칙, 글쓰기 스타일
     ↓
[제품 레이어]  제품별 브리프, 타깃 고객, 가설, 실험 기록
     ↓
[프로젝트 레이어]  프로젝트별 목표, 에이전트 배정, 진행 상태
```

설치 시 제품을 여러 개 등록하기만 하면, 각각 자동으로 전용 폴더 + 전용 메모리 + 전용 메신저 채널이 만들어집니다.

### 5. npm 한 줄이면 끝이다

복잡한 설정이 필요 없습니다. 설치 마법사가 질문을 하고, 당신은 답만 하면 됩니다.

```bash
npm install -g solosquad
solosquad init
```

이것만 입력하면 **에이전트 복사, 제품 폴더 생성, AI 메모리 초기화, 메신저 설정**까지 전부 자동입니다.

업데이트도 한 줄:
```bash
solosquad update
```

### 6. 검증 중심 철학이 내장되어 있다

이 시스템의 AI들은 단순히 "시키는 대로" 하지 않습니다. 1인 창업자가 가장 빠지기 쉬운 함정 — **검증 없이 만드는 것** — 을 막아주는 원칙이 내장되어 있습니다.

- **검증 우선**: "만들어야 할까?"를 "어떻게 만들까?"보다 먼저 질문
- **단일 포커스**: 이번 주에 검증할 가장 위험한 가설 하나에만 집중
- **72시간 단위**: 모든 실험을 72시간 안에 결과를 볼 수 있는 크기로 분해
- **감정 가중치**: 의사결정에 감정이 얼마나 개입됐는지 기록해서, 나중에 재검토

---

## 설치 전 준비물

총 3가지가 필요합니다. 하나씩 안내합니다.

### 준비물 1: Claude Code Max 구독

AI를 실행하는 엔진입니다. 월 구독 서비스입니다.

1. https://claude.ai 접속
2. 로그인 (없으면 회원가입)
3. 좌측 메뉴 또는 설정에서 **Claude Code** 항목 찾기
4. **Max 플랜** 구독

### 준비물 2: Node.js 18 이상 + Git

이 시스템의 런타임입니다. **사용하는 OS에 맞게** 설치하세요.

#### macOS
```bash
brew install node git
npm install -g @anthropic-ai/claude-code
```

#### Windows
```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
npm install -g @anthropic-ai/claude-code

# 권장: 더 나은 터미널 환경
winget install Microsoft.WindowsTerminal
winget install Microsoft.PowerShell
```

#### Linux (Ubuntu/Debian)
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
npm install -g @anthropic-ai/claude-code

# npm 글로벌 설치 시 sudo 없이 쓰려면
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```

설치 후 확인:
```bash
node --version   # v18 이상이면 성공
git --version    # 버전이 나오면 성공
```

> Docker는 **선택 사항**입니다. 격리 실행 등 일부 기능에 필요하지만, 핵심 기능은 Docker 없이 동작합니다.

### 준비물 3: 메신저 봇 토큰

AI가 메신저에서 메시지를 주고받으려면 "봇 계정"이 필요합니다. 원하는 플랫폼을 선택하세요.

#### Discord 봇 만들기

1. https://discord.com/developers/applications 접속 (Discord 로그인 필요)
2. 우측 상단 **New Application** 클릭
3. 이름 입력 (예: "내 AI 비서") → **Create**
4. 왼쪽 메뉴에서 **Bot** 클릭
5. **Reset Token** 클릭 → **Yes, do it!**
6. 나타난 토큰을 **복사해서 메모장에 저장** (한 번만 보여줌!)

같은 페이지에서 추가 설정:
- **Bot** 페이지 아래로 스크롤
- **Privileged Gateway Intents** 섹션에서 3개 모두 켜기:
  - Presence Intent → ON
  - Server Members Intent → ON
  - Message Content Intent → ON
- **Save Changes** 클릭

#### Slack 봇 만들기

1. https://api.slack.com/apps 접속
2. **Create New App** → **From scratch**
3. **OAuth & Permissions** → Bot Token Scopes 추가:
   - `channels:read`, `channels:manage`, `chat:write`, `groups:read`
4. **Install to Workspace** → Bot Token (xoxb-...) 복사
5. **Socket Mode** → Enable → App-Level Token (xapp-...) 생성 및 복사

#### Telegram 봇 만들기

1. Telegram에서 @BotFather에게 메시지
2. `/newbot` → 안내에 따라 봇 생성 → 토큰 복사
3. @userinfobot 에서 Chat ID 확인

---

## 설치 (약 5분)

### Step 1: npm으로 설치

터미널을 엽니다.

- **Mac**: Spotlight(Cmd+Space)에서 "터미널" 검색
- **Windows**: 시작 메뉴에서 "Windows Terminal" 또는 "PowerShell" 검색
- **Linux**: Ctrl+Alt+T 또는 앱 메뉴에서 터미널 검색

```bash
npm install -g solosquad
```

### Step 2: 작업 공간 생성 및 초기화

```bash
mkdir my-ai-team
cd my-ai-team
solosquad init
```

설치 마법사가 시작되면, 화면의 질문에 답하면 됩니다:

```
── Step 1: 환경 확인 ──
Platform: darwin arm64 (24.4.0)
Shell: /bin/zsh

✓ Node.js >= 18
△ Docker (optional) — needed for isolated execution
✓ git
✓ Claude Code CLI

── Step 2: 작업 공간 초기화 ──
✓ agents/
✓ routines/
✓ core/
✓ templates/

── Step 3: 설정 ──
이름: (본인 이름 입력)
역할: (예: 기획자, 디자이너, 개발자)
메신저 플랫폼: (Discord / Slack / Telegram / Discord+Slack 선택)
봇 토큰: (아까 복사해둔 토큰 붙여넣기)
프로젝트 저장 경로: (그냥 Enter 치면 OS별 기본값 사용)
  macOS/Linux: ~/repos
  Windows: ~/Documents/solosquad-repos

── Step 4: 제품 등록 ──
제품 이름: (관리할 제품 이름, 예: 내쇼핑몰)
더 추가할까요?: (여러 개면 y, 아니면 n)
```

### Step 3: 환경 확인

```bash
solosquad doctor
```

모든 항목이 ✓이면 준비 완료입니다.

### Step 4: Claude Code 로그인 (마지막!)

터미널에서:
```bash
claude login
```

화면의 안내를 따라 Claude 계정으로 로그인하면 끝입니다.

---

## 설치 확인

### 봇 테스트

```bash
solosquad bot
```

메신저에서 `#owner-command` 채널(Discord/Slack) 또는 봇에게 직접(Telegram) 메시지를 보내보세요. AI가 답하면 성공!

### 대시보드 확인

```bash
solosquad status
```

등록한 제품과 프로젝트 현황이 표시됩니다.

---

## 보안 안내

이 시스템은 AI가 코드를 실행합니다. 다음 사항을 꼭 확인하세요:

1. `.env` 파일이 `.gitignore`에 포함되어 있는지 확인
2. 봇 토큰은 주기적으로 교체 (90일 권장)
3. AI 출력을 프로덕션에 배포하기 전 반드시 검토
4. 메신저 봇 권한은 최소한으로 설정
5. `solosquad doctor`를 주기적으로 실행하여 환경 점검

---

## 일상적인 사용법

### 메신저에서 AI에게 일 시키기

`#owner-command` 채널에 자연어로 메시지를 보내면 됩니다.

```
랜딩페이지 카피 초안 써줘
→ AI가 content-writer 역할로 응답

우리 경쟁사 분석해줘
→ AI가 desk-researcher 역할로 응답

이번 주 실험 결과 정리해줘
→ AI가 data-analyst 역할로 응답
```

메시지 내용에 따라 25개 전문 에이전트 중 적절한 역할이 자동으로 선택됩니다.

### 자동 루틴 (손 안 대도 됨)

매일 자동으로 실행됩니다:

| 시간 | 무엇을 하는지 | 어디에 보고 |
|------|-------------|------------|
| 아침 6시 | 오늘 할 일 정리 | #daily-brief |
| 낮 12시 | 경쟁사/시장 변화 탐지 | #signals |
| 오후 4시 | 실험 진행 상태 점검 | #experiments |
| 밤 10시 | 오늘 한 일 기록 | #daily-brief |
| 일요일 저녁 8시 | 한 주 돌아보기 | #weekly-review |

스케줄러 시작:
```bash
solosquad schedule
```

### 수동으로 루틴 실행하기

자동 시간까지 기다리지 않고 바로 실행하고 싶을 때:
```bash
solosquad run-routine
```

### 전체 현황 보기

```bash
solosquad status
```

---

## 업데이트

새 버전이 나왔는지 확인하고 업데이트:

```bash
solosquad update
```

자동으로 npm에서 최신 버전을 확인하고, 업데이트 여부를 물어봅니다.

---

## 제품을 여러 개 운영할 때

설치 시 제품을 여러 개 등록하면, 각각 완전히 분리된 AI 공간이 만들어집니다.

```
예시:
- 제품 A: 쇼핑몰 → AI가 쇼핑몰 맥락만 보고 일함
- 제품 B: SaaS → AI가 SaaS 맥락만 보고 일함
```

제품 A의 AI는 제품 B의 정보를 절대 보지 못합니다.

나중에 제품을 추가하려면 `solosquad init`을 다시 실행하면 됩니다.

---

## 자주 묻는 질문

**Q: 비용이 얼마나 드나요?**
A: Claude Code Max 구독료만 있으면 됩니다. 나머지는 무료입니다.

**Q: 컴퓨터를 꺼도 돌아가나요?**
A: Docker로 배포하면 백그라운드에서 계속 돌아갑니다. 직접 실행하는 경우 터미널을 닫으면 멈춥니다.

**Q: 시간대가 한국이 아니면?**
A: 스케줄러의 timezone 설정을 변경하면 됩니다.

**Q: AI가 틀린 답을 하면?**
A: AI는 도구입니다. 중요한 결정은 반드시 본인이 직접 확인하세요.

**Q: Discord와 Slack을 동시에 쓸 수 있나요?**
A: 네. `.env`에서 `MESSENGER=discord,slack`으로 설정하면 두 플랫폼 모두에서 봇이 동작합니다.

---

## 문제가 생겼을 때

### "solosquad를 찾을 수 없습니다"
→ `npm install -g solosquad`로 설치했는지 확인하세요.
→ Node.js 18 이상이 설치되어 있는지 확인: `node --version`
→ Linux에서 npm 글로벌 경로 문제라면 위의 `~/.npm-global` 설정을 확인하세요.

### "claude를 찾을 수 없습니다"
→ Claude Code CLI가 설치되어 있는지 확인하세요.
→ `solosquad doctor`로 환경을 진단하세요.

### 메신저에서 봇이 응답하지 않음
→ `solosquad doctor`로 토큰이 올바른지 확인
→ 봇이 서버/워크스페이스에 초대되었는지 확인
→ `#owner-command` 채널에서 메시지를 보냈는지 확인

### 루틴이 실행되지 않음
→ `solosquad schedule`이 실행 중인지 확인
→ `solosquad run-routine signal-scan`으로 수동 테스트
