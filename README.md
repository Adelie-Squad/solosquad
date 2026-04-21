# SoloSquad

> A 24/7 AI assistant system for solo founders. Operates product-specific agents using Claude Code.

Running a company alone doesn't mean working alone. SoloSquad gives you a full virtual team — 25 specialized AI agents organized into 4 teams — that operates around the clock via your favorite messenger, scheduled routines, and CLI tools. Just talk to it like you'd talk to a co-founder, and the right specialist picks up.

**Supports:** Discord | Slack | Telegram — choose one or multiple during setup.
**Platforms:** Windows | macOS | Linux — cross-platform CLI with CI-tested support.

---

## What This Is

A self-hosted AI operations system that turns Claude Code into a **team of domain experts** for your startup. Instead of one generic chatbot, you get:

- A **Strategy team** that validates PMF hypotheses, scopes features, and analyzes data
- A **Growth team** that writes copy, plans GTM, and runs paid campaigns
- An **Experience team** that conducts user research, designs UX flows, and builds UI systems
- An **Engineering team** that architects systems, writes code, manages infra, and collects data

Each agent carries 200+ lines of domain-specific expertise — not generic instructions, but structured frameworks, quality checklists, and handoff protocols that mirror how real teams operate.

---

## Why This Exists

Solo founders face a structural disadvantage: every decision — strategy, design, marketing, engineering — falls on one person. AI can help, but a single chat thread doesn't scale. You end up re-explaining context, losing decisions, and doing shallow work across too many domains.

This system solves that by giving each domain its own specialist agent, persistent memory, and structured workflows — so you can think at the strategic level while your agents handle the execution depth.

---

## Key Features

### 25 Agents, 4 Teams, 1 Command

Send a message in your messenger. The system analyzes your intent across 60+ keywords and routes it to the right specialist. No manual selection needed.

```
You: "Analyze our signup funnel drop-off"
→ Routes to Data Analyst (Strategy team)

You: "Write a launch announcement for Product Hunt"
→ Routes to Content Writer (Growth team)
```

### Multi-Platform Messenger Support

Pick the platform that fits your workflow — or run multiple simultaneously:

| Platform | Best For | Key Advantage |
|----------|----------|---------------|
| **Discord** | Channel-based teams | Auto-creates channels, rich category organization |
| **Slack** | Workspace integration | Socket Mode, native workspace feel |
| **Telegram** | Lightweight / mobile | Simple setup, works anywhere |

Set `MESSENGER=discord`, `MESSENGER=slack`, or `MESSENGER=discord,slack` for multi-platform.

### 3-Layer Context Isolation

The system prevents context bleeding across products and projects:

```
Layer 0: Universal     → Owner profile, principles, voice (shared everywhere)
Layer 1: Product       → Briefs, memory, signals (per-product)
Layer 2: Project       → Agents, experiments, status (per-project)
```

Each product gets its own workspace. Agents working on Product A never see Product B's data.

### Persistent Memory That Compounds

Routines run on schedule, extract structured data, and append to JSONL memory files. Over time, your agents build a growing knowledge base of signals, experiments, and decisions — so every interaction gets smarter.

### Multi-Session Team Orchestration

For complex projects (PMF validation, feature launches, rebranding), the Orchestrator breaks work into phases and coordinates multiple team sessions running in parallel:

```
Phase 1: Research    → User Researcher + Desk Researcher + Idea Refiner (parallel)
Phase 2: Planning    → PMF Planner + Feature Planner
Phase 3: Design      → UX Designer → UI Designer (sequential)
Phase 4: Build       → Architect → Frontend + Backend (parallel)
Phase 5: QA + Mktg   → QA Engineer + GTM Strategist (parallel)
Phase 6: Launch      → Paid Marketer (after QA Go)
```

Agents hand off context to each other via a structured **Handoff Protocol** — summary, artifacts, key decisions, open questions — so nothing gets lost between stages.

### 24/7 Automated Routines

Five scheduled routines run daily without intervention:

| Time | What It Does |
|------|-------------|
| 06:00 | Morning Brief — priorities and blockers for the day |
| 12:00 | Signal Scan — market signals, competitor moves, trends |
| 16:00 | Experiment Check — status of running experiments |
| 22:00 | Daily Log — decisions made, lessons learned |
| Sun 20:00 | Weekly Review — full week retrospective |

Results are posted to your messenger channels and auto-saved to memory.

### One-Command Install (npm)

```bash
npm install -g solosquad
solosquad init
```

The wizard configures your owner profile, registers your products, generates all directory structures, initializes memory files, and gets you operational. OpenClaw-style `update` and `doctor` commands built in.

---

## Prerequisites

| Item | Required |
|------|----------|
| [Claude Code Max Plan](https://claude.ai) | Required |
| Node.js 18+ | Required |
| Docker Desktop | Optional (for isolated execution) |
| Messenger Bot Token | Required (one of the below) |
| GitHub PAT | Optional (auto-create repos) |

**Messenger tokens (pick one or more):**
| Platform | What You Need | Where to Get It |
|----------|--------------|-----------------|
| Discord | Bot Token | [Discord Developer Portal](https://discord.com/developers/applications) |
| Slack | Bot Token + App Token | [Slack API](https://api.slack.com/apps) (Socket Mode) |
| Telegram | Bot Token + Chat ID | [@BotFather](https://t.me/BotFather) on Telegram |

**Per-platform required configuration:**
- **Discord** — enable **MESSAGE CONTENT** privileged gateway intent; invite the bot to a server whose name contains your product name/slug.
- **Slack** — enable **Socket Mode**; App-Level Token scope `connections:write`; Bot Token scopes `channels:read`, `channels:manage`, `chat:write`, `groups:read`, `app_mentions:read`, `channels:history`; subscribe to `message.channels`; `/invite @bot` into `#owner-command`.
- **Telegram** — obtain `TELEGRAM_CHAT_ID` by sending a message to the bot and fetching `chat.id` from `https://api.telegram.org/bot<TOKEN>/getUpdates`. For group messages, disable Group Privacy in BotFather.

If the bot does not connect after `solosquad init`, run `solosquad doctor --messenger-check` to validate tokens against live APIs (`auth.test` / `/users/@me` / `getMe`).

---

## Installation

### OS-specific prerequisites

<details>
<summary><b>macOS</b></summary>

```bash
brew install node git
brew install --cask docker   # optional
npm install -g @anthropic-ai/claude-code
```
</details>

<details>
<summary><b>Windows</b></summary>

```powershell
winget install OpenJS.NodeJS.LTS
winget install Git.Git
winget install Docker.DockerDesktop   # optional
npm install -g @anthropic-ai/claude-code

# Recommended
winget install Microsoft.WindowsTerminal
winget install Microsoft.PowerShell
```
</details>

<details>
<summary><b>Linux (Ubuntu/Debian)</b></summary>

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
sudo apt install -y docker.io   # optional
npm install -g @anthropic-ai/claude-code

# npm global without sudo
mkdir -p ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc
source ~/.bashrc
```
</details>

### 1. Install
```bash
npm install -g solosquad
```

### 2. Initialize Workspace
```bash
mkdir my-workspace && cd my-workspace
solosquad init
```

The setup wizard handles:
- Environment check (Node.js, Docker, git, Claude Code)
- Copies agent definitions, routines, templates to your workspace
- Messenger platform selection (Discord / Slack / Telegram / multi-platform)
- Token configuration with guided instructions
- Product/organization registration (multiple supported)
- Auto-generates product directories + memory + messenger config

### 3. Verify
```bash
solosquad doctor
```

`doctor` now shows platform info, shell name, and OS-specific checks (e.g. PowerShell 7 on Windows). Docker is checked as optional.

---

## Usage

### CLI Commands

```bash
solosquad init          # Setup wizard
solosquad bot           # Start messenger bot
solosquad schedule      # Start automated scheduler
solosquad status        # Show project dashboard
solosquad update        # Check for updates and self-update
solosquad doctor        # Check environment and diagnose issues
solosquad run-routine   # Run a routine manually
```

### Send Commands via Messenger

Send a message in the command channel (`#owner-command` on Discord/Slack, or direct message on Telegram). Keywords are analyzed to auto-route to the appropriate agent.

```
You: Draft landing page copy
Bot: [product-name (content-writer)] ...
```

60+ keywords → 25 agents auto-matched. Falls back to general mode if no keyword match.

### Run Routines Manually
```bash
solosquad run-routine                    # Interactive selection
solosquad run-routine signal-scan        # Run specific routine
solosquad run-routine --all              # Run all routines
```

### Work Directly in a Project Directory
```bash
cd ~/repos/my-product/projects/pmf-validation
claude
# CLAUDE.md auto-loads with isolated context
```

---

## Core Concept: Per-Product Isolation

When you register multiple products, each gets its own isolated workspace.

```
~/repos/
├── product-a/           ← Product A workspace
│   ├── CLAUDE.md        ← Auto-generated (Product A context)
│   ├── product/         ← Brief, weekly status
│   ├── memory/          ← Hypotheses, experiments, decisions, signals
│   │   └── routine-logs/ ← Routine execution logs
│   └── projects/        ← Per-project isolation
│       └── pmf-validation/
│           ├── CLAUDE.md
│           └── ...
├── product-b/           ← Product B workspace
│   └── ...
└── product-c/
    └── ...
```

Each product's AI agents can **only see that product's context**. Other product data is walled off.

---

## Automated Routine Schedule

| Time | Routine | Report Channel | Memory Storage |
|------|---------|----------------|----------------|
| 06:00 daily | Morning Brief | `#daily-brief` | - |
| 12:00 daily | Signal Scan | `#signals` | `signals.jsonl` |
| 16:00 daily | Experiment Check | `#experiments` | `experiments.jsonl` |
| 22:00 daily | Daily Log | `#daily-brief` | `decisions.jsonl` |
| Sun 20:00 | Weekly Review | `#weekly-review` | `decisions.jsonl` |

- JSON blocks in routine results are auto-extracted and appended to JSONL memory
- All routine logs are always saved to `memory/routine-logs/`

---

## Structure

```
(this repo / npm package)
├── package.json            ← npm package config
├── tsconfig.json           ← TypeScript config
├── .gitattributes          ← LF line ending enforcement (cross-platform)
├── .github/workflows/      ← CI matrix (3 OS × 3 Node versions)
├── bin/solosquad.ts      ← CLI entry point
├── src/
│   ├── cli/                ← CLI commands (init, bot, schedule, status, update, doctor)
│   ├── bot/                ← Agent routing + Claude Code execution
│   ├── messenger/          ← Platform adapters (Discord, Slack, Telegram)
│   ├── scheduler/          ← Cron-based routine execution + memory auto-save
│   └── util/               ← Config, paths, logger, platform detection
├── assets/                 ← Bundled with npm package, copied on `solosquad init`
│   ├── agents/             ← 25 specialized agents (SKILL.md files)
│   ├── core/               ← Owner profile, principles, writing style
│   ├── routines/           ← Routine prompts (editable after init)
│   ├── orchestrator/       ← Project workflow orchestration
│   └── templates/          ← PRD, handoff, status templates
└── dist/                   ← Compiled JavaScript (auto-generated)
```

---

## Team-Based Agents (25)

| Team | Agents | Role |
|------|--------|------|
| **Strategy** | PMF Planner, Feature Planner, Policy Architect, Data Analyst, Business Strategist, Idea Refiner, Scope Estimator | Strategy, planning, analysis |
| **Growth** | GTM Strategist, Content Writer, Brand Marketer, Paid Marketer | Marketing, branding |
| **Experience** | User Researcher, Desk Researcher, UX Designer, UI Designer | Research, design |
| **Engineering** | Creative Frontend, FDE, Architect, Backend Developer, API Developer, Data Collector, Data Engineer, Cloud Admin, QA Engineer, Security Engineer | Development, infrastructure, quality, security |

---

## Cross-Platform Support

The CLI runs natively on Windows, macOS, and Linux. Key features:

- **Unified command detection**: No more `which`/`where` hacks — uses `command -v` on Unix, `where` on Windows
- **CRLF-safe parsing**: All file parsers (`.env`, JSONL, TSV) normalize line endings automatically
- **OS-aware defaults**: Repos path defaults to `~/Documents/solosquad-repos` on Windows, `~/repos` on Unix
- **sudo auto-detection**: `solosquad update` detects when `sudo` is needed on Linux/macOS
- **CI matrix**: Every push is tested on Ubuntu, macOS, and Windows × Node 18/20/22

## Security

The system includes safety measures for AI-powered autonomous execution:

- **Input validation**: Message length limits and empty input checks on all messenger adapters
- **Safety preamble**: Claude subprocess receives safety rules blocking access to .env, .ssh, credentials and destructive commands
- **Output sanitization**: Sensitive patterns (tokens, passwords, API keys) are redacted before memory storage
- **Security Engineer agent**: Dedicated agent for security review, vulnerability assessment, and secure coding guidance
- **Init safety guide**: Security checklist and .gitignore verification during setup

See `docs/v1.2-safety-security.md` for the full security framework.

---

## System Management

```bash
# Update to latest version (auto-detects sudo on Unix)
solosquad update

# Check environment health (shows platform info)
solosquad doctor

# Docker management (if using Docker deployment)
docker compose restart
docker compose logs -f
docker compose down
```

---

## Customizing Routines

After `solosquad init`, edit the `.md` files in the `routines/` folder in your workspace. No rebuild required.

```bash
# Example: Edit Morning Brief prompt
vim routines/morning-brief.md
```

---

## FAQ

**Q: How do I authenticate Claude Code?**
A: Subscribe to Claude Code Max plan, then run `claude login` in your terminal.

**Q: How do I switch messenger platforms?**
A: Change `MESSENGER=slack` (or `telegram`, or `discord,slack`) in `.env` and restart the bot.

**Q: How do I use multiple messengers simultaneously?**
A: Set `MESSENGER=discord,slack` in `.env`. The bot and scheduler will connect to both platforms.

**Q: How do I add a product later?**
A: Re-run `solosquad init`. Existing settings are preserved; only the new product is added.

**Q: How do I update to the latest version?**
A: Run `solosquad update` — it checks npm for the latest version and offers to update.

**Q: What if agent routing is wrong?**
A: Edit the keyword-agent mapping in `src/bot/agent-router.ts` in the package source, or raise an issue.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT License
