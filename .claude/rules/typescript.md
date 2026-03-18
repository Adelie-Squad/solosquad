---
paths:
  - "src/**/*.ts"
  - "bin/**/*.ts"
---

# TypeScript Rules

- Target: ES2022, strict mode enabled
- Module: Node16 (ESM with .js extensions in imports)
- Use `const` by default, `let` only when reassignment is needed
- Avoid `any` — use generics, `unknown`, or proper types
- Use `path.join()` for all file paths (cross-platform)
- Use `normalizeLine()` from `src/util/platform.ts` when parsing text files
- Run `npx tsc --noEmit` to verify type correctness
