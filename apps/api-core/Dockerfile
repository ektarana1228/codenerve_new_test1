FROM node:20-alpine AS base
WORKDIR /app

# openssl: Prisma. docker-cli + python3: sandbox code execution.
# chromium + friends: Puppeteer PDF generation (reports).
RUN apk add --no-cache \
    openssl \
    docker-cli \
    python3 \
    ffmpeg \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

COPY package.json package-lock.json turbo.json ./
COPY packages/config/package.json packages/config/
COPY packages/db/package.json packages/db/
COPY packages/logger/package.json packages/logger/
COPY packages/types/package.json packages/types/
COPY sandbox/runner/package.json sandbox/runner/
COPY apps/api-core/package.json apps/api-core/
COPY apps/api-llm-gateway/package.json apps/api-llm-gateway/
COPY apps/web-admin/package.json apps/web-admin/
COPY apps/web-candidate/package.json apps/web-candidate/
COPY apps/worker-aiu/package.json apps/worker-aiu/

RUN npm ci

# dev - source is mounted via docker-compose volumes for hot reload
# sandbox/runner must be pre-built (its main points to dist/)
FROM base AS dev
COPY . .
RUN npm run db:generate -w packages/db
RUN npm run build -w sandbox/runner
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3101
CMD ["npx", "tsx", "watch", "apps/api-core/src/index.ts"]

# builder - compiles TypeScript for production
FROM base AS builder
COPY . .
RUN npm run build -w packages/types && \
    node -e "var p=require('./packages/types/package.json');p.main='./dist/index.js';p.types='./dist/index.d.ts';require('fs').writeFileSync('./packages/types/package.json',JSON.stringify(p,null,2))" && \
    npm run build -w packages/config && \
    node -e "var p=require('./packages/config/package.json');p.main='./dist/index.js';p.types='./dist/index.d.ts';require('fs').writeFileSync('./packages/config/package.json',JSON.stringify(p,null,2))" && \
    npm run build -w packages/logger && \
    node -e "var p=require('./packages/logger/package.json');p.main='./dist/index.js';p.types='./dist/index.d.ts';require('fs').writeFileSync('./packages/logger/package.json',JSON.stringify(p,null,2))" && \
    npm run db:generate -w packages/db && \
    npm run build -w packages/db && \
    node -e "var p=require('./packages/db/package.json');p.main='./dist/index.js';p.types='./dist/index.d.ts';require('fs').writeFileSync('./packages/db/package.json',JSON.stringify(p,null,2))" && \
    npm run build -w sandbox/runner && \
    npm run build -w apps/api-core

FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache \
    openssl \
    docker-cli \
    ffmpeg \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/sandbox/runner/dist ./sandbox/runner/dist
COPY --from=builder --chown=app:app /app/sandbox/runner/package.json ./sandbox/runner/package.json
COPY --from=builder --chown=app:app /app/apps/api-core/dist ./apps/api-core/dist
COPY --from=builder --chown=app:app /app/apps/api-core/package.json ./apps/api-core/package.json
USER app
EXPOSE 3101
CMD ["node", "apps/api-core/dist/apps/api-core/src/index.js"]
