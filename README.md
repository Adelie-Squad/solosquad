# SoloSquad

> A 24/7 AI assistant system for solo founders — Discord/Slack bot + scheduled routines + team-based agents, distributed as a single npm package.

Running a company alone doesn't mean working alone. SoloSquad gives you a virtual team of **25 specialist AI agents** across 4 disciplines (Strategy, Growth, Experience, Engineering), reachable from your messenger, with automated daily routines and per-product memory isolation.

```
Output ≠ Goal. Output = Means to achieve the goal.
```

**Platforms:** Windows · macOS · Linux (cross-platform CLI, CI-tested)
**Messenger:** Discord or Slack — one per workspace (Telegram support removed in v0.2.4)
**Stack:** TypeScript + Node.js 18+ · Claude Code as the AI engine · file-based memory (JSONL)

---

## Documentation

📖 **The canonical user guide is the menu-divided HTML manual:**

> **[`docs/manual/master-guide.html`](docs/manual/master-guide.html)** — open it in a browser.

It covers, in ten menu-divided sections:

| # | Section | What's inside |
|---|---|---|
| 1 | Getting Started | Project intent, core concepts, expected value |
| 2 | How It Works | System architecture, folder hierarchy, memory model, workflow definition |
| 3 | Concept Glossary | `SKILL.md`, `KNOWLEDGE.md`, `CLAUDE.md`, `AGENTS.md` comparison; per-layer file inventory; 4-channel routing |
| 4 | Onboarding | Branches for new users, existing-repo migration, and version upgrades |
| 5 | Messenger Setup | Full 9-step Slack and 8-step Discord token walkthroughs |
| 6 | Usage | CLI reference (current + planned), daily ops, first-run checklist, automated routines |
| 7 | Glossary | 60+ core terms, file-name dictionary, acronym dictionary — beginner-friendly |
| 8 | Version Differences | v0.5.0 (npm-published) vs v0.6 / v1.0+ (planned) |
| 9 | Operations | 24/7 hosting options (terminal · Docker · launchd/NSSM · VPS), multi-workspace, multi-org, security checklist |
| 10 | Troubleshooting & FAQ | Install/runtime issues, migration failures, FAQ |

Every feature is tagged with a version badge: 🟢 v0.5.0 (available now) · 🟡 v0.6+ (planned) · 🔴 removed (e.g. Telegram).

For internal architecture, release planning, and decision history, see [`docs/plan/product-roadmap.md`](docs/plan/product-roadmap.md).

---

## Quick Start (5 minutes)

```bash
# 1. Prerequisites (one-time)
brew install node git                             # macOS — see master-guide §4.2 for Windows/Linux
npm install -g @anthropic-ai/claude-code

# 2. Install SoloSquad
npm install -g solosquad
mkdir ~/solosquad-workspace && cd ~/solosquad-workspace
solosquad init                                    # wizard asks for messenger token
claude login                                      # browser opens for Claude Max account
solosquad doctor                                  # verify environment

# 3. Start the bot
solosquad bot                                     # foreground
# or
cd deploy/docker && docker compose up -d --build  # background + auto-restart
```

Then send `안녕` or `hello` to `#owner-command` in your Slack/Discord channel — a specialist agent responds.

**Messenger token setup** takes 5–10 minutes (Slack) or 3–5 minutes (Discord). Follow [master-guide.html §5](docs/manual/master-guide.html) step-by-step.

---

## What you get

### 25 agents across 4 teams, frontmatter-routed automatically

| Team | Agents | Role |
|---|---|---|
| **Strategy** (7) | PMF Planner · Feature Planner · Data Analyst · Business Strategist · Idea Refiner · Scope Estimator · Policy Architect | Market analysis, hypothesis design, planning |
| **Growth** (4) | GTM Strategist · Content Writer · Brand Marketer · Paid Marketer | Marketing, branding, copy, paid acquisition |
| **Experience** (4) | User Researcher · Desk Researcher · UX Designer · UI Designer | Research, design |
| **Engineering** (10) | Creative Frontend · FDE · Architect · Backend · API · Data Collector · Data Engineer · Cloud Admin · QA · Security | Development, infra, quality, security |

```
You: "Write landing page copy"        → Content Writer (Growth)
You: "Analyze the signup funnel"      → Data Analyst (Strategy)
You: "Design the login UI"            → UI Designer (Experience)
You: "Design the signup API"          → API Developer (Engineering)
```

**v0.5 4-channel routing** (priority: `slash > explicit > keyword > freq`) decides which specialist's `SKILL.md` is injected each turn. Triggers live in each agent's frontmatter (`triggers.slash` / `.keyword` / `.freq`), collected at bot boot via a 3-tier scan (`<org>/.agents/` > `~/.solosquad/agents/` > bundled). The old hard-coded `AGENT_ROUTES` constant was removed in v0.5 — hot-reload via atomic index swap means no bot restart on SKILL edits.

### Six automated routines, runs while you sleep

| Default time | Routine | Output channel | Memory |
|---|---|---|---|
| 08:00 daily | Morning Brief | `#workflow` root | — |
| 12:00 daily | Signal Scan | `#workflow` → `system-daily-signals` thread | `signals.jsonl` |
| 16:00 daily | Experiment Check | `#workflow` → `system-experiments` thread | `experiments.jsonl` |
| 18:00 daily | Evening Brief | `#workflow` root | `decisions.jsonl` |
| Sun 20:00 | Weekly Review | `#workflow` → `system-weekly-review` thread | `decisions.jsonl` |
| 23:00 daily (v0.3) | PM Compaction | `#workflow` → `system-pm-compaction` thread | `memory/pm-skills/` |

All times configurable in `.solosquad/workspace.yaml` (timezone defaults to `Asia/Seoul`).

### 3-Layer context isolation

```
Layer 0 · Workspace (universal)    → Owner profile, principles, 25 agent definitions
   ↓
Layer 1 · Organization (per-product) → Memory, workflows, messenger channels
   ↓
Layer 2 · Repository (per-codebase) → Code + repo-specific skills
```

Product A's agents never see Product B's data. Multiple products coexist cleanly under one workspace.

### Self-hosted

Runs on your Mac Mini, PC, or VPS. Your data stays with you. Only outbound calls: Claude API and your messenger's servers.

---

## CLI Reference (v0.5.0)

```bash
# Workspace ops (v0.1+)
solosquad init                                    # workspace setup wizard
solosquad bot                                     # start messenger bot
solosquad schedule                                # start automated routine scheduler
solosquad status                                  # dashboard (orgs, workflows, recent activity)
solosquad doctor                                  # environment diagnostics
solosquad doctor --messenger-check                # validate tokens via live API
solosquad update                                  # check & install latest npm release
solosquad run-routine [name]                      # manual routine execution

# PM mode (v0.3)
solosquad pm status                               # active PM sessions, cumulative cost
solosquad pm reset                                # archive a user's session, mint a new one
solosquad pm compact                              # externalize completed workflows
solosquad workflow list                           # list workflows
solosquad workflow show <wf-id>                   # stages + recent events
solosquad workflow focus <wf-id> [--clear]        # set/clear active workflow per session
solosquad rollback [--workflow <id>] [--to <sha>] [--list]   # git-snapshot revert

# Autonomous engine (v0.4)
solosquad goal new [goal-id]                      # scaffold goal.md from template
solosquad goal list                               # list goals
solosquad goal show <goal-id>                     # spec + recent cycles
solosquad goal run <goal-id> [--hours N | --cycles N]   # background autonomous loop
solosquad goal status [goal-id]                   # cycle counts, cost, ship candidate
solosquad goal stop <goal-id>                     # stop in-flight run (current cycle finishes)
solosquad goal verify <goal-id> --cycle N         # re-run evaluator, check determinism

# Agent authoring (v0.5)
solosquad agent validate <path>                   # validate one SKILL.md against v0.5 schema
solosquad agent validate --all [--corpus]         # validate every bundled + workspace SKILL.md
solosquad agent add --name <slug> --team <team>   # scaffold a new SKILL.md (no LLM)
npm run validate-skills                           # CI gate (= agent validate --all --corpus)

# Repo analyzer (v0.5)
solosquad analyze repo <path> [--force] [--prune-orphans]    # scan .claude/skills/, classify, write report
solosquad add repo --from-report <report> --merge-policy <append|override|replace>

# Migration
solosquad migrate                                 # upgrade workspace layout (dry-run by default)
solosquad migrate --apply                         # perform migration
solosquad migrate --rollback                      # restore from backup

# Org / repo
solosquad add org <name>                          # add an organization
solosquad add repo <url|path>                     # clone or register a repository
solosquad sync                                    # sync repositories/ with .org.yaml
```

See master-guide §6 for the per-command walkthrough and v0.6+ planned commands.

---

## Architecture Overview

Two long-running processes plus a file-based memory layer:

| Process | Role |
|---|---|
| `solosquad bot` | Receives messenger message → resumes the user's long-lived PM session (`orchestrator/SKILL.md`, v0.3) → 4-channel router resolves which specialist to load (`slash > explicit > keyword > freq`, v0.5) → delegates to a fresh subagent via Claude Code's native `Task` tool → synthesizes the tool result and replies |
| `solosquad schedule` | Runs cron-based routines (6 default — see table above), appends results to JSONL memory files |

Two additional modes layer on top of the bot:

- **v0.5 author loop** — messenger-native skill creation. The `_meta/workflow-maker` meta-skill walks the user through `CLARIFY → DRAFT → SANDBOX_PROMPT → AWAIT_CONFIRM → APPLIED`, with paperclip-style budget caps logged to `<org>/memory/author-costs.jsonl`. Spec-gate drafts auto-emit a `<org>/goals/<goal-id>/goal.md`.
- **v0.4 goal-runner** — background autonomous cycle. `solosquad goal run <id>` boots a `bg-<goal-id>-<runId>` PM session that loops pipeline → evaluator (metric gate) → git-snapshot keep/discard until the time/cycle/cost budget runs out or all metrics pass `CONFIRMING`. `solosquad goal verify` re-runs the evaluator on a past cycle to check determinism.

For production-grade always-on, choose one of:
- Docker Compose (recommended, background + auto-restart) — see [`deploy/docker/README.md`](deploy/docker/README.md)
- macOS `launchd` plist / Windows NSSM service
- VPS + systemd (see [`docs/plan/cloud-deployment.md`](docs/plan/cloud-deployment.md))

Full details in master-guide §9.

---

## Versions

Current npm release: **v0.5.0** (npm registry: `0.5.0`).

The project is in pre-launch (v0.x). **v1.0 will mark formal release** with stable API guarantees. Shipped + planned milestones:

| Version | Theme | Highlights |
|---|---|---|
| v0.3 (released) | PM mode + multi-agent orchestration | Long-lived PM session per (user, org); specialists delegated via Claude Code's native `Task` tool; slash chain `/think /plan /build /review /ship`; workflow reconciler on bot boot; `solosquad pm` / `workflow` / `rollback` CLIs; per-org `snapshot.git` |
| v0.4 (released) | Autonomous overnight engine | `goal.md` intent file + `solosquad goal run` background loop; metric-driven keep/discard with git-snapshot revert; `AGENTS.md` as the single immutable workspace guide (cross-tool); 3-tier guardrails (Input / Runtime / Output); `solosquad goal verify` for determinism checks |
| v0.5 (released) | Workflow maker + frontmatter routing | Messenger-native author loop (`_meta/workflow-maker`); 4-channel router (`slash > explicit > keyword > freq`) with paperclip budget envelope; repo analyzer (4-label classification + incremental ledger); 25 SKILL.md with Anthropic-compatible frontmatter; spec-gate ↔ `goal.md` integration |
| v0.6 (planned) | Topology stabilization + memory archive | `agents/{team}/KNOWLEDGE.md` co-location, `<org>/agent-profile.yaml` + `core/` + `domain/`, `.solosquad/knowledge/`, FTS5 cold archive |
| **v1.0** (planned) | **Formal launch** | Stable API · breaking-change policy starts |
| v1.1 (planned) | Dashboard interaction | Companion web dashboard (separate repo) |
| v1.2 (planned) | Knowledge ontology | Graph backend + MCP external connectors (Notion, Obsidian, etc.) |

Decision log: [`docs/plan/product-roadmap.md`](docs/plan/product-roadmap.md) §4.

---

## Multi-Workspace

Want both Slack and Discord, or separate personas? Create multiple workspaces:

```bash
~/solopreneur/      # Slack bot, business persona
~/personal-lab/     # Discord bot, hobby persona
```

Each has independent `.env`, tokens, memory, and messenger account. They run side-by-side without interference. (Note: a single workspace is bound to one messenger — the v0.1.x `MESSENGER=discord,slack` syntax is no longer supported.)

---

## Repository Layout

Source tree (this repo):

```
package.json                      → npm package config (v0.5.0)
tsconfig.json                     → TypeScript config
bin/solosquad.ts                  → CLI entry point
AGENTS.md                         → canonical workspace guide (v0.4 — immutable, cross-tool)
CLAUDE.md                         → 3-line redirect to AGENTS.md (backward-compat)
src/
  cli/                            → CLI commands (init, bot, schedule, doctor, pm, workflow,
                                     goal, agent, analyze, add, sync, migrate, rollback, …)
  bot/                            → pm-runner, claude-process, session-store, events,
                                     agents-builder, workflow-reconciler, slash-commands,
                                     git-snapshot, skill-parser, agent-router,
                                     meta-skill-scanner, skill-author, author-budget
  engine/                         → v0.4 autonomous engine — goal-parser, agents-md-loader,
                                     guards, evaluator, tracker, reconciliation, goal-runner
  analyze/                        → v0.5 repo analyzer — scanner, classifier, ledger,
                                     workflow-matcher, report-writer, applier
  messenger/                      → Discord / Slack adapters
  scheduler/                      → Cron-based routines + memory append
  util/                           → Config, paths, logger, platform, cost helpers
  migrations/                     → Versioned workspace migration scripts (0.1.x → 0.5.0)
assets/                           → Bundled defaults (copied to user workspace on `solosquad init`)
  agents/{team}/{agent}/SKILL.md  → 25 specialist definitions (v0.5 frontmatter)
  agents/_meta/workflow-maker/    → v0.5 author loop meta-skill + references
  agents/_teams/{team}/TEAM_KNOWLEDGE.md  → Shared team craft (relocates to agents/{team}/KNOWLEDGE.md in v0.6)
  core/                           → Owner profile, principles, voice (universal layer)
  routines/                       → Routine prompts (6 routines incl. v0.3 pm-compaction)
  orchestrator/SKILL.md           → PM role definition (v0.3 + v0.4 goal-md-spec append)
  templates/                      → PRD / handoff / status / goal.md / AGENTS.md / workflow.yaml
deploy/
  docker/                         → Container deployment (Dockerfile + compose + README, v0.5)
docs/
  manual/master-guide.html        → 📖 Canonical user manual (10 sections)
  plan/                           → Release planning + decision log (v0.1 → v1.2)
  plan/product-roadmap.md         → Master roadmap + decision log §4
  plan/architecture.md            → Internal system design
  plan/cloud-deployment.md        → VPS + systemd setup
  poc/                            → v0.3 PoC integration scripts (archive)
  reference/                      → Design vocabulary sources
  trend-record/                   → Peer-project comparisons
```

End-user workspace (created by `solosquad init`, evolved through migrations):

```
~/solosquad-workspace/
├── AGENTS.md                            (v0.4 — single persistent guide)
├── .solosquad/
│   ├── workspace.yaml                   (timezone, briefings, pm, skill_loader, author)
│   ├── .env                             (messenger tokens, MESSENGER, …)
│   ├── agents/{team}/{agent}/SKILL.md   (v0.5 — bundled 25 + frontmatter)
│   ├── agents/_meta/workflow-maker/     (v0.5 — author loop meta-skill)
│   └── routines/, core/                 (optional user overrides)
├── .agents/                             (v0.5 — optional workspace-wide SKILL override)
└── <org-slug>/
    ├── .org.yaml
    ├── .agents/                         (v0.5 — optional per-org SKILL override, highest priority)
    ├── memory/
    │   ├── signals.jsonl · experiments.jsonl · decisions.jsonl
    │   ├── author-costs.jsonl           (v0.5 — author loop cost log)
    │   ├── pm-skills/                   (v0.3 — PM compaction externalization)
    │   └── routine-logs/
    ├── workflows/<wf-id>/               (v0.3 — _status.yaml, _events.jsonl, stages)
    ├── goals/<goal-id>/                 (v0.4 — goal.md, results.tsv, _best.json, _last-run.md)
    ├── .solosquad/
    │   ├── sessions/<user>.json         (v0.3 PM session id + cost; v0.5 adds freqCooldowns)
    │   ├── snapshot.git                 (v0.3 — bare repo for memory/ + workflows/)
    │   ├── analysis/                    (v0.5 — analyze-repo Markdown reports)
    │   └── analysis-ledger.yaml         (v0.5 — incremental ledger, path + SHA256[:12])
    ├── repositories/<repo>/             (Layer 2 — user product code)
    ├── slack/  or  discord/             (channel config)
    └── product/                         (per-org artifacts)

~/.solosquad/agents/                     (v0.5 — user-global SKILL override across workspaces)
```

---

## References (peer-project inspirations)

| Project | Adopted pattern |
|---|---|
| [Anthropic Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) | initializer + coding agent split; context compaction; subagent spawning |
| [gstack](https://github.com/garrytan/gstack) | slash chain protocol — direct source for v0.3 `/think /plan /build /review /ship` |
| [Hermes Agent](https://github.com/nousresearch/hermes-agent) | hot+cold FTS5 memory archive, trajectory → skill auto-summary (planned for v0.6) |
| [autoresearch](https://github.com/karpathy/autoresearch) | metric gate + git keep/rollback loop (adopted in v0.4) |
| [phuryn/pm-skills](https://github.com/phuryn/pm-skills) | auto-load + slash dual-trigger SKILL routing (adopted in v0.5 4-channel router) |
| [OpenClaw](https://github.com/openclaw/openclaw) | npm publishing + `update` / `doctor` CLI patterns |

Explicitly rejected as over-engineered for solo founders: 3-repo physical splits, LangGraph v3 graph orchestration, MCP-based internal skill registries, Vector + Graph DB hybrids. See `docs/plan/product-roadmap.md` §4 for the reasoning.

---

## Contributing

Active solo development. Issues and pull requests welcome, but the API is unstable until v1.0. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

MIT — see [`LICENSE`](LICENSE).
