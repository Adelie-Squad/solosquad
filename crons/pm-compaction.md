# PM Compaction Routine (v0.3.0+)

> You are running the daily PM compaction job. This is a background routine — no user is watching. Be brief, factual, and skip anything that would burn tokens for no gain.

## Goal

Externalize completed workflows so the long-lived PM session can forget them without losing recall. The PM keeps active workflows in its thread; you move *completed* ones to disk as compact skill notes.

## Inputs

You are running in `<workspace>/<org>/` cwd. Read:
- `workflows/*/`  — all workflow directories. Skip any whose `_status.yaml` does NOT have every stage `status: completed`. Only fully completed workflows are eligible.
- For each eligible workflow:
  - `_status.yaml`  — the structure
  - `_events.jsonl` — the spawn history
  - `stage-*/_handoff.md` — the per-stage summaries
  - `PRD.md` — the original goal

## Output

For each eligible workflow, write a single markdown file to:

```
memory/pm-skills/<workflow-id>.md
```

(create `memory/pm-skills/` if it doesn't exist)

Then **append** one line per compacted workflow to:

```
memory/pm-skills/_recent.md
```

Format of each line:

```
- <ISO-timestamp> compacted <workflow-id> → memory/pm-skills/<workflow-id>.md
```

The PM session reads `_recent.md` at the start of every turn (per its
SKILL.md rule) and clears entries it has acknowledged. Do not delete
`_recent.md` yourself — only append.

Format the file as 2–4 short paragraphs covering:

1. **Goal**: one sentence about what the workflow was trying to achieve (from PRD).
2. **What was done**: 3–5 bullets summarizing the stages, each with the agent and the key artifact produced.
3. **Decisions made**: the load-bearing decisions from the handoffs — what was chosen and *why*. Skip routine stuff.
4. **Open questions / follow-ups**: any unresolved items from the latest handoff.

Keep the whole file under 400 words. The future PM will read this file when it needs to recall the workflow; we want signal, not transcript.

## Skip rules

- Skip workflows whose `memory/pm-skills/<wf-id>.md` already exists AND is newer than the workflow's `_status.yaml`. (Already compacted.)
- Skip workflows with 0 completed stages.
- Skip workflows older than 180 days — those are cold and the PM can re-read raw files if asked.

## What you do NOT do

- Do NOT modify `_status.yaml`, `_events.jsonl`, or `_handoff.md`. They're the source of truth.
- Do NOT generate JSON blocks. This routine has no JSONL memory target.
- Do NOT call any subagent via the Task tool — you have everything you need from the files.
- Do NOT post status updates to the user. The scheduler logs success/failure on its own.

## Output format

After processing, print a single summary line to stdout:

```
Compacted N workflow(s): <wf-id-1>, <wf-id-2>, …
```

If there were no eligible workflows, print:

```
No eligible workflows to compact.
```

That's the entire output. No commentary.
