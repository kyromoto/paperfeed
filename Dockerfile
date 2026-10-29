FROM node:24.22.2-alpine3.24 AS builder

WORKDIR /app

COPY package*.json .
COPY tsconfig.json .
COPY tsconfig.build.json .
COPY src src

RUN npm ci
RUN npm run build



FROM node:24.22.2-alpine3.24 AS production

WORKDIR /app

RUN apk upgrade --no-cache

COPY package*.json .
COPY --from=builder /app/build ./build

RUN npm ci --omit=dev && npm cache clean --force

ENV NODE_ENV=production

# port is read from the config file (server.http.port), so it is not hard-coded here
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
	CMD ["node", "build/cli.js", "healthcheck"]

CMD ["node", "build/main.js"]