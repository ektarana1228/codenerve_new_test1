#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")"
COMPOSE=(docker compose --project-directory "$APP_DIR" -f "$APP_DIR/docker-compose.prod.yml")

if [ ! -f "$APP_DIR/.env" ]; then
  echo "Missing $APP_DIR/.env. Copy .env.example to .env and fill the required secrets first."
  exit 1
fi

for key in POSTGRES_PASSWORD JWT_SECRET OPENROUTER_ENCRYPTION_KEY MASTER_EMAIL MASTER_PASSWORD; do
  if ! grep -Eq "^${key}=.+" "$APP_DIR/.env"; then
    echo "Missing required .env value: $key"
    exit 1
  fi
done

echo "Pulling latest main..."
git -C "$APP_DIR" checkout main
git -C "$APP_DIR" pull --ff-only origin main

if [ ! -e /srv/apexcoder ]; then
  sudo mkdir -p /srv
  sudo ln -s "$APP_DIR" /srv/apexcoder
fi

echo "Installing dependencies..."
npm --prefix "$APP_DIR" ci --include=optional
ROLLUP_VERSION="$(node -p "require('$APP_DIR/node_modules/rollup/package.json').version")"
npm --prefix "$APP_DIR" install --no-save --package-lock=false "@rollup/rollup-linux-x64-gnu@$ROLLUP_VERSION"

echo "Building frontends..."
VITE_CANDIDATE_URL=https://candidate.apexcoder.io \
VITE_ADMIN_URL=https://admin.apexcoder.io \
npm --prefix "$APP_DIR" run build -w @aisd/web-candidate

VITE_CANDIDATE_URL=https://candidate.apexcoder.io \
VITE_ADMIN_URL=https://admin.apexcoder.io \
npm --prefix "$APP_DIR" run build -w @aisd/web-admin

echo "Building VS Code project image..."
docker build -f "$APP_DIR/apps/vscode-orchestrator/project.Dockerfile" \
  -t aisd/openvscode-opencode:latest "$APP_DIR"

echo "Building TypeScript sandbox image..."
docker build -f "$APP_DIR/sandbox/dockerfiles/Dockerfile.node" \
  -t aisd/sandbox-node:latest "$APP_DIR"

echo "Rebuilding and starting services..."
# --build rebuilds images from the pulled source; --force-recreate guarantees the
# containers restart on the freshly built image (no stale container from a prior deploy).
"${COMPOSE[@]}" up -d --build --force-recreate postgres redis api-core api-llm-gateway vscode-orchestrator worker-aiu

echo "Running database migrations..."
"${COMPOSE[@]}" exec -T api-core npx prisma migrate deploy --schema packages/db/prisma/schema.prisma

echo "Seeding master account..."
"${COMPOSE[@]}" exec -T api-core npm run db:seed -w @platform/db

echo "Done. Check:"
echo "  https://apexcoder.io"
echo "  https://candidate.apexcoder.io"
echo "  https://admin.apexcoder.io"
