---
paths:
  - "src/**/*.ts"
---

# Cross-Platform Rules

- Never use `which` command — use `commandExists()` from `src/util/platform.ts`
- Never hardcode `/` for paths — use `path.join()` or `path.resolve()`
- Always normalize file content with `normalizeLine()` before splitting by `\n`
- Use `os.homedir()` not `~` or `$HOME`
- Docker is optional — never `process.exit(1)` for missing Docker
- Use `npmGlobalInstallCmd()` for npm global install commands (handles sudo)
