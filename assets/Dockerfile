FROM node:20-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git curl ca-certificates tzdata \
 && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI + solosquad globally from npm (latest published).
# Rebuild the image to pick up new versions: `docker compose up -d --build`.
RUN npm install -g @anthropic-ai/claude-code solosquad

WORKDIR /workspace

# Claude Code credentials are expected at /root/.claude (volume-mounted from host).
# Workspace assets (core/, routines/, agents/, templates/, orchestrator/, .env)
# and the product repos tree are also volume-mounted.

ENV NODE_ENV=production \
    TZ=Asia/Seoul

CMD ["solosquad", "bot"]
