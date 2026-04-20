---
name: build-test
description: Build TypeScript and run smoke test (global install + doctor)
allowed-tools: Bash(npm:*), Bash(npx:*), Bash(solosquad:*)
---

Full build and verification:

1. Type check: `npx tsc --noEmit`
2. Build: `npm run build`
3. Verify dist output exists: `ls dist/bin/solosquad.js`
4. Report results
