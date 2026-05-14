# Clarification defaults (§5.2 fallback)

When the user can't answer one of the §5.2 questions, accept a sensible default and explicitly tell them it's editable later (i.e. by editing `<org>/.agents/<team>/<slug>/SKILL.md` directly or rerunning the author loop with `--revise`).

Never block the conversation waiting for an answer the user doesn't have. The author loop must terminate in ≤ 2 turns of clarification (§13 success criterion: ≥ 80% complete in 2 turns).

## Defaults table

| Question | If user says "잘 모르겠어" / skips | Default | Rationale |
|---|---|---|---|
| Inputs? | unclear / "그냥 자동으로" | `inputs.required: [data_source]` | Every SKILL needs at least one input pointer; `data_source` is a generic-enough placeholder. |
| Output format? | unclear | `outputs: ["report.md"]` | Markdown is universally readable in `#owner-command` + grep-able on disk. |
| Cadence? | unclear / "그때그때" | `triggers.explicit: true` only (no cron) | User triggers manually via `/agent <slug>` or natural-language match. Adding a cron is a separate edit. |
| Team? | unclear | `team: strategy` | Most "monitor / report / analyze" intents land here; user can move the folder later. |
| `loop_mode`? | not mentioned | omit (no spec-gate) | Default flow is *not* spec-gate. Only set when user explicitly described a completion condition. |

## When to push back instead of defaulting

Two cases where you should **not** silently accept a default — surface the ambiguity:

1. **The clarification answer is contradictory.** Example: user says "출력은 JSONL인데 사람이 읽을 거예요". Ask one focused follow-up: "JSONL은 기계 처리용이라 사람이 읽기 어려울 수 있습니다. Markdown으로 변경할까요, JSONL을 유지할까요?"

2. **`stateful: true` is implied.** User says "이전 결과를 기억해서 계속 누적해줘" — that's a `stateful` request. v0.5 forbids creating stateful SKILLs. Explain: "v0.5에선 매 호출이 독립적인 SKILL만 만들 수 있어요. 누적은 `<org>/memory/`에 직접 append하는 방식으로 처리합니다." Then redirect to a stateless design.

## Conservative defaults are reversible

The user can always:

- Edit the SKILL.md directly (it's plain Markdown + YAML).
- Rerun `workflow-maker` with the same intent string + a `--revise <slug>` flag (S5).
- Run `solosquad agent validate <path>` to check their edits.

So defaulting is low-cost. Blocking on perfect clarity is high-cost (breaks the ≤ 2 turn budget).
