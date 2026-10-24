# Public-demo image for apps/api, used by render.yaml. NOT the production image.
#
# The production image (infra/docker/api.Dockerfile) prunes the Prisma CLI and never
# migrates on boot, because a real rollout runs migrations as a separate gated step. A
# single-instance demo has no such step, so this image keeps the dev toolchain and, on
# every boot: migrates, seeds the catalogue and demo activity (a quick no-op after the
# first boot), then starts the API.
#
#   docker build -f infra/render/api.Dockerfile -t cpe-api-demo .
FROM node:22-alpine
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared-types/package.json ./packages/shared-types/
COPY apps/api/prisma ./apps/api/prisma/
RUN pnpm install --frozen-lockfile --filter @cpe/api... --filter .

COPY packages/shared-types ./packages/shared-types/
COPY apps/api ./apps/api/
RUN pnpm --filter @cpe/shared-types build && pnpm --filter @cpe/api build \
 && chown -R node:node /app/apps/api

USER node
WORKDIR /app/apps/api
EXPOSE 3000

# Skip type-checking when running the seed scripts: it is already done at build time,
# and it would otherwise cost a few hundred MB of RAM on a 512 MB instance.
ENV TS_NODE_TRANSPILE_ONLY=true
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node_modules/.bin/ts-node -r tsconfig-paths/register scripts/seed-demo.ts && exec node dist/main.js"]
