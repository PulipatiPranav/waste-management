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

# Strip dev dependencies from the store the runtime stage copies.
RUN pnpm --filter @cpe/api... --filter . prune --prod

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Never run the API as root.
RUN addgroup -S nodejs -g 1001 && adduser -S nestjs -u 1001 -G nodejs

COPY --from=build --chown=nestjs:nodejs /app/node_modules ./node_modules
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
