FROM node:24.22.2-alpine3.24 AS base

WORKDIR /app

# pnpm is pinned through "packageManager" in package.json
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./



FROM base AS builder

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
	pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src src
RUN pnpm run build



# production dependencies are installed here so that pnpm itself does not end up in the final image
FROM base AS prod-deps

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
	pnpm install --prod --frozen-lockfile



FROM node:24.22.2-alpine3.24 AS production

WORKDIR /app

RUN apk upgrade --no-cache

COPY package.json ./
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build

ENV NODE_ENV=production

# port is read from the config file (server.http.port), so it is not hard-coded here
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
	CMD ["node", "build/cli.js", "healthcheck"]

CMD ["node", "build/main.js"]
