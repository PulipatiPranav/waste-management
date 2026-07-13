# Production image for apps/admin (Next.js standalone output).
#
# Build from the REPO ROOT:
#   docker build -f infra/docker/admin.Dockerfile -t cpe-admin .

# ---- base -------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# ---- dependencies -----------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/admin/package.json ./apps/admin/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @cpe/admin... --filter .

# ---- build ------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared-types ./packages/shared-types/
COPY apps/admin ./apps/admin/

# NEXT_PUBLIC_* values are baked into the client bundle at build time, so the API
# URL has to be supplied here rather than at container start.
ARG NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL

RUN pnpm --filter @cpe/shared-types build \
 && pnpm --filter @cpe/admin build

# ---- runtime ----------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
WORKDIR /app

RUN addgroup -S nodejs -g 1001 && adduser -S nextjs -u 1001 -G nodejs

# `output: 'standalone'` traces exactly the files the server needs, so no
# node_modules copy is required here.
COPY --from=build --chown=nextjs:nodejs /app/apps/admin/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=nextjs:nodejs /app/apps/admin/public ./apps/admin/public

USER nextjs
EXPOSE 3001

CMD ["node", "apps/admin/server.js"]
