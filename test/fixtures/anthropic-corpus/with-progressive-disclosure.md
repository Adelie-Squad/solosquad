---
name: Progressive Disclosure Skill
description: A SKILL.md that follows Anthropic's progressive disclosure best practice — short body, details deferred to references/.
---

# Progressive Disclosure Skill

Keep the SKILL body concise. Reference docs live alongside in a
`references/` folder so the model loads them on demand rather than as part
of the always-on prompt.

## When to use

- Detailed procedure: see `references/procedure.md`.
- Worked examples: see `references/examples/`.

## Inputs

This skill expects `task_description` and an optional `target_repo` path.
