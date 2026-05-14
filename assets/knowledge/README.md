# Workspace Knowledge Layer — Authoring guide

> v0.6 §2.3 — bundled starter. Workspace-scope, *role-orthogonal* craft.

This folder is the *workspace-wide* knowledge layer that the SoloSquad
spawn-assembler injects (selectively) into every specialist invocation as
layer **[1]** of the 8-layer JIT context:

```
[1] assets/knowledge/   +   .solosquad/knowledge/   ← you author this
[2] agents/{team}/KNOWLEDGE.md
[3] agents/{team}/{agent}/SKILL.md
[4] <org>/core/
[5] <org>/agent-profile.yaml
[6] <org>/domain/
[7] <org>/workflows/<id>/_handoff.md slice
[8] target_repo context (when set)
```

`.solosquad/knowledge/` (your workspace) overrides this bundled folder.
Both contribute — the user-local files come first.

## What lives here

- **Decision frameworks** that you reuse across products / agents
  - e.g. `decision-frameworks/lean-canvas.md`, `porter-five-forces.md`,
    `ltv-cac.md`
- **Glossary** — domain vocabulary that any agent might encounter
  (`glossary.md`)
- **References** — short summaries of papers / posts / books you keep
  returning to (`references/...`)

## What does *not* live here

- **Agent role definitions** — those are in `assets/agents/{team}/{agent}/SKILL.md`
  (immutable, ships with the npm package)
- **Team-shared knowledge** — `assets/agents/{team}/KNOWLEDGE.md` (v0.6 §2.1)
- **Org-specific tone / priorities** — `<org>/core/` + `<org>/agent-profile.yaml`
  (v0.6 §2.2)
- **Org domain knowledge** (market, customers, product specifics) —
  `<org>/domain/` (v0.6 §2.2)

## Selective injection — keyword matching

Every file you drop in here is *not* automatically injected on every spawn.
The assembler keyword-matches the file body against the user's task
description; only files with at least one keyword hit are kept. When the
8-layer total exceeds `workspace.yaml.spawn.max_context_tokens` (default
80,000), zero-hit files are dropped first.

## File format

Plain markdown. No frontmatter required. Use H2 headings as keyword
anchors — they raise the recall on partial matches.

## Where to add a new file

```
<workspace>/.solosquad/knowledge/
├── decision-frameworks/
│   ├── lean-canvas.md
│   └── porter-five-forces.md
├── glossary.md
└── references/
    └── ...
```

Run `solosquad doctor` to verify the workspace knowledge layer is
discoverable.
