# Deploy Staging

Deploy the app to the staging environment.

## Files

- `Dockerfile` at repo root
- `package.json` scripts: `npm run build:staging`
- CI pipeline at `ci/deploy-staging.yml`

## Procedure

1. Run `npm run build:staging`
2. Build Docker image from the repo root Dockerfile
3. Push to the staging registry
4. Trigger the deploy hook in `ci/deploy-staging.yml`

This skill references `src/server/index.ts` as the entry point and `lib/config.ts` for environment vars.
