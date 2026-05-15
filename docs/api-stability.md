# SoloSquad API Stability Policy

> **Status:** Documented in v0.8.1, promise effective at v1.0.
>
> Until v1.0, SoloSquad reserves the right to bump any `schema_version`
> field without a deprecation period. **CHANGELOG.md** records every bump.
> From v1.0 onward, the rules in this document are a public promise.

This document defines the on-disk schema surface SoloSquad guarantees to
external users — workspace authors, archive tooling vendors, and other AI
tools that read SoloSquad files (Claude Code, Codex, Aider, etc.).

The intent is narrow: tell users **which files can break**, **when they
can break**, and **how to detect a break before runtime**.

---

## 1. Six `schema_version` surfaces

Each row below is an independently versioned schema. Bumping one does not
oblige the others to bump.

| Schema | Path / field | Current | Bump rule |
|---|---|---|---|
| Workspace version | `<workspace>/.solosquad/workspace.yaml` → `version` | 0.8.x | Tracks the SoloSquad CLI SemVer. 0.x = free-form. v1.0+ = breaking changes require a major bump. |
| Org metadata | `<workspace>/<org>/.org.yaml` → `schema_version` | 1 | Field *addition* is a minor SoloSquad release and reuses the same `schema_version`. Field *removal* or type change bumps `schema_version`. |
| Org agent profile | `<workspace>/<org>/agent-profile.yaml` → `schema_version` | 1 | Same as org metadata. The narrowing-only invariant is enforced by the profile validator and is **orthogonal** to schema_version — narrowing rules don't change with a schema bump. |
| SKILL frontmatter | `assets/agents/<team>/<name>/SKILL.md` → `schema_version` | 1 (introduced v0.8.1) | Same as org metadata. v0.8.1 backfilled this field across 26 bundled SKILL.md files. |
| Archive metadata | `archive.zip/archive.yaml` → `schema_version` | 1 | Same as org metadata. Bumps must also update `archive.yaml.import_compat.max_schema_version_supported` so old CLIs can refuse incompatible archives. |
| Archive manifest | `archive.zip/manifest.tsv` first comment line `# schema_version=N` | 1 | Same as org metadata. The manifest reader (`src/lifecycle/archive-reader.ts`) refuses to import an unknown manifest schema. |

---

## 2. Deprecation periods

| Period | Policy |
|---|---|
| **v0.x.x (current)** | Bump any `schema_version` at any time. CHANGELOG.md records the bump and the v0.x → v0.x+1 migration script handles the rewrite. No public deprecation promise. |
| **v1.x.x** | Bumping `schema_version` is allowed only on a SemVer **minor** release. The previous schema must remain *readable* for one additional minor release. Example: v1.2 introduces `schema=2` → v1.3 must still read `schema=1`. v1.4 may drop the `schema=1` read path. |
| **v2.0 onward** | Major releases may permanently refuse older `schema_version`. Migration tooling is provided for users who skipped intermediate releases. |

The two-minor window is intentional: it gives users a full release cycle
to run `solosquad migrate --apply` between schema bumps without
forcing immediate upgrades.

---

## 3. Detection

| Surface | How users detect an incompatible version |
|---|---|
| Workspace | `solosquad migrate --dry-run` walks the migration registry and reports if the workspace is behind the CLI. The CLI also prints a banner on every command when workspace `< cli` (see `src/cli/index.ts:printLayoutMismatchBanner`). |
| Archives | `solosquad archive verify <zip>` confirms the archive `schema_version`, `archive_format`, and `import_compat.min_solosquad_version` against the current CLI. The `import` command refuses to proceed if verify fails. |
| SKILL.md | `solosquad agent validate --all --corpus` warns when `schema_version` is missing (v0.8.x) and will fail in v0.9 once the field is fully required. |
| Org metadata / agent profile | The bot/scheduler boot-time loader (`src/util/config.ts`) refuses to start when `.org.yaml.schema_version` exceeds the CLI's known range. |

---

## 4. What is NOT covered

This policy covers schema surfaces only. It is silent on:

- **CLI command names + flags** — those follow SemVer at the *CLI* level
  (workspace version). New flags are minor; removing a flag is major.
- **Messenger channel layout** — owned by `<org>/.org.yaml.messenger`,
  outside the schema_version system.
- **Routine prompt bodies** — `assets/routines/*.md` are content, not
  schema; user edits are preserved across upgrades by the migration.
- **Bundled SKILL.md *bodies*** — only the YAML frontmatter is schema'd.
  The body markdown is content and is replaceable on every release.

---

## 5. Forward-compat helpers

The codebase ships a few helpers callers can lean on:

- `src/bot/skill-parser.ts` — preserves unknown frontmatter keys in `extra`
  so a newer SKILL.md round-trips through an older parser without losing
  data. The validator emits a warning for unknown keys but does not fail.
- `src/lifecycle/archive-reader.ts:checkSchemaCompat()` — single source of
  truth for archive-side compatibility checks. `solosquad import` and
  `solosquad archive verify` both call into it.
- `archive.yaml.import_compat.max_schema_version_supported` — every
  archive declares the *highest* manifest schema_version the producing
  CLI knew about. A consumer can refuse archives that exceed its own
  knowledge.

---

## 6. References

- `docs/plan/v0.8.1-security-lifecycle-pair.md` §6 — original derivation.
- `CHANGELOG.md` — every schema bump recorded under the introducing
  version's entry.
- `src/migrations/scripts/` — chronological record of every schema bump
  shipped to date.
