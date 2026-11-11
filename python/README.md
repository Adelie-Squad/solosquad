# solosquad (v2 Python engine)

The v2 rewrite of SoloSquad (ideation `docs/ideation/260803-solosquad-architecture-redesign.md`
decision 1). Plan and implementation status: [`docs/prd/v2.0.0_orchestration-and-harness-platform.md`](../docs/prd/v2.0.0_orchestration-and-harness-platform.md) §9.

The v1.4.3 TypeScript code at the repository root keeps running until v2.0.0 ships; this
directory does not touch it.

## Run a company locally

```bash
cd python && uv sync
uv run solosquad init ~/clients/moa --org moa-living                 # core + org + office
uv run solosquad connections add claude-max --kind subscription \
    --harness claude-code --models sonnet,haiku -s ~/clients/moa       # log in once with `claude`
uv run solosquad connections add router --kind api_key --harness opencode \
    --provider openrouter --models openrouter/gpt-5 \
    --secret-env OPENROUTER_API_KEY -s ~/clients/moa
uv run solosquad connections set-secret router -s ~/clients/moa
uv run solosquad chat -s ~/clients/moa                               # talk to Chief
uv run solosquad serve -s ~/clients/moa                              # or run 24/7 …
uv run solosquad service install -s ~/clients/moa                    # … as an OS service
uv run solosquad agents watch -s ~/clients/moa                       # follow the agents
```

## Demo server (decision 62)

A demo server is the same engine with `core/server.yaml` `mode: demo` — scripted agents (the
`scripted` harness, no model call), one copy of the example company 모아 리빙 per demo account,
settings read-only (`403 demo_read_only`). Set-up, issuing, reset and export:
[`docs/runbooks/demo.md`](../docs/runbooks/demo.md).

```bash
uv run solosquad demo init ~/demo --marketing-url https://<marketing site>
uv run solosquad demo issue --id samsungDemo --inquiry <inquiry id> --company-no <number> \
    --days 14 --locale ko -s ~/demo
uv run solosquad serve -s ~/demo
uv run solosquad demo usage --all --format csv -s ~/demo
```

### 데모 모드 — 수집하는 데이터

Per demo account, in the demo server's `core.db` (`demo_usage` · `demo_sessions` — apart from
the copies, so a reset never removes them; removed `usage_keep_days` (365) after the account
expired). The visitor is told on screen ("데모에서 어떤 화면을 봤는지 기록해요. 직접 쓴 글은
기록하지 않아요."); the consent text of the marketing inquiry form must name it (PRD §3.6.3
고지 — `[검토 필요]`).

| event | kept | never kept |
|---|---|---|
| `login` · `logout` · `session_end` · `login_refused` | time · session number (a hash prefix) · language · device (desktop · phone) · session length | IP address · user agent string · browser fingerprint |
| `page_view` | the screen as a path pattern (`/o/:org/w/:ws/office`) · time on it | the query string · ids |
| `scenario_start` · `scenario_step` · `scenario_done` | workflow · step number · how it started (login · button · prompt · restart) · how it ended | — |
| `approval_click` | card category · tier (owner · team) · approved / declined | — |
| `prompt` | suggestion number · whether a script matched · length | **the text typed** (a visitor may type their real company's data) |
| `blocked_click` | the locked setting's name | — |
| `reset` | 처음 상태로 (button) · nightly · CLI | — |

The demo server keeps the inquiry id only — names and contacts stay in the marketing
site's D1, and the two are joined on the agency's own machine (`demo usage --format csv`).

## Develop

```bash
uv run pytest                          # includes golden tests vs v1.4.3 parsers and LangGraph
SOLOSQUAD_LIVE=1 uv run pytest tests/test_live.py tests/test_harness.py   # real Claude Code (tiny haiku calls)
uv run ruff check . && uv run ruff format --check . && uv run mypy
```

| package | what |
|---|---|
| `graph` | in-house LangGraph (StateGraph, Pregel, Command/Send, interrupt, checkpointers) |
| `swarm` | in-house langgraph-swarm (create_swarm, handoff tools, active_agent) |
| `harness` | the five-method backend contract + claude-code · codex · opencode · lite |
| `company` | an org's agents as one swarm; the agent node |
| `routing` | connections → office policy → Chief's policy; slots, limits, budgets |
| `runtime` | threads · runs · crons, crash recovery |
| `context` | resolve, prompt assembly, history injection, ledger |
| `server` · `client` · `cli` | local JSON API + SSE, and the command line |

The parser golden snapshot comes from the TS code: `npx tsx scripts/dump-asset-golden.ts > python/tests/golden/assets-v1.4.3.json`.
