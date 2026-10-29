FROM node:22.23.4-alpine AS builder

WORKDIR /app

COPY package*.json .
COPY tsconfig.json .
COPY src src

RUN npm ci
RUN npm run build



FROM node:22.23.4-alpine AS production

WORKDIR /app

RUN apk upgrade --no-cache

COPY package*.json .
COPY --from=builder /app/build ./build

RUN npm ci --omit=dev && npm cache clean --force

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "build/main.js"]