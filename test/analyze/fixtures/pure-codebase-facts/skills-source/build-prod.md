# Build Production

Build the production bundle.

## Inputs

- `package.json` at repo root
- `tsconfig.json`
- Source in `src/`

## Procedure

1. `npm run build` — emits to `dist/`
2. Check `dist/index.js` exists
3. Bundle Docker image from the production `Dockerfile.prod`

References:
- `src/index.ts` — entry point
- `lib/runtime.ts` — runtime helpers
- `ci/deploy-prod.yml` — CI pipeline
