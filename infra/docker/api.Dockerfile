# Production image for apps/api.
#
# Build from the REPO ROOT so the pnpm workspace and packages/shared-types are in
# the build context:
#   docker build -f infra/docker/api.Dockerfile -t cpe-api .

# ---- base -------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- dependencies -----------------------------------------------------------
# Only the manifests are copied first, so a source-only change reuses this layer.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/prisma ./apps/api/prisma/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @cpe/api... --filter .

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types/
COPY apps/api ./apps/api/
RUN pnpm --filter @cpe/shared-types build \
 && pnpm --filter @cpe/api exec prisma generate \
 && pnpm --filter @cpe/api build

# ---- migrate ----------------------------------------------------------------
# A SEPARATE image (built with `--target migrate`) that keeps the Prisma CLI — the
# runtime image below prunes it away. The Phase 15 migration Job runs THIS image with a
# single `prisma migrate deploy`, as a controlled, one-shot step before the app rollout.
# It is never run on pod boot (that would migrate N times across N replicas).
FROM build AS migrate
RUN addgroup -S nodejs -g 1001 && adduser -S nestjs -u 1001 -G nodejs \
 && chown -R nestjs:nodejs /app/apps/api
USER nestjs
WORKDIR /app/apps/api
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ---- prune ------------------------------------------------------------------
# Strip dev dependencies (incl. the Prisma CLI) from the store the runtime copies.
FROM build AS prune
# `pnpm prune` takes no --filter in pnpm 11, so reinstall production deps only. That
# replaces node_modules, including the generated Prisma client (and the CLI that made it),
# so the generated client is set aside first and put back into the fresh @prisma/client.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    cp -rL "$(find node_modules/.pnpm -maxdepth 3 -type d -path '*/@prisma+client@*/node_modules/.prisma' | head -1)" /tmp/prisma-generated \
 && CI=true pnpm install --frozen-lockfile --prod --ignore-scripts --filter @cpe/api... --filter . \
 && for dir in node_modules/.pnpm/@prisma+client@*/node_modules; do \
      rm -rf "$dir/.prisma" && cp -r /tmp/prisma-generated "$dir/.prisma"; \
    done \
 && rm -rf /tmp/prisma-generated

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Never run the API as root.
RUN addgroup -S nodejs -g 1001 && adduser -S nestjs -u 1001 -G nodejs

COPY --from=prune --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nestjs:nodejs /app/packages/shared-types ./packages/shared-types
COPY --from=build --chown=nestjs:nodejs /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build --chown=nestjs:nodejs /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=nestjs:nodejs /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=nestjs:nodejs /app/apps/api/package.json ./apps/api/

USER nestjs
WORKDIR /app/apps/api
EXPOSE 3000

# Migrations are NOT run here. `prisma migrate deploy` is a separate, reviewed CI
# step (see Phase 15): a container that migrates on boot will happily run a
# destructive migration N times across N replicas during a rollout.
CMD ["node", "dist/main.js"]
