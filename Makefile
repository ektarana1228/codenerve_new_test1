DB_URL ?= postgresql://postgres:password@localhost:5432/platform
TEST_DB_URL ?= postgresql://postgres:password@localhost:5432/platform_test

.PHONY: dev down logs build test test\:integration db\:migrate db\:seed db\:reset db\:test\:setup

dev:
	docker compose up -d
	npx turbo run dev --filter=./apps/web-candidate --filter=./apps/web-admin

down:
	docker compose down

logs:
	docker compose logs -f

build:
	npx turbo run build

test:
	npx turbo run test

# Integration tests — require postgres (platform_test DB) and redis to be running.
# Run `make db:test:setup` once before the first `make test:integration`.
test\:integration:
	TEST_DATABASE_URL=$(TEST_DB_URL) jest --config jest.integration.config.cjs

db\:test\:setup:
	DATABASE_URL=$(TEST_DB_URL) npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

db\:migrate:
	DATABASE_URL=$(DB_URL) npm run db:migrate -w packages/db

db\:seed:
	DATABASE_URL=$(DB_URL) npm run db:seed -w packages/db

db\:reset:
	DATABASE_URL=$(DB_URL) npx prisma migrate reset --force --schema packages/db/prisma/schema.prisma
