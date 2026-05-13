# AGENTS.md

> **Canonical workspace guide.** All AI tools (SoloSquad, Codex, Aider,
> Cursor, modern Claude Code) read this file. **Human-edited only — no AI
> agent may modify this file.** SoloSquad does not maintain a separate
> CLAUDE.md; if one exists from a previous setup, it is no longer used.

## Project

{{Your workspace name and one-line description. E.g.:
"Acme Inc — solo founder workspace, focusing on B2B SaaS for SMBs."}}

## Tone & Style

{{Writing style for AI-generated content. E.g.:
- "Plain language, no jargon. Sentences ≤ 20 words."
- "Korean is primary, English allowed in code/technical terms."
- Avoid: marketing fluff, hyperbole, AI-cliché phrases.}}

## Build / Test

{{Commands the user runs to verify changes. E.g.:
- npm test
- npm run build
- pnpm typecheck}}

## Code Conventions

{{Language-specific rules. E.g.:
- TypeScript strict mode, no `any`
- Functional React components, no class components
- Prettier + ESLint config in `.prettierrc` / `.eslintrc.json`}}

## SoloSquad v0.4 — Autonomous Goal Conventions

These rules apply when SoloSquad runs an autonomous goal via
`solosquad goal run <goal-id>`. The engine enforces them; agents cannot
relax them mid-run.

### Immutable paths
<!-- Paths under here will NOT be modified by any autonomous spawn. -->
- `src/engine/**`
- `assets/templates/results.tsv`
- `assets/templates/goal.md`
- `AGENTS.md`
- `<org>/goals/<goal-id>/goal.md`
- `<org>/goals/<goal-id>/results.tsv`

### Modifiable paths
<!-- Paths under here MAY be modified by autonomous spawns. Each goal.md
     may further narrow this set with a "Modifiable Paths Override" section. -->
- `<org>/workflows/<wf-id>/`
- `<org>/memory/`

### External side-effects
<!-- Forbidden during autonomous runs. Listed entries match by substring
     in the spawn event trail. -->
- messenger direct send (results flow through morning-brief routine, not direct DM)
- email
- payment
- external API mutating call

<!-- Whitelist for outbound HTTP: comma- or space-separated hosts after the
     "external HTTP whitelist:" prefix. Empty whitelist means external HTTP is
     blocked entirely. -->
- external HTTP whitelist:

### Guardrail thresholds
- stage_timeout_seconds: 600
- consecutive_discard_limit: 5
- cost_cap_warning: 90%
