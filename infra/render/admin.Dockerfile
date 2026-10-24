# Public-demo image for apps/admin, used by render.yaml. Same as infra/docker/admin.Dockerfile
# minus the BuildKit cache mount, which Render's builder does not accept as written.
#
# NEXT_PUBLIC_* values are inlined at build time, so they arrive as build args (Render
# passes the service's env vars to the Docker build).
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/admin/package.json ./apps/admin/
COPY packages/shared-types/package.json ./packages/shared-types/
RUN pnpm install --frozen-lockfile --filter @cpe/admin... --filter .

COPY packages/shared-types ./packages/shared-types/
COPY apps/admin ./apps/admin/

ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_DEMO_MODE=true
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_DEMO_MODE=$NEXT_PUBLIC_DEMO_MODE
RUN pnpm --filter @cpe/shared-types build && pnpm --filter @cpe/admin build

FROM node:22-alpine
ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/admin/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build --chown=node:node /app/apps/admin/public ./apps/admin/public
USER node
EXPOSE 3001
CMD ["node", "apps/admin/server.js"]
