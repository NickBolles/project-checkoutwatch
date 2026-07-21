FROM node:20-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_HOME=/corepack
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY fixtures/storefront/package.json fixtures/storefront/package.json
COPY fixtures/webhook-sink/package.json fixtures/webhook-sink/package.json
COPY packages/alerts/package.json packages/alerts/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/diagnosis/package.json packages/diagnosis/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/queue/package.json packages/queue/package.json
COPY packages/shopify/package.json packages/shopify/package.json
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm db:generate:postgres
RUN pnpm --filter @checkoutwatch/web... build

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV INLINE_WORKER=0
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_HOME=/corepack
WORKDIR /app
RUN corepack enable
COPY --from=build --chown=node:node /corepack /corepack
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /app/var/artifacts && chmod 0777 /app/var/artifacts
USER node
EXPOSE 3000
CMD ["pnpm", "--filter", "@checkoutwatch/web", "start"]
