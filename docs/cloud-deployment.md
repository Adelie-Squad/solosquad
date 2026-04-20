# Cloud Deployment Guide

> `npm install -g solosquad`로 클라우드 서버에 설치하고 24/7 운영하는 방법

## 목차

1. [개요](#1-개요)
2. [배포 옵션 비교](#2-배포-옵션-비교)
3. [Option A: VPS + npm (추천)](#option-a-vps--npm-추천)
4. [Option B: Railway (PaaS)](#option-b-railway-paas)
5. [Option C: Fly.io (Docker)](#option-c-flyio-docker)
6. [Option D: AWS ECS Fargate](#option-d-aws-ecs-fargate)
7. [Option E: Claude Agent SDK + Sandbox](#option-e-claude-agent-sdk--sandbox)
8. [운영 공통사항](#운영-공통사항)
9. [유사 서비스 참고](#유사-서비스-참고)

---

## 1. 개요

### 설치 흐름

```
npm registry                    클라우드 서버
(npmjs.com)                     (VPS / PaaS / AWS)
     │                               │
     │  npm install -g                │
     │  solosquad           │
     │◀──────────────────────────────│
     │                               │
     │──────────────────────────────▶│  ~/.npm-global/bin/solosquad
     │   패키지 다운로드 + 설치         │
                                     │
                              solosquad init      ← 초기 설정
                              solosquad bot       ← 메신저 봇 시작
                              solosquad schedule  ← 크론 루틴 시작
```

### 시스템 요구사항

| 항목 | 최소 | 권장 |
|------|------|------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 1 GB | 2 GB |
| 디스크 | 5 GB | 10 GB |
| Node.js | 18+ | 20 LTS |
| OS | Ubuntu 22.04+ / Debian 12+ | Ubuntu 24.04 |
| 네트워크 | 아웃바운드 HTTPS | - |

### 필요한 계정/토큰

| 항목 | 용도 | 발급처 |
|------|------|--------|
| Anthropic API Key | Claude Code 실행 | console.anthropic.com |
| Discord Bot Token | 디스코드 봇 (선택) | discord.com/developers |
| Slack Bot Token | 슬랙 봇 (선택) | api.slack.com |
| Telegram Bot Token | 텔레그램 봇 (선택) | @BotFather |

---

## 2. 배포 옵션 비교

| 옵션 | 유형 | 월 비용 | 난이도 | 설치 방식 | 24/7 | 크론 | 파일 영구 저장 |
|------|------|---------|--------|----------|------|------|---------------|
| **A. VPS + npm** | IaaS | $4~6 | ★★☆ | npm install -g | O | O | O (파일시스템) |
| **B. Railway** | PaaS | $5+ | ★☆☆ | GitHub 연동 | O | O | O (볼륨) |
| **C. Fly.io** | PaaS | $5+ | ★★☆ | Docker | O | O | O (볼륨) |
| **D. AWS ECS** | 매니지드 | $10~15 | ★★★ | Docker | O | O | O (EFS) |
| **E. Agent SDK** | SDK | $36+ | ★★★ | SDK 통합 | O | 커스텀 | 커스텀 |

**추천:**
- 가장 단순하고 저렴 → **Option A** (VPS + npm install)
- 서버 관리 없이 빠르게 → **Option B** (Railway)
- 글로벌 배포 필요 → **Option C** (Fly.io)
- 엔터프라이즈 인프라 → **Option D** (AWS ECS)

**비추천:**
- AWS Lambda / Serverless → WebSocket 유지 불가, 15분 타임아웃, JSONL 파일 저장 부적합
- Render 무료 티어 → 비활성 시 슬립, 24/7 운영 불가

---

## Option A: VPS + npm (추천)

npm install로 직접 설치. 가장 단순하고 저렴.

### VPS 제공업체

| 제공업체 | 최소 사양 | 월 비용 | 특징 |
|---------|----------|---------|------|
| **Hetzner** | 2 vCPU, 2GB RAM, 20GB | ~$4 | 유럽 기반, 가성비 최고 |
| **Vultr** | 1 vCPU, 1GB RAM, 25GB | $5 | 서울 리전 |
| **Linode** | 1 vCPU, 1GB RAM, 25GB | $5 | 안정적 |
| **DigitalOcean** | 1 vCPU, 1GB RAM, 25GB | $6 | 커뮤니티 자료 풍부 |

### 설치 매뉴얼

#### Step 1: 서버 초기 설정

```bash
# SSH 접속
ssh root@YOUR_SERVER_IP

# 시스템 업데이트
apt update && apt upgrade -y

# 비root 사용자 생성
adduser deploy
usermod -aG sudo deploy
su - deploy
```

#### Step 2: Node.js 설치

```bash
# Node.js 20 LTS (nvm 사용)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20

# 확인
node --version  # v20.x.x
npm --version   # 10.x.x
```

#### Step 3: Claude Code CLI 설치

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

#### Step 4: solosquad 설치

```bash
# npm에서 글로벌 설치
npm install -g solosquad

# 확인
solosquad --help
```

#### Step 5: 초기 설정

```bash
# 작업 디렉토리 생성
mkdir -p ~/solosquad && cd ~/solosquad

# 초기화 (인터랙티브 설정 위저드)
solosquad init

# .env 파일 생성/수정
cat > .env << 'EOF'
# 메신저 (discord / slack / telegram)
MESSENGER=discord
DISCORD_TOKEN=your_discord_bot_token

# Claude
ANTHROPIC_API_KEY=your_api_key

# 프로필
OWNER_NAME=YourName
OWNER_ROLE=Founder

# 타임존
TZ=Asia/Seoul
EOF
```

#### Step 6: systemd 서비스 등록 (24/7 운영)

봇과 스케줄러를 시스템 서비스로 등록하여 서버 재부팅 시 자동 시작.

```bash
# 봇 서비스
sudo tee /etc/systemd/system/solosquad-bot.service << 'EOF'
[Unit]
Description=SoloSquad - Bot
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/solosquad
ExecStart=/home/deploy/.nvm/versions/node/v20.18.0/bin/solosquad bot
Restart=always
RestartSec=10
EnvironmentFile=/home/deploy/solosquad/.env

[Install]
WantedBy=multi-user.target
EOF

# 스케줄러 서비스
sudo tee /etc/systemd/system/solosquad-scheduler.service << 'EOF'
[Unit]
Description=SoloSquad - Scheduler
After=network.target

[Service]
Type=simple
User=deploy
WorkingDirectory=/home/deploy/solosquad
ExecStart=/home/deploy/.nvm/versions/node/v20.18.0/bin/solosquad schedule
Restart=always
RestartSec=10
EnvironmentFile=/home/deploy/solosquad/.env

[Install]
WantedBy=multi-user.target
EOF

# 서비스 활성화 및 시작
sudo systemctl daemon-reload
sudo systemctl enable solosquad-bot solosquad-scheduler
sudo systemctl start solosquad-bot solosquad-scheduler

# 상태 확인
sudo systemctl status solosquad-bot
sudo systemctl status solosquad-scheduler

# 로그 확인
journalctl -u solosquad-bot -f
journalctl -u solosquad-scheduler -f
```

#### Step 7: 업데이트

```bash
# 방법 1: CLI 명령
solosquad update

# 방법 2: 수동
npm update -g solosquad

# 서비스 재시작
sudo systemctl restart solosquad-bot solosquad-scheduler
```

#### Step 8: 환경 진단

```bash
solosquad doctor
# → Node.js, Claude Code, 토큰, 디렉토리 등 점검
```

---

## Option B: Railway (PaaS)

GitHub 연동으로 자동 배포. 서버 관리 불필요.

### 아키텍처

```
GitHub repo ──push──▶ Railway ──build──▶ 컨테이너 실행
                         │
                    ┌────┴────┐
                    │ bot     │  solosquad bot
                    │ scheduler│  solosquad schedule
                    │ volume  │  /app/memory (JSONL)
                    └─────────┘
```

### 설치 매뉴얼

#### Step 1: Railway 프로젝트 생성

```bash
# Railway CLI 설치 및 로그인
npm install -g @railway/cli
railway login

# 프로젝트 초기화
cd solosquad
railway init
```

#### Step 2: 환경변수 설정

```bash
railway variables set MESSENGER=discord
railway variables set DISCORD_TOKEN=your_token
railway variables set ANTHROPIC_API_KEY=your_key
railway variables set OWNER_NAME=YourName
railway variables set TZ=Asia/Seoul
```

#### Step 3: 서비스 구성

Railway 대시보드에서 두 서비스 생성:

**Bot 서비스:**
- Start Command: `npm run build && node dist/bin/solosquad.js bot`

**Scheduler 서비스:**
- Start Command: `npm run build && node dist/bin/solosquad.js schedule`

#### Step 4: 영구 저장소

대시보드에서:
1. 각 서비스 → Settings → Volumes
2. Mount path: `/app/memory`

#### Step 5: 배포

```bash
railway up
# 또는 GitHub 연동 시 git push로 자동 배포
```

#### Step 6: 로그 확인

```bash
railway logs
```

---

## Option C: Fly.io (Docker)

Docker 기반 배포. 30+ 글로벌 리전.

### Dockerfile

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*

# Claude Code CLI + solosquad 설치
RUN npm install -g @anthropic-ai/claude-code solosquad

WORKDIR /app
RUN mkdir -p /app/memory

CMD ["solosquad", "bot"]
```

### 설치 매뉴얼

#### Step 1: Fly CLI 설치

```bash
# macOS
brew install flyctl

# Linux
curl -L https://fly.io/install.sh | sh

fly auth login
```

#### Step 2: fly.toml 작성

```toml
app = "solosquad"
primary_region = "nrt"  # 도쿄 (서울 최근접)

[build]
  dockerfile = "Dockerfile"

[env]
  MESSENGER = "discord"
  TZ = "Asia/Seoul"

[mounts]
  source = "agents_memory"
  destination = "/app/memory"
```

#### Step 3: 시크릿 및 볼륨

```bash
# 시크릿 설정
fly secrets set DISCORD_TOKEN=your_token
fly secrets set ANTHROPIC_API_KEY=your_key
fly secrets set OWNER_NAME=YourName

# 영구 볼륨 생성
fly volumes create agents_memory --size 1 --region nrt
```

#### Step 4: 배포

```bash
fly deploy
fly logs
```

---

## Option D: AWS ECS Fargate

프로덕션 등급 매니지드 컨테이너.

### 아키텍처

```
┌─────────────┐     ┌──────────────┐     ┌─────────┐
│ ECR (이미지) │────▶│ ECS Fargate  │────▶│ EFS     │
│             │     │  - bot task   │     │ (메모리) │
│             │     │  - scheduler  │     │         │
└─────────────┘     └──────────────┘     └─────────┘
                          │
                    ┌─────┴──────┐
                    │ CloudWatch │
                    │ (로그/알림) │
                    └────────────┘
```

### Dockerfile

```dockerfile
FROM node:20-slim

RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*
RUN npm install -g @anthropic-ai/claude-code solosquad

WORKDIR /app
RUN mkdir -p /app/memory

CMD ["solosquad", "bot"]
```

### 배포 순서

```bash
# 1. ECR 리포지토리 생성
aws ecr create-repository --repository-name solosquad --region ap-northeast-2

# 2. Docker 이미지 빌드 및 푸시
aws ecr get-login-password --region ap-northeast-2 | \
  docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com

docker build -t solosquad .
docker tag solosquad:latest ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/solosquad:latest
docker push ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/solosquad:latest

# 3. EFS 생성
aws efs create-file-system --creation-token solosquad-memory --region ap-northeast-2

# 4. ECS 서비스 생성 (태스크 정의는 아래 참조)
aws ecs create-service \
  --cluster solosquad \
  --service-name bot \
  --task-definition solosquad \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-xxx],securityGroups=[sg-xxx],assignPublicIp=ENABLED}"
```

### ECS 태스크 정의

```json
{
  "family": "solosquad",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "containerDefinitions": [
    {
      "name": "bot",
      "image": "ACCOUNT_ID.dkr.ecr.ap-northeast-2.amazonaws.com/solosquad:latest",
      "command": ["solosquad", "bot"],
      "environment": [
        {"name": "MESSENGER", "value": "discord"},
        {"name": "TZ", "value": "Asia/Seoul"}
      ],
      "secrets": [
        {"name": "DISCORD_TOKEN", "valueFrom": "arn:aws:ssm:ap-northeast-2:ACCOUNT_ID:parameter/solosquad/discord-token"},
        {"name": "ANTHROPIC_API_KEY", "valueFrom": "arn:aws:ssm:ap-northeast-2:ACCOUNT_ID:parameter/solosquad/anthropic-key"}
      ],
      "mountPoints": [
        {"sourceVolume": "memory", "containerPath": "/app/memory"}
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/solosquad",
          "awslogs-region": "ap-northeast-2",
          "awslogs-stream-prefix": "bot"
        }
      }
    }
  ],
  "volumes": [
    {
      "name": "memory",
      "efsVolumeConfiguration": {
        "fileSystemId": "fs-XXXXXXXX"
      }
    }
  ]
}
```

---

## Option E: Claude Agent SDK + Sandbox

공식 Anthropic 패턴. 봇과 에이전트 실행 환경을 분리.

### 아키텍처

```
┌──────────────┐     ┌──────────────────┐     ┌─────────────┐
│ 메신저 봇     │────▶│ Agent SDK        │────▶│ Sandbox     │
│ (VPS/Railway)│     │ 오케스트레이터     │     │ (Modal/E2B/ │
│              │     │                  │     │  Fly Machine)│
└──────────────┘     └──────────────────┘     └─────────────┘
```

### 특징

- 봇은 가벼운 서버에서 실행, Claude Code 작업은 샌드박스에서 격리 실행
- 인스턴스 요구사항: 1 GiB RAM, 5 GiB 디스크, 1 CPU
- 비용: 컨테이너 ~$0.05/시간 (~$36/월) + API 토큰

### 샌드박스 제공업체

| 제공업체 | 특징 |
|---------|------|
| **Modal** (modal.com) | 함수 단위 실행, GPU 지원 |
| **E2B** (e2b.dev) | 코드 실행 특화, 빠른 콜드스타트 |
| **Daytona** (daytona.io) | 개발 환경 프로비저닝 |
| **Fly Machines** (fly.io) | VM 수준 제어 |
| **Cloudflare Sandbox** | 엣지 실행, 짧은 레이턴시 |

### 코드 예시

```typescript
import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function handleMessage(userMessage: string) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8096,
    messages: [{ role: "user", content: userMessage }],
    tools: [/* agent tools */],
  });
  return response;
}
```

---

## 운영 공통사항

### 업데이트

```bash
# CLI 내장 업데이트
solosquad update

# 또는 npm 직접
npm update -g solosquad

# Docker 환경에서는 이미지 재빌드
docker compose up -d --build
```

### 모니터링

```bash
# 환경 진단
solosquad doctor

# 대시보드
solosquad status
```

### 메모리/로그 백업

루틴 실행 결과는 JSONL 파일로 저장됨:
- `memory/signals.jsonl` — 시그널 스캔
- `memory/experiments.jsonl` — 실험 체크
- `memory/decisions.jsonl` — 의사결정 로그
- `memory/routine-logs/` — 루틴 실행 로그

```bash
# 주기적 백업 (crontab)
0 3 * * * tar czf ~/backup/memory-$(date +\%Y\%m\%d).tar.gz ~/solosquad/memory/
```

### 보안 체크리스트

- [ ] `.env` 파일 권한 제한 (`chmod 600 .env`)
- [ ] 봇 토큰은 서버의 환경변수 또는 시크릿 매니저에 저장
- [ ] 서버 SSH 키 인증만 허용 (비밀번호 로그인 비활성화)
- [ ] 방화벽: 인바운드 SSH(22)만 허용, 나머지 차단
- [ ] 정기적 `npm audit` + `solosquad update` 실행

---

## 유사 서비스 참고

클라우드 24/7 AI 비서 시스템을 운영하는 기존 서비스 및 오픈소스.

| 서비스 | 유형 | 비용 | 특징 |
|--------|------|------|------|
| **Kimi Claw** (kimi.com) | 매니지드 | $39/월+ | OpenClaw 클라우드화, 5000+ 스킬, 40GB 스토리지 |
| **OpenClaw** (openclaw.ai) | 오픈소스 (MIT) | VPS비 + API비 | 247K stars, 22+ 플랫폼, 100+ 스킬 |
| **Claude Agent SDK** | 공식 SDK | ~$36/월 + API비 | Headless 모드, 세션 관리, 공식 지원 |
| **HolyClaude** | 오픈소스 | VPS비 + API비 | Claude Code 프리컨피그 Docker 이미지 |
| **Remote Agentic Coding** | 오픈소스 | VPS비 + API비 | Claude Code + Slack/Telegram 오케스트레이터 |
| **Ruflo** | 오픈소스 | VPS비 + API비 | 60+ 에이전트 멀티 오케스트레이션 |
| **OpenHands** | 오픈소스 | 자체 호스팅 | 70K stars, 자율 코딩 에이전트 |
