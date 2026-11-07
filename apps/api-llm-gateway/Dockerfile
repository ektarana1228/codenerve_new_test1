FROM node:20-alpine AS base
WORKDIR /app

RUN apk add --no-cache openssl

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
FROM base AS dev
COPY . .
RUN npm run db:generate -w packages/db
RUN addgroup -S app && adduser -S app -G app && chown -R app:app /app
USER app
EXPOSE 3102
CMD ["npx", "tsx", "watch", "apps/api-llm-gateway/src/index.ts"]

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
    npm run build -w apps/api-llm-gateway

FROM node:20-alpine AS production
WORKDIR /app
RUN apk add --no-cache openssl
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/node_modules ./node_modules
COPY --from=builder --chown=app:app /app/package.json ./
COPY --from=builder --chown=app:app /app/packages ./packages
COPY --from=builder --chown=app:app /app/apps/api-llm-gateway/dist ./apps/api-llm-gateway/dist
COPY --from=builder --chown=app:app /app/apps/api-llm-gateway/package.json ./apps/api-llm-gateway/package.json
USER app
EXPOSE 3102
CMD ["node", "apps/api-llm-gateway/dist/index.js"]
