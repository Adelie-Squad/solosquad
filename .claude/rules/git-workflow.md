---
paths:
  - "**/*"
---

# Git Workflow

- Branch naming: `feat/v{version}-{feature}` (e.g. `feat/v1.2-autonomous-engine`)
- Commit messages: imperative mood, explain "why" not "what"
- Never amend published commits
- Never force push to main
- **Pre-publish 4-docs gate** (v0.8.5 §2): before `npm publish`, all four
  release-critical docs must mention the new `package.json.version`:
  - `docs/plan/product-roadmap.md` — synergy / role / vision (new release row)
  - `docs/plan/architecture.md` — §13.x version section
  - `docs/manual/master-guide_ko.html` — Korean manual: version header + notes
  - `docs/manual/master-guide_en.html` — English manual: version header + notes
  Enforced by `npm run docs-check` (runs inside `prepublishOnly`).
