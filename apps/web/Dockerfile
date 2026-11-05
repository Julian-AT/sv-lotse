FROM oven/bun:1.4.4 AS dependencies
WORKDIR /repo
COPY package.json bun.lock ./
COPY packages/brain/package.json packages/brain/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/protocol/package.json packages/protocol/package.json
COPY packages/knowledge/package.json packages/knowledge/package.json
COPY packages/guide/package.json packages/guide/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/evals/package.json packages/evals/package.json
COPY apps/web/package.json apps/web/package.json
RUN HUSKY=0 bun install --frozen-lockfile

FROM node:22-bookworm-slim AS build
WORKDIR /repo
COPY --from=dependencies /usr/local/bin/bun /usr/local/bin/bun
COPY --from=dependencies /repo /repo
COPY tsconfig.base.json biome.json ./
COPY packages ./packages
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run --filter @lotse/web build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/.next/migrator ./migrator
COPY --chown=node:node apps/web/scripts/container-entrypoint.sh ./container-entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
ENTRYPOINT ["/bin/sh", "/app/container-entrypoint.sh"]
