---
schema_version: 1
goal_id: "{{goal-id-kebab}}"
org: "{{org-slug}}"
target_repo: null            # or "{{repo-slug}}" — single repo focus
cycle_unit: pipeline_pass
---

# Goal: {{1-line statement of what you're trying to achieve}}

{{1–3 lines: Acceptance criteria / Stop rule. What's "done"?}}

## Metrics

<!--
Each metric needs provenance (formula + source path).
Re-running evaluator on the same commit + same provenance must yield the
same value. Changing the formula requires a new metric name.
direction: maximize (keep iff value >= threshold) | minimize (keep iff value <= threshold)
-->

metrics:
  - name: "{{metric_name}}"
    formula: "{{one-line formula}}"
    source: "{{path/to/source.tsv | url}}"
    threshold: 0.7
    direction: maximize

## Pipeline

<!--
Static ordered list. Stage order is fixed within a cycle.
Each Task call in the PM session is one stage. Only the *prompt variation*
of each stage is dynamically proposed by the PM.
agent format: "<team>/<agent>" — e.g. "experience/desk-researcher".
-->

1. experience/desk-researcher: {{what stage 1 does — high-level instruction}}
2. growth/content-writer: {{what stage 2 does}}
3. engineering/creative-frontend: {{what stage 3 does}}

## Budget

time:
  hours: 8                   # or `cycles: 20`
cost:
  per_cycle_usd: 0.50
  total_usd: 5.00

## Termination

- All metrics reach threshold for 3 consecutive cycles (CONVERGED → ship candidate)
- Time / cost budget exhausted
- 5 consecutive discards (deadlock break)

## Modifiable Paths Override
# Optional — narrow AGENTS.md's modifiable_paths for THIS goal only.
# Leave the section absent to inherit AGENTS.md defaults.
#
# Example:
# - <org>/workflows/wf-{{goal-id}}-cycle-*/
# - <org>/memory/
