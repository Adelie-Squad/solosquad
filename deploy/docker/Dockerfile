# SoloSquad v0.5+ container image.
# Build context = repo root (../.. from this file). See docker-compose.yml.

FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI + solosquad globally from npm (latest published).
# Rebuild the image to pick up new versions: `docker compose up -d --build`.
RUN npm install -g @anthropic-ai/claude-code solosquad

WORKDIR /workspace

# Volume mounts expected from the host (set in docker-compose.yml):
#   /workspace             — the solosquad workspace (core/, routines/, agents/,
#                            templates/, orchestrator/, .env, <org>/, memory/, ...)
#   /repos                 — product repos tree
#   /root/.claude          — Claude Code CLI auth
#   /root/.solosquad       — v0.5 user-global SKILL override (3-tier tier 2)
#   /root/.solosquad-backups — v0.2.3 workspace backups

ENV NODE_ENV=production \
    TZ=Asia/Seoul

CMD ["solosquad", "bot"]
