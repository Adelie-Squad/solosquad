# SoloSquad 설치 가이드

> 개발 경험이 없어도 따라할 수 있는 설치 안내서

---

## 목차

1. [이 시스템이 뭔가요?](#1-이-시스템이-뭔가요)
2. [왜 이 시스템인가?](#2-왜-이-시스템인가)
3. [준비물](#3-준비물)
4. [메신저 봇 설정 (상세)](#4-메신저-봇-설정-상세) — Slack / Discord / Telegram
5. [설치 & 초기화](#5-설치--초기화)
6. [24/7 운영 방식 선택](#6-247-운영-방식-선택) — 로컬 데스크탑 vs 클라우드
7. [설치 확인 & 일상 사용](#7-설치-확인--일상-사용)
8. [업데이트](#8-업데이트)
9. [제품 여러 개 운영](#9-제품-여러-개-운영)
10. [보안](#10-보안)
11. [문제 해결](#11-문제-해결)

---

## 1. 이 시스템이 뭔가요?

혼자서 제품을 만드는 1인 창업자를 위한 **AI 비서 시스템**입니다.

스타트업에는 전략팀·마케팅팀·디자인팀·개발팀이 필요합니다. 1인 창업자에게는 이 모든 역할을 혼자 해야 하는 현실이 있습니다. 이 시스템은 **AI가 그 팀원들을 대신**합니다. 설치 한 번이면 24시간 쉬지 않는 AI 팀이 메신저로 항상 연결되어 있습니다.

---

## 2. 왜 이 시스템인가?

### 1) 25명의 전문 AI 팀원이 생긴다

혼자 일하지만 혼자가 아닙니다. 4개 팀, 25명의 AI 전문가가 내장되어 있습니다.

| 팀 | 하는 일 | 소속 에이전트 |
|----|--------|-------------|
| **전략팀** | 시장 분석, 사업 기획, 가설 수립, 일정 산정 | PMF Planner, Feature Planner, Data Analyst, Business Strategist, Idea Refiner, Scope Estimator, Policy Architect |
| **그로스팀** | 마케팅 전략, 콘텐츠 작성, 브랜딩, 광고 | GTM Strategist, Content Writer, Brand Marketer, Paid Marketer |
| **경험팀** | 유저 리서치, 시장 조사, UX/UI 설계 | User Researcher, Desk Researcher, UX Designer, UI Designer |
| **엔지니어링팀** | 프론트/백엔드 개발, API, 데이터, 인프라, 품질, 보안 | Creative Frontend, FDE, Architect, Backend Developer, API Developer, Data Collector, Data Engineer, Cloud Admin, QA Engineer, Security Engineer |

메신저에 "랜딩페이지 카피 써줘"라고 보내면 Content Writer가, "경쟁사 분석해줘"라고 보내면 Desk Researcher가 자동으로 배정됩니다.

### 2) 24시간 자동으로 일한다

잠든 사이에도, 다른 일을 하는 동안에도 AI가 알아서 일합니다.

| 시간 | AI가 하는 일 |
|------|------------|
| 아침 6시 | 오늘의 브리핑 |
| 낮 12시 | 시장 시그널 탐지 |
| 오후 4시 | 실험 상태 점검 |
| 밤 10시 | 하루 기록 |
| 일요일 저녁 | 주간 회고 |

결과는 모두 메신저 채널로 자동 보고됩니다.

### 3) 제품이 여러 개여도 섞이지 않는다

3단계 격리 구조로 제품 간 맥락이 절대 섞이지 않습니다.

```
[공통 레이어]    오너 프로필, 원칙, 글쓰기 스타일 (모든 세션에서 공유)
     ↓
[제품 레이어]    제품별 브리프, 메모리, 시그널 (제품별 격리)
     ↓
[프로젝트 레이어] 프로젝트별 목표, 에이전트 배정, 상태 (프로젝트별 격리)
```

### 4) npm 한 줄로 시작

```bash
npm install -g solosquad
solosquad init
```

에이전트 복사, 제품 폴더 생성, AI 메모리 초기화, 메신저 설정까지 전부 자동.

---

## 3. 준비물

다음 3가지가 필요합니다.

### 3.1 Claude Code Max 구독

AI를 실행하는 엔진. 월 구독.

1. https://claude.ai 접속 → 로그인
2. 좌측 메뉴 또는 설정 → **Claude Code** → **Max 플랜** 구독

### 3.2 Node.js 18+ & Git

사용하는 OS에 맞게 설치.

**macOS (Mac Mini 포함)**
```bash
brew install node git
npm install -g @anthropic-ai/claude-code
```

**Windows**
```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
npm install -g @anthropic-ai/claude-code
# 권장
winget install Microsoft.WindowsTerminal
winget install Microsoft.PowerShell
```

**Linux (Ubuntu/Debian)**
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
npm install -g @anthropic-ai/claude-code
```

설치 확인:
```bash
node --version   # v18 이상
git --version
claude --version
```

> Docker는 로컬 24/7 운영을 쉽게 만들어주는 **선택 도구**입니다. 핵심 기능은 Docker 없이도 동작합니다. 6장 참고.

### 3.3 메신저 봇 계정

다음 4장에서 플랫폼별로 상세히 안내합니다. 원하는 메신저 중 하나(또는 여러 개)를 준비하세요.

---

## 4. 메신저 봇 설정 (상세)

AI가 메신저에서 메시지를 주고받으려면 **봇 계정**이 필요합니다. SoloSquad는 Slack·Discord·Telegram 세 플랫폼을 지원하며, 각각 설정 절차가 다릅니다. 본 섹션은 각 플랫폼별로 **실수 없이** 설정할 수 있도록 모든 단계를 구체적으로 설명합니다.

세 가지를 모두 쓸 필요는 없습니다. 아래 선택 기준을 참고하세요.

| 플랫폼 | 추천 대상 | 장점 | 단점 |
|---|---|---|---|
| **Slack** | 워크스페이스 중심 협업, 조용한 UI 선호 | 채널 구조가 깔끔, 검색 강력 | 설정 단계 가장 많음 (Socket Mode·Event Subscriptions·Reinstall) |
| **Discord** | 혼자 쓰되 UI가 친근한 걸 원할 때 | 봇이 채널을 자동 생성, 설정 단순 | 서버 이름에 제품 slug가 포함되어야 자동 매핑됨 |
| **Telegram** | 모바일 중심, 가장 가볍게 | 설정 최단, 언제 어디서나 알림 | 채널 자동 생성 없음, chat_id 수동 확보 필요 |

---

### 4.1 Slack 봇 설정

> **최종 결과물:** `.env`에 `SLACK_BOT_TOKEN=xoxb-...`와 `SLACK_APP_TOKEN=xapp-...`가 저장되고, Slack 워크스페이스의 `#owner-command` 채널에서 봇이 메시지에 응답.

Slack은 설정 단계가 가장 많아 순서를 놓치면 "봇은 떠 있는데 응답이 없다"는 상황이 자주 생깁니다. **아래 순서 그대로** 따라하는 것을 권장.

#### Step 1 — Slack 앱 생성

1. https://api.slack.com/apps 접속 (본인 Slack 계정 로그인 필요)
2. 우측 상단 **Create New App** → **From scratch** 선택
3. **App Name** 입력 (예: `My AI Team`) + 배포할 워크스페이스 선택 → **Create App**

#### Step 2 — OAuth & Permissions (봇 권한 부여)

좌측 메뉴 **Features → OAuth & Permissions**로 이동.

**Scopes** 섹션까지 스크롤 → **Bot Token Scopes** 블록에서 **Add an OAuth Scope** 클릭하여 다음 6개를 추가:

| Scope | 왜 필요한가 |
|---|---|
| `channels:read` | 봇이 어떤 채널에 있는지 조회 (명령 채널 감지용) |
| `channels:history` | 공개 채널의 메시지를 읽기 (사용자 명령 수신) |
| `chat:write` | 봇이 메시지를 보낼 수 있음 (응답) |
| `app_mentions:read` | `@봇이름`으로 호출된 경우 감지 |
| `groups:read` | 비공개 채널에서도 동작시키려면 필요 |
| `channels:manage` | 루틴이 자동 채널 생성/변경 시 필요 |

> **주의:** `xoxp-` (User Token)가 아니라 `Bot Token Scopes` 블록에 추가해야 합니다. 헷갈리기 쉬우니 섹션 제목 재확인.

#### Step 3 — 워크스페이스에 설치 (1차)

같은 페이지 상단 **OAuth Tokens for Your Workspace** → **Install to Workspace** 클릭.

권한 동의 화면에서 **Allow** → 리디렉션 후 **Bot User OAuth Token** (`xoxb-...`)이 표시됨 → **복사해서 메모장에 저장**.

이 값이 `.env`의 `SLACK_BOT_TOKEN`입니다.

#### Step 4 — Socket Mode 활성화

좌측 메뉴 **Settings → Socket Mode**로 이동.

1. **Enable Socket Mode** 토글 ON
2. 팝업이 뜨며 **App-Level Token** 생성을 요구함
   - Token Name: 아무거나 (예: `socket-token`)
   - Scope: `connections:write` 추가 (필수)
   - **Generate** 클릭
3. 생성된 토큰 (`xapp-1-...`) **즉시 복사해서 메모장에 저장** (이 페이지를 벗어나면 다시 볼 수 없음)

이 값이 `.env`의 `SLACK_APP_TOKEN`입니다.

> **자주 하는 실수:** App Token에 Signing Secret을 넣음. 서로 다릅니다. App Token은 `xapp-`로 시작.

#### Step 5 — Event Subscriptions

좌측 **Features → Event Subscriptions**로 이동.

1. **Enable Events** 토글 ON
2. **Subscribe to bot events** 섹션 확장 → **Add Bot User Event** 클릭 → 다음 추가:
   - `message.channels` — 공개 채널 메시지 수신
   - `message.groups` — 비공개 채널 메시지 수신 (#owner-command가 🔒 private인 경우 필수)
   - `app_mention` — `@봇` 호출 감지
3. 하단 **Save Changes**

> **자주 하는 실수:** 이 단계를 건너뛰면 봇은 정상 기동하지만 **메시지가 전혀 전달되지 않음**. "안녕"을 보내도 터미널에 아무 로그가 뜨지 않으면 이 단계 재확인.

#### Step 6 — 워크스페이스에 재설치 (필수)

Scope나 Event 변경 시에는 **반드시 재설치**가 필요합니다.

1. 페이지 상단에 노란색 배너 **"You've changed permission scopes... please reinstall"**이 표시됨 → **reinstall your app** 링크 클릭
2. 또는 좌측 **Settings → Install App → Reinstall to Workspace**
3. Bot Token이 새로 발급될 수 있음 — 새 값이 나오면 메모장 갱신 + `.env`도 갱신

#### Step 7 — `#owner-command` 채널 준비

Slack 워크스페이스에서:

1. 좌측 채널 목록 하단 **+ 추가** → **채널 생성**
2. 채널명: `owner-command` (정확히 이 이름; `.env`의 `SLACK_COMMAND_CHANNEL`로 커스텀 가능)
3. 공개/비공개 선택 (비공개라면 Step 5에서 `message.groups` 구독 필수)
4. 채널로 이동 → 상단 채널명 클릭 → **Integrations 탭** → **Add apps** → 본인 봇 선택 → **Add**
5. (대안) 채널 내에서 `/invite @봇이름` 입력

#### Step 8 — 토큰을 `.env`로 옮기기

`solosquad init` 실행 중에 입력하거나, 이미 init을 끝냈다면 워크스페이스의 `.env` 편집:

```env
MESSENGER=slack
SLACK_BOT_TOKEN=xoxb-1234567890-...
SLACK_APP_TOKEN=xapp-1-...
SLACK_COMMAND_CHANNEL=owner-command
```

#### Step 9 — 동작 검증

```bash
solosquad doctor --messenger-check
```
`Slack auth.test → <봇사용자명>`이 ✓로 뜨면 토큰/권한은 유효.

```bash
solosquad bot
```
→ `[Slack Bot] Starting Socket Mode...` 로그 후 에러/경고 없이 조용하면 정상.

Slack에서 `#owner-command`에 "안녕" 전송 → 봇이 응답하면 성공.

#### Slack 설정 체크리스트 (한눈에)

- [ ] Bot Token Scopes 6개 추가 (channels:read, channels:history, chat:write, app_mentions:read, groups:read, channels:manage)
- [ ] Socket Mode **Enabled**
- [ ] App-Level Token 생성 (scope: `connections:write`)
- [ ] Event Subscriptions **Enabled**, `message.channels` (+ 비공개 시 `message.groups`) 구독
- [ ] Scope/Event 변경 후 **Reinstall to Workspace** 수행
- [ ] `#owner-command` 채널 생성
- [ ] 채널에 봇 초대
- [ ] `.env`에 `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN` 저장
- [ ] `solosquad doctor --messenger-check` 통과

---

### 4.2 Discord 봇 설정

> **최종 결과물:** `.env`에 `DISCORD_TOKEN=...`이 저장되고, Discord 서버의 `#owner-command` 채널에서 봇이 메시지에 응답.

Slack보다 단계가 적고 봇이 채널을 자동 생성해준다는 장점이 있습니다. 대신 **서버 이름에 제품명(또는 slug)이 포함되어야 자동 매핑**되는 점에 주의.

#### Step 1 — Discord 애플리케이션 생성

1. https://discord.com/developers/applications 접속 (Discord 로그인 필요)
2. 우측 상단 **New Application**
3. 이름 입력 (예: `My AI Team`) → **Create**

#### Step 2 — 봇 토큰 발급

1. 좌측 메뉴 **Bot** 클릭
2. **Reset Token** 클릭 → **Yes, do it!**
3. 나타난 토큰을 **한 번만 보여주므로 즉시 복사**해서 메모장에 저장

이 값이 `.env`의 `DISCORD_TOKEN`입니다.

#### Step 3 — Privileged Gateway Intents 활성화

같은 **Bot** 페이지 아래로 스크롤 → **Privileged Gateway Intents** 섹션.

| Intent | 필수 여부 | 왜 필요한가 |
|---|---|---|
| **Presence Intent** | 선택 | 사용자 온라인 상태 추적 (현재 미사용) |
| **Server Members Intent** | 선택 | 서버 멤버 목록 조회 (현재 미사용) |
| **Message Content Intent** | **필수** | 봇이 메시지 본문을 읽을 수 있게 함 — **이걸 안 켜면 "안녕"을 봐도 내용을 알 수 없어 응답 불가** |

최소 **Message Content Intent**를 ON → 하단 **Save Changes**.

> **자주 하는 실수:** Discord는 2022년부터 Message Content를 privileged intent로 승격시켰습니다. 이 토글을 켜지 않으면 메시지 내용이 빈 문자열로 도착해 봇이 무시함.

#### Step 4 — OAuth2 URL 생성 (서버 초대 링크)

좌측 메뉴 **OAuth2 → URL Generator**.

1. **Scopes** 섹션:
   - ✅ `bot` (필수)
   - ✅ `applications.commands` (슬래시 명령 지원용, 권장)
2. **Bot Permissions** 섹션에서:
   - ✅ **View Channels**
   - ✅ **Send Messages**
   - ✅ **Read Message History**
   - ✅ **Manage Channels** (루틴이 채널 자동 생성 시 필요)
3. 하단 **Generated URL** 복사 → 브라우저 주소창에 붙여넣기
4. 열린 화면에서 봇을 추가할 **서버 선택** → **Authorize**

#### Step 5 — 서버 이름 규칙

봇이 어느 서버를 어느 **제품**에 연결할지 판단하려면 서버 이름에 **제품 이름 또는 slug**가 포함되어야 합니다 (`src/messenger/discord-adapter.ts:200` 로직).

예시:
- 제품 등록: `My Startup` (slug: `my-startup`)
- Discord 서버 이름: `My Startup` 또는 `My Startup Workspace` 또는 `my-startup-dev` → 모두 자동 매핑 성공
- Discord 서버 이름: `Awesome Team` → **매핑 실패** (봇이 메시지를 받아도 어떤 제품인지 모름)

> 서버를 새로 만들면 이름을 조정하거나, 이미 있는 서버라면 이름을 바꿀 수 있습니다 (**서버 설정 → Overview → Server Name**).

#### Step 6 — 채널 자동 생성 확인

봇을 초대하고 `solosquad bot`을 실행하면, 봇이 해당 서버에 다음 카테고리/채널을 자동 생성합니다:

```
📁 AI Team Reports
  #daily-brief
  #signals
  #experiments
  #weekly-review
  #owner-command       ← 여기서 봇에게 명령
```

수동으로 만들 필요 없음. 이미 같은 이름 채널이 있으면 생성 생략.

#### Step 7 — `.env`에 토큰 저장

```env
MESSENGER=discord
DISCORD_TOKEN=MTIzNDU2...
```

#### Step 8 — 동작 검증

```bash
solosquad doctor --messenger-check
```
`Discord /users/@me → <봇사용자명>`이 ✓면 토큰 유효.

```bash
solosquad bot
```
→ `[Discord Bot] Logged in: <봇#0000>`, `[Discord Bot] Ready. Connected to 1 server(s)` 로그 확인.

`#owner-command`에 "안녕" 전송 → 응답 오면 성공.

#### Discord 설정 체크리스트

- [ ] Application 생성
- [ ] Bot 토큰 발급 및 복사
- [ ] **Message Content Intent** ON (필수)
- [ ] OAuth2 URL에 `bot` + `applications.commands` scope 포함
- [ ] Bot permissions: View Channels, Send Messages, Read Message History, Manage Channels
- [ ] 서버 이름에 제품 이름/slug 포함
- [ ] 봇을 서버에 Authorize로 초대
- [ ] `.env`에 `DISCORD_TOKEN` 저장
- [ ] `solosquad doctor --messenger-check` 통과

---

### 4.3 Telegram 봇 설정

> **최종 결과물:** `.env`에 `TELEGRAM_BOT_TOKEN`과 `TELEGRAM_CHAT_ID`가 저장되고, Telegram에서 봇에게 보낸 메시지에 응답.

세 플랫폼 중 설정이 가장 단순하지만, `chat_id`를 수동으로 확보하는 단계가 있습니다.

#### Step 1 — @BotFather에게 봇 생성 요청

1. Telegram에서 `@BotFather` 검색 → 공식 배지(파란 체크) 확인 후 채팅 시작
2. `/newbot` 전송
3. 봇 이름 입력 (예: `My AI Team`)
4. 봇 유저네임 입력 (**반드시 `bot`으로 끝남**, 예: `my_ai_team_bot`)
5. BotFather 응답 메시지에 **HTTP API Token**이 포함됨 → 복사해서 메모장에 저장

이 값이 `.env`의 `TELEGRAM_BOT_TOKEN`입니다. 포맷: `<숫자>:<문자열>` (예: `7123456789:AAH...`)

#### Step 2 — (선택) Privacy Mode 해제 — 그룹 사용 시

봇을 **그룹 채팅**에서 쓸 계획이라면, 기본적으로 봇은 `/command` 형태나 자기를 @멘션한 메시지만 받습니다. 모든 메시지를 받으려면:

1. `@BotFather`에게 `/mybots` 전송
2. 방금 만든 봇 선택
3. **Bot Settings** → **Group Privacy** → **Turn off**

개인 DM으로만 쓸 거면 이 단계 생략 가능.

#### Step 3 — Chat ID 확보

SoloSquad는 **특정 chat_id로만 동작**합니다 (다른 사람 메시지는 무시). 이 id를 찾아 `.env`에 저장해야 함.

방법 1 — 개인 DM 또는 그룹에서:

1. 생성한 봇에게 Telegram에서 **아무 메시지나 하나 전송** (예: `start`)
   - 그룹으로 쓴다면 그 그룹에 봇을 추가하고 그룹 내에서 한 번 @봇이름 멘션
2. 웹브라우저에서 아래 URL 열기 (토큰만 본인 것으로 바꿈):
   ```
   https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates
   ```
3. JSON 응답에서 `"chat":{"id":...}` 값을 찾아 복사
   - 개인 DM: 양수 (예: `123456789`)
   - 그룹: 음수 (예: `-987654321`)
   - supergroup: 큰 음수 (예: `-1001234567890`)

방법 2 — 채널로 쓰는 경우:

- Chat ID 대신 `@channelname` 형태로도 가능
- 봇을 채널의 관리자로 추가 필요 (채널 설정 → Administrators)

#### Step 4 — `.env`에 저장

```env
MESSENGER=telegram
TELEGRAM_BOT_TOKEN=7123456789:AAHxxxxx
TELEGRAM_CHAT_ID=123456789
```

#### Step 5 — 동작 검증

```bash
solosquad doctor --messenger-check
```
`Telegram getMe → @<봇유저네임>`이 ✓면 토큰 유효.

```bash
solosquad bot
```
→ `[Telegram Bot] Polling started...` 로그 확인.

Telegram에서 봇에게 "안녕" 전송 → 응답 오면 성공.

#### Telegram 설정 체크리스트

- [ ] @BotFather에서 봇 생성
- [ ] HTTP API Token 복사
- [ ] (그룹 사용 시) Privacy Mode OFF
- [ ] 봇에게 최소 1회 메시지 전송
- [ ] `getUpdates` URL에서 `chat.id` 획득
- [ ] `.env`에 토큰과 chat_id 저장
- [ ] `solosquad doctor --messenger-check` 통과

---

## 5. 설치 & 초기화

### 5.1 터미널 열기

- **macOS**: Spotlight(⌘+Space) → "터미널"
- **Windows**: 시작 → "Windows Terminal" 또는 "PowerShell"
- **Linux**: Ctrl+Alt+T

### 5.2 npm 글로벌 설치

```bash
npm install -g solosquad
solosquad --version   # 1.1.5 이상
```

### 5.3 작업 공간 초기화

```bash
mkdir ~/solosquad-workspace
cd ~/solosquad-workspace
solosquad init
```

설치 마법사가 순차적으로 물어봅니다:

```
-- Step 1: Environment Check --
 ✓ Docker
 ✓ Node.js 18+
 ✓ git
 ✓ claude

-- Step 2: Initialize Workspace --
 ✓ agents/
 ✓ routines/
 ✓ core/
 ✓ templates/
 ✓ orchestrator/
 ✓ .env.example
 ✓ docker-compose.yml
 ✓ Dockerfile

-- Step 3: Configuration --
Your name:                (본인 이름)
Your role:                (예: developer, designer, founder)
Messenger platform:       (Discord / Slack / Telegram / multi)
<플랫폼별 토큰 입력>       (4장에서 얻은 값)
Project storage path:     (Enter → OS별 기본값)

-- Step 4: Register Products --
Product/Organization name:  (제품 이름, 여러 개 가능)

-- Step 5: Safety & Security --
 (.gitignore 체크, 보안 체크리스트 출력)

Setup Complete!
```

### 5.4 Claude Code 로그인

```bash
claude login
```

브라우저가 열립니다 → Claude 계정 (Max 플랜) 로그인 → 완료.

> 로그인은 **이 Mac/PC의 해당 OS 사용자 계정**에 귀속됩니다. 다른 데스크탑에서 봇을 돌릴 거면 그 데스크탑에서도 `claude login`이 필요.

### 5.5 환경 진단

```bash
solosquad doctor
```

모든 항목이 ✓인지 확인. ✗이 있으면 힌트를 따라 수정.

메신저 토큰까지 실제로 유효한지 보려면:
```bash
solosquad doctor --messenger-check
```

---

## 6. 24/7 운영 방식 선택

봇이 Slack/Discord/Telegram과 연결을 유지하려면 `solosquad bot` 프로세스가 **계속 실행 중**이어야 합니다. 여기서 방식이 갈립니다.

| 방식 | 대상 | 난이도 | 유지비 | PC 전원 |
|---|---|---|---|---|
| **Option A — 로컬 데스크탑** | 기본: Mac Mini를 집에 두고 항상 켜두는 1인 창업자 | 낮음 | 전기비만 | **항상 켜둬야 함** |
| **Option B — 클라우드 VPS** | 집에 서버 둘 생각 없음, 완전한 24/7 | 중 | 월 $4~6+ | PC 꺼도 무관 |

### Option A — 로컬 데스크탑 상시 가동 (기본)

집에 항상 켜두는 PC가 있다는 전제. Mac Mini가 이 용도로 가장 적합 (저전력, 조용, 안정적).

세 가지 하위 방식 중 선택:

#### A-1. 터미널 열어두기 (가장 간단, QA/테스트 단계 권장)

```bash
solosquad bot
```

- 터미널 창이 열려 있는 동안만 동작
- `Ctrl+C` 또는 창 닫으면 멈춤
- macOS에서 PC가 슬립에 들어가면 연결 끊김

**macOS 슬립 방지 (Mac Mini에 특히 유용):**
```bash
caffeinate -dims
```
또는 **시스템 설정 → 에너지 절약 → "사용하지 않을 때 디스플레이 끄기" 제외** + **절전 모드 비활성화**.

**Windows 슬립 방지:**
설정 → 시스템 → 전원 → "절대 절전 모드로 설정 안 함"

스케줄러(자동 루틴)도 병행하려면 별도 터미널에서:
```bash
solosquad schedule
```

#### A-2. Docker Compose (백그라운드 + 자동 재시작, 권장)

터미널을 닫아도 백그라운드에서 계속 돌고, 프로세스가 죽어도 자동 재시작됩니다.

**전제 조건:**
- Docker Desktop 설치 (https://docs.docker.com/desktop/)
- macOS: Apple Silicon / Intel 모두 동작
- `solosquad init`이 `Dockerfile`과 `docker-compose.yml`을 워크스페이스에 복사했는지 확인

**실행:**
```bash
cd ~/solosquad-workspace
docker compose up -d --build      # 최초 빌드 + 백그라운드 기동
docker compose logs -f bot        # 봇 로그 확인
docker compose logs -f scheduler  # 스케줄러 로그 확인
docker compose ps                 # 서비스 상태
docker compose restart            # 재시작
docker compose down               # 정지
```

**중요 — Claude Code 인증 공유:**

컨테이너 내부의 `claude` CLI도 인증이 필요합니다. `docker-compose.yml`은 호스트의 `${HOME}/.claude` 디렉토리를 컨테이너의 `/root/.claude`로 마운트하여 **호스트의 로그인 세션을 공유**합니다.

즉 흐름은:
1. 호스트에서 `claude login` (5.4 단계) 완료
2. `docker compose up -d --build`
3. 컨테이너 안의 `claude` 명령이 호스트의 자격증명 파일을 읽어 동일한 Claude 계정으로 동작

호스트의 Claude 자격증명이 다른 경로에 있다면 `.env`에서 경로를 지정:
```env
CLAUDE_AUTH_DIR=/Users/youruser/.claude
```

**PC 재부팅 후:**

Docker Desktop이 자동 시작되도록 설정되어 있다면 (Docker Desktop 설정 → "Start Docker Desktop when you log in"), 컨테이너는 `restart: unless-stopped` 정책에 따라 자동 복귀합니다.

> **Windows Docker 주의:** `${HOME}/.claude` 볼륨 마운트는 macOS/Linux 기준입니다. Windows에서 Docker를 쓴다면 `CLAUDE_AUTH_DIR`을 `C:/Users/yourname/.claude` 같은 절대 경로로 명시하거나, A-1 또는 A-3 방식을 권장.

#### A-3. macOS launchd / Windows 서비스 (서비스화)

Docker 없이 네이티브 프로세스를 로그인 시 자동 시작하려면.

**macOS — launchd:**

`~/Library/LaunchAgents/com.solosquad.bot.plist` 생성:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.solosquad.bot</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/solosquad</string>
    <string>bot</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOURNAME/solosquad-workspace</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/tmp/solosquad-bot.log</string>
  <key>StandardErrorPath</key><string>/tmp/solosquad-bot.err</string>
</dict>
</plist>
```

(`/usr/local/bin/solosquad` 경로는 `which solosquad`로 확인하여 본인 환경에 맞게 조정.)

등록 및 시작:
```bash
launchctl load ~/Library/LaunchAgents/com.solosquad.bot.plist
launchctl start com.solosquad.bot
tail -f /tmp/solosquad-bot.log
```

스케줄러도 동일한 방식으로 `com.solosquad.scheduler.plist` 하나 더 만들어 등록.

**Windows — NSSM (간단):**

1. https://nssm.cc 에서 NSSM 다운로드 → `nssm.exe`를 PATH에 추가
2. 관리자 PowerShell:
```powershell
nssm install SolosquadBot "C:\Users\YOU\AppData\Roaming\npm\solosquad.cmd" bot
nssm set SolosquadBot AppDirectory "C:\Users\YOU\solosquad-workspace"
nssm start SolosquadBot
```

### Option B — 클라우드 VPS 상시 가동 (고급)

"집에 서버 둘 생각 없음" 또는 "PC 꺼도 봇은 살아있어야" 하면 클라우드가 정답.

**언제 Option B를 고려해야 하나:**
- 집에 24/7 켜둘 PC가 없음
- 여행 중이거나 노트북만 쓰는 라이프스타일
- 팀원이 생겨 봇을 공동 운영해야 함
- 안정성이 사업 운영에 직결 (예: 자동 알림/루틴 실패 시 손실이 큼)

**간단 비교:**

| 제공업체 | 월 비용 | 특징 |
|---|---|---|
| Hetzner | ~$4 | 유럽 기반, 가성비 최고 |
| Vultr | $5 | 서울 리전 있음 |
| Linode | $5 | 안정적 |
| DigitalOcean | $6 | 커뮤니티 자료 풍부 |
| Railway (PaaS) | $5+ | GitHub 연동 자동 배포, 서버 관리 불필요 |
| Fly.io (Docker PaaS) | $5+ | 도쿄 리전, 글로벌 배포 |
| AWS ECS Fargate | $10~15 | 엔터프라이즈급 |

상세 설치 절차는 별도 문서에 정리되어 있습니다:

> **📄 상세 가이드:** [`docs/cloud-deployment.md`](./cloud-deployment.md)
> - VPS 최초 설정
> - Node.js 설치
> - solosquad 글로벌 설치
> - systemd 서비스 등록
> - 로그 관리, 업데이트, 백업

빠른 요약 (Option A — VPS + systemd):

```bash
# VPS SSH 접속 후
sudo apt update && sudo apt install -y nodejs npm git
npm install -g @anthropic-ai/claude-code solosquad
mkdir ~/solosquad && cd ~/solosquad
solosquad init
claude login
# systemd 서비스 등록 → 자세한 내용은 cloud-deployment.md 참조
```

---

## 7. 설치 확인 & 일상 사용

### 7.1 봇 테스트

로컬이든 클라우드든 `solosquad bot`이 살아있으면 메신저에서:

```
Slack/Discord:  #owner-command 채널에 "안녕" 전송
Telegram:       봇에게 직접 "안녕" DM
```

봇이 `[제품명 (agent-name)] ...` 형태로 응답하면 전 구간 정상.

### 7.2 메신저에서 AI에게 일 시키기

자연어로 명령. 25개 에이전트 중 키워드 기반 자동 라우팅.

| 예시 입력 | 배정되는 에이전트 |
|---|---|
| "랜딩페이지 카피 써줘" | Content Writer (그로스팀) |
| "경쟁사 분석해줘" | Desk Researcher (경험팀) |
| "이번 주 실험 결과 정리해줘" | Data Analyst (전략팀) |
| "회원가입 API 설계해줘" | API Developer (엔지니어링팀) |
| "로그인 화면 UI 만들어줘" | UI Designer (경험팀) |

60+ 키워드 → 25 에이전트 매핑. 매칭 없으면 general 모드.

### 7.3 자동 루틴

매일 자동 실행:

| 시간 | 내용 | 보고 채널 |
|---|---|---|
| 06:00 | 오늘 브리핑 | #daily-brief |
| 12:00 | 시장 시그널 | #signals |
| 16:00 | 실험 상태 점검 | #experiments |
| 22:00 | 일일 기록 | #daily-brief |
| 일 20:00 | 주간 회고 | #weekly-review |

스케줄러 시작 (봇과 별도):
```bash
solosquad schedule
```

Docker 사용 시 `scheduler` 서비스가 자동 실행되므로 별도 명령 불필요.

수동 실행:
```bash
solosquad run-routine              # 인터랙티브 선택
solosquad run-routine signal-scan  # 특정 루틴
solosquad run-routine --all        # 전부
```

### 7.4 대시보드

```bash
solosquad status
```
등록 제품, 프로젝트 현황, 최근 활동을 표로 출력.

---

## 8. 업데이트

```bash
solosquad update
```
npm 레지스트리의 최신 버전과 비교해서 업데이트 제안. `y` 입력 시 자동 `npm install -g`.

수동:
```bash
npm install -g solosquad@latest
```

Docker 환경에서는 이미지를 재빌드:
```bash
docker compose up -d --build
```

---

## 9. 제품 여러 개 운영

설치 시 제품을 여러 개 등록하거나 나중에 추가할 수 있습니다. 각 제품은 **완전히 격리된 AI 공간**을 갖습니다 (`~/repos/<slug>/`).

```
~/repos/
  product-a/
    product/ memory/ projects/ ...
    slack/ 또는 discord/   ← 플랫폼 채널 매핑 설정
  product-b/
    product/ memory/ projects/ ...
```

제품 A의 AI는 제품 B의 데이터를 **절대 못 봄**.

제품 추가:
```bash
solosquad init
```
기존 설정은 보존되고 새 제품만 추가됩니다.

---

## 10. 보안

이 시스템은 AI가 코드를 실행합니다. 다음을 꼭 확인.

- [ ] `.env`가 `.gitignore`에 포함되어 있는지
- [ ] 봇 토큰 주기적 교체 (90일 권장)
- [ ] AI 출력을 프로덕션에 배포하기 전 반드시 검토
- [ ] 메신저 봇 권한은 최소로 설정 (위의 scope 리스트 이상 주지 않기)
- [ ] `solosquad doctor` 주기적으로 실행
- [ ] 클라우드 운영 시: SSH 키 인증만 허용, 방화벽은 아웃바운드만 허용

상세: `docs/v1.2-safety-security.md`

---

## 11. 문제 해결

### "solosquad를 찾을 수 없습니다"
- `npm install -g solosquad`로 설치했는지 확인
- `node --version`으로 Node.js 18+ 확인
- Linux에서 권한 오류 시: `sudo npm install -g solosquad` 또는 `~/.npm-global` 설정

### "claude를 찾을 수 없습니다"
- `npm install -g @anthropic-ai/claude-code`
- `claude login`
- `solosquad doctor`로 최종 확인

### 메신저에서 봇이 응답하지 않음

우선 `solosquad doctor`로 환경 불일치를 확인하세요. 특히 `.env vs process.env mismatch` 경고가 뜨면 `solosquad`를 최신 버전으로 업데이트해야 합니다 (`.env` 로드 버그는 v1.1.3에서 수정됨).

```bash
solosquad doctor --messenger-check
```
세 플랫폼의 live API로 토큰을 검증합니다.

**Slack 체크리스트:** 4.1 Step 9의 체크리스트 재확인. 특히:
- Event Subscriptions 활성화 + `message.channels` 구독
- Scope 변경 후 Reinstall to Workspace 수행
- #owner-command 채널에 봇 초대

**Discord 체크리스트:** 4.2 마지막 체크리스트. 특히:
- **Message Content Intent** ON
- 서버 이름에 제품 이름/slug 포함

**Telegram 체크리스트:** 4.3 마지막. 특히:
- `chat_id`가 올바른 값인지 (숫자/음수/@channel 구분)
- 그룹 사용 시 Privacy Mode OFF

### 루틴이 실행되지 않음
- `solosquad schedule`이 실행 중인지 (`ps`, `docker compose ps`)
- 수동 테스트: `solosquad run-routine signal-scan`

### Docker: `claude: command not found` 컨테이너 내부
- `CLAUDE_AUTH_DIR` 볼륨 마운트가 올바른지 확인
- 컨테이너 안에서 직접 인증: `docker exec -it solosquad-bot claude login` (필요 시)

### 업데이트 후 동작 이상
```bash
solosquad doctor
solosquad update   # 이미 최신이면 안내만 출력
docker compose up -d --build   # Docker 사용 시 이미지 재빌드
```

---

## 자주 묻는 질문

**Q: 비용이 얼마나 드나요?**
A: Claude Code Max 구독료만 있으면 시작 가능. 클라우드 운영 시 VPS 월 $4~6 추가.

**Q: Discord와 Slack을 동시에 쓸 수 있나요?**
A: 네. `.env`에서 `MESSENGER=discord,slack`으로 설정.

**Q: 시간대가 한국이 아니면?**
A: `.env`의 `TZ=`를 변경 (예: `TZ=America/Los_Angeles`). Docker도 동일.

**Q: AI가 틀린 답을 하면?**
A: AI는 도구입니다. 중요한 결정은 반드시 본인이 직접 확인.

**Q: Mac Mini 대신 Raspberry Pi로 돌릴 수 있나요?**
A: Node.js 18+이 돌면 가능. 단, Claude Code CLI는 arm64 기반 리눅스를 공식 지원하는지 먼저 확인 필요.

**Q: 완전 오프라인에서 쓸 수 있나요?**
A: 불가. Claude API와 Slack/Discord 서버와의 통신이 필수.
