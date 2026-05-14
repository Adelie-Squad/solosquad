# Deploy Staging

Deploy to staging.

## Files

- `package.json`
- `Dockerfile`
- `src/server.ts`
- `lib/config.ts`
- `ci/deploy-staging.yml`

## Procedure

1. `npm run build:staging`
2. Build Dockerfile from repo root
3. Push to staging via `ci/deploy-staging.yml`
