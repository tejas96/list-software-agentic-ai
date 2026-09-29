# One Dockerfile, three images:  --target api | worker | web
#   docker build --target api -t lsa-api .
# The web image bakes the API address used by its proxy at build time (API_INTERNAL_URL).
# NODE_IMAGE can point at a registry mirror, e.g. mirror.gcr.io/library/node:22-bookworm-slim.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate
WORKDIR /repo

# ---------------------------------------------------------------- build all
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=${API_INTERNAL_URL}
RUN pnpm build
# Self-contained production folders for the Node services (workspace packages included).
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @lsa/api deploy --prod --legacy /out/api && \
    pnpm --filter @lsa/worker deploy --prod --legacy /out/worker

# ---------------------------------------------------------------------- api
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Database migrations and the first admin:  node node_modules/@lsa/db/dist/migrate.js | seed.js
CMD ["node", "dist/main.js"]

# ------------------------------------------------------------------- worker
FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production WORKSPACES_DIR=/data/workspaces
# git for repository checkouts; agents run allow-listed commands (git, node, npm) in the sandbox.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/* \
    && corepack enable && mkdir -p /data/workspaces && chown -R node:node /data
WORKDIR /app
COPY --from=build --chown=node:node /out/worker ./
USER node
VOLUME ["/data/workspaces"]
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------- web
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
