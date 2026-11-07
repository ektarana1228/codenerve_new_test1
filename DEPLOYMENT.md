# Deploying ApexCoder on Hetzner

This deployment assumes:

- Main landing page: `https://apexcoder.io`
- Candidate app: `https://candidate.apexcoder.io`
- Admin site: `https://admin.apexcoder.io`
- One Hetzner Ubuntu server running Docker Compose
- Caddy terminates HTTPS and serves the built Vite frontends

## DNS

Point these records at the Hetzner server public IP:

```text
A     apexcoder.io          <server-ip>
A     candidate.apexcoder.io <server-ip>
A     admin.apexcoder.io    <server-ip>
MX/TXT apexcoder.io <mail values from your SMTP provider>
AAAA  apexcoder.io          <server-ipv6>   # only if you use IPv6
AAAA  candidate.apexcoder.io <server-ipv6>  # only if you use IPv6
AAAA  admin.apexcoder.io    <server-ipv6>   # only if you use IPv6
```

## Server Setup

Run on the Hetzner server:

```bash
sudo apt update
sudo apt install -y ca-certificates curl git docker.io docker-compose-plugin
sudo systemctl enable --now docker

sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable
```

Clone the repo:

```bash
git clone <repo-url> /srv/apexcoder
cd /srv/apexcoder
npm ci
```

## Production Environment

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Fill at least these values:

```env
POSTGRES_PASSWORD=<generated value>
JWT_SECRET=<generated value>
OPENROUTER_ENCRYPTION_KEY=<generated value>

MASTER_EMAIL=you@apexcoder.io
MASTER_PASSWORD=<strong-password>

APP_BASE_URL=https://candidate.apexcoder.io
CANDIDATE_BASE_URL=https://candidate.apexcoder.io
ADMIN_BASE_URL=https://admin.apexcoder.io

SMTP_HOST=<smtp-host>
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=assessments@apexcoder.io
SMTP_PASS=<smtp-password>
SMTP_FROM=assessments@apexcoder.io
TEAM_EMAIL_FROM=ApexCoder Team <team@apexcoder.io>
TEAM_SMTP_USER=team@apexcoder.io
TEAM_SMTP_PASS=<team-mailbox-password>
```

`APP_BASE_URL` is the candidate URL because invite emails link to `/start`.
`ADMIN_BASE_URL` is the admin URL because approval emails link to `/login`.
`SMTP_FROM` sends assessment/invite emails, authenticated with `SMTP_USER`/`SMTP_PASS` (assessments@). Admin-account approval emails send from `TEAM_EMAIL_FROM`, authenticated with `TEAM_SMTP_USER`/`TEAM_SMTP_PASS` (team@). Both use the same `SMTP_HOST`/`SMTP_PORT`/`SMTP_SECURE`.

Generate the unknown secrets on the server:

```bash
openssl rand -base64 32   # POSTGRES_PASSWORD
openssl rand -base64 48   # JWT_SECRET
openssl rand -hex 32      # OPENROUTER_ENCRYPTION_KEY
```

## Build Frontends

Vite bakes cross-app URLs at build time:

```bash
VITE_CANDIDATE_URL=https://candidate.apexcoder.io \
VITE_ADMIN_URL=https://admin.apexcoder.io \
npm run build -w @aisd/web-candidate

VITE_CANDIDATE_URL=https://candidate.apexcoder.io \
VITE_ADMIN_URL=https://admin.apexcoder.io \
npm run build -w @aisd/web-admin
```

## Build Runtime Images

```bash
docker build -f apps/vscode-orchestrator/project.Dockerfile \
  -t aisd/openvscode-opencode:latest .

docker pull gitpod/openvscode-server:1.102.3
docker pull python:3.11-slim
docker pull node:20-slim
```

## Start Production

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api-core \
  npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
docker compose -f docker-compose.prod.yml exec api-core \
  npm run db:seed -w @platform/db
```

The seed creates the `MASTER_EMAIL` account. Use it to sign in at:

```text
https://admin.apexcoder.io/login
```

Create regular admin accounts from Settings.

## Verify

```bash
curl -I https://apexcoder.io
curl -I https://candidate.apexcoder.io
curl -I https://admin.apexcoder.io
curl https://candidate.apexcoder.io/api/v1/auth/verify \
  -H 'Content-Type: application/json' \
  -d '{"token":"bad"}'
```

The last command should return an auth error from `api-core`, proving reverse proxy routing works.

## Operations

Update:

```bash
cd /srv/apexcoder
git pull
npm ci
VITE_CANDIDATE_URL=https://candidate.apexcoder.io VITE_ADMIN_URL=https://admin.apexcoder.io npm run build -w @aisd/web-candidate
VITE_CANDIDATE_URL=https://candidate.apexcoder.io VITE_ADMIN_URL=https://admin.apexcoder.io npm run build -w @aisd/web-admin
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec api-core npx prisma migrate deploy --schema packages/db/prisma/schema.prisma
```

Logs:

```bash
docker compose -f docker-compose.prod.yml logs -f api-core api-llm-gateway worker-aiu vscode-orchestrator caddy
```

Backup Postgres:

```bash
docker compose -f docker-compose.prod.yml exec postgres \
  pg_dump -U postgres platform > backup-$(date +%F).sql
```

## Notes

- `docker-compose.yml` is for local development. Use `docker-compose.prod.yml` on Hetzner.
- Caddy config lives in `deploy/Caddyfile` and gets HTTPS certificates automatically.
- Code execution and VS Code sessions require `/var/run/docker.sock`; the prod compose mounts it only into `api-core` and `vscode-orchestrator`.
- For Google Cloud proctoring evidence, put the service account at `secrets/gcs-service-account.json` and set `GCS_BUCKET_NAME`.
