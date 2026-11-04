---
paths:
  - "**/*"
---

# Git Workflow

- Branch naming: `feat/v{version}-{feature}` (e.g. `feat/v1.2-autonomous-engine`)
- Commit messages: imperative mood, explain "why" not "what"
- Never amend published commits
- Never force push to main
- **Pre-publish docs gate** (v1.3.8 §3.5, `scripts/check-docs-freshness.ts`):
  before `npm publish`, the release-bound docs must mention the new
  `package.json.version`:
  - Required: `docs/roadmap.md` (new release row) · `docs/architecture.md`
    (§13.x version section) · `CHANGELOG.md` · `README.md` · `README.kr.md`
  - Conditional (checked only if the file exists): `manual/master-guide_ko.html`
    · `manual/master-guide_en.html` — version header + notes
  - A frozen PRD for the version exists in `docs/prd/` (`v<ver>_<name>.md`)
  - Invariant: `package.json` `files` must not expose anything under `docs/`
  Enforced by `npm run docs-check` (runs inside `prepublishOnly`, after
  `sync-version`).
