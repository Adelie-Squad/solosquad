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
