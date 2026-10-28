# solosquad (v2 Python engine)

The v2 rewrite of SoloSquad (ideation `docs/ideation/260803-solosquad-architecture-redesign.md`
decision 1). Plan: [`docs/prd/v2.0.0_orchestration-and-harness-platform.md`](../docs/prd/v2.0.0_orchestration-and-harness-platform.md).

The v1.4.3 TypeScript code at the repository root keeps running until v2.0.0 ships; this
directory does not touch it.

```bash
cd python
uv sync                      # Python runtime + dependencies
uv run pytest                # tests (includes the v1.4.3 parser golden test)
uv run ruff check . && uv run ruff format --check .
uv run mypy
uv run solosquad assets      # parse the bundled agents/skills/teams/crons
uv run solosquad init ./my-company --org moa-living --workspace hq
```

The golden snapshot `tests/golden/assets-v1.4.3.json` is produced by the TS parsers:

```bash
npx tsx scripts/dump-asset-golden.ts > python/tests/golden/assets-v1.4.3.json   # from the repo root
```
