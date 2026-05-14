# v0.6 Retrospective Stats Routine

> Deterministic ETL routine — *no LLM*. The scheduler invokes
> `src/scheduler/v06-stats-extract.ts:extractV06Stats()` for every org and
> writes the report. This file exists for parity with other routine prompts;
> there is no prompt body for an LLM to consume.

## Goal

Aggregate v0.5 operational data (workflows, handoffs, results.tsv,
author-costs.jsonl, analysis-ledger.yaml) into a single Markdown report so
the human author can write v0.6 §2 회고 본문 from *measurements*, not
guesses.

## Inputs

For each org under `<workspace>/`:
- `workflows/*/_status.yaml`        — stage status distribution (회고 #1)
- `workflows/*/stage-*/_handoff.md` — section frequency per agent (회고 #2)
- `goals/*/results.tsv`             — keep/discard per agent (회고 #3)
- `memory/author-costs.jsonl`       — SKILL author cycles + USD (회고 #4)
- `.solosquad/analysis-ledger.yaml` — 4-label 분포 (회고 #1 보조)

## Output

```
<org>/memory/v0.6-retrospective-stats-<YYYY-MM-DD>.md
```

A single Markdown file per org, idempotent on date.

## Schedule

Weekly — Sunday 22:00 (local timezone). The scheduler wires the cron via
`weeklyToCron("sunday", "22:00")` from `src/scheduler/routines.ts`.

## Skip rules

- Org has no `workflows/`, no `goals/`, and no `memory/author-costs.jsonl` →
  no report (graceful empty workspace per §2.5 도입 시점).
- Idempotency: re-running on the same date overwrites the day's report. The
  ETL itself is deterministic so the output diff is timestamp-only.

## What this routine does NOT do

- No LLM calls — the retrospective *body* is written by a human reading
  this report. See v0.6 §2.5 도입 시점.
- No mutation of v0.5 inputs (`author-costs.jsonl` etc. are append-only or
  user-owned).
- No JSONL memory targets — output is a Markdown report, not a memory feed.

## Output marker

After processing, the scheduler logs:

```
v06-stats-extract: <org> → memory/v0.6-retrospective-stats-<date>.md
  (workflows=N handoffs=H results=R authors=A ledger=L)
```
