# Load Tests

k6 load tests validating NFR-06, NFR-01, NFR-02, and NFR-07 from `requirements.md`.

---

## Prerequisites

### Install k6

```bash
# macOS
brew install k6

# Windows (Chocolatey)
choco install k6

# Linux (Debian/Ubuntu)
sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6

# Or via Docker
docker pull grafana/k6
```

### Mock OpenRouter

All tests that call the LLM gateway require OpenRouter to be mocked so tests do not incur real API costs and remain deterministic.

**Option A — WireMock (recommended for CI)**

```bash
docker run -d --name mock-openrouter \
  -p 9090:8080 \
  wiremock/wiremock:latest

# POST a stub for the OpenRouter completions endpoint
curl -X POST http://localhost:9090/__admin/mappings \
  -H 'Content-Type: application/json' \
  -d '{
    "request": { "method": "POST", "urlPattern": "/api/v1/chat/completions" },
    "response": {
      "status": 200,
      "headers": { "Content-Type": "application/json" },
      "jsonBody": {
        "id": "mock-123",
        "choices": [{
          "message": { "role": "assistant", "content": "Here is a hello world function: `function hello() { return \"hello world\"; }`" },
          "finish_reason": "stop"
        }]
      }
    }
  }'
```

Then set in `apps/api-llm-gateway/.env` for the test environment:

```
OPENROUTER_BASE_URL=http://localhost:9090
```

**Option B — environment variable override (quick local testing)**

Start the service with `OPENROUTER_BASE_URL` pointing to any server that returns a valid OpenRouter response shape.

### Seed an admin account

The tests call `POST /api/v1/auth/login` in `setup()`. The admin account must already exist:

```bash
# Using the provided seed script (if available)
npm run db:seed

# Or via the admin API (if bootstrap endpoint exists)
curl -X POST http://localhost:3001/api/v1/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{ "email": "admin@test.local", "password": "TestPassword123!" }'
```

---

## Running Tests Locally

All services must be running (`docker compose up` or individual service `npm run dev`).

### Concurrent sessions (NFR-07)

```bash
k6 run load-tests/test-concurrent-sessions.js \
  -e BASE_URL=http://localhost:3000 \
  -e ADMIN_EMAIL=admin@test.local \
  -e ADMIN_PASSWORD=TestPassword123!
```

Expected duration: ~12–15 minutes (500 VUs × ~25s of simulated session activity).

### LLM gateway throughput + rate limiting (NFR-01)

```bash
k6 run load-tests/test-llm-gateway-throughput.js \
  -e BASE_URL=http://localhost:3000 \
  -e ADMIN_EMAIL=admin@test.local \
  -e ADMIN_PASSWORD=TestPassword123!
```

Expected duration: ~7 minutes (3m throughput + 30s gap + 3m rate limit check).

### Auto-save spike (NFR-06, NFR-07)

```bash
k6 run load-tests/test-auto-save-spike.js \
  -e BASE_URL=http://localhost:3000 \
  -e ADMIN_EMAIL=admin@test.local \
  -e ADMIN_PASSWORD=TestPassword123!
```

Expected duration: ~3–5 minutes (setup-heavy: 500 sessions are pre-started sequentially).

---

## Running Against a Staging Environment

```bash
k6 run load-tests/test-concurrent-sessions.js \
  -e BASE_URL=https://staging.your-platform.internal \
  -e ADMIN_EMAIL=loadtest@your-platform.internal \
  -e ADMIN_PASSWORD=$STAGING_LOADTEST_PASSWORD
```

Staging-specific notes:
- Use a dedicated load-test admin account, not a shared one. The tests create and archive assessments.
- Confirm the staging database can handle 500+ sessions. Check Postgres `max_connections` (default 100) — you may need a connection pooler (PgBouncer) in front.
- Confirm Redis `maxclients` is set high enough (`CONFIG GET maxclients`).
- If staging runs behind a CDN or load balancer, ensure it doesn't rate-limit by IP before requests reach services.

---

## Interpreting k6 Output

A passing run looks like:

```
✓ session started (200)
✓ code saved (200)
✓ AI responded (200)
✓ code executed (200)
✓ session submitted (200)

checks.........................: 100.00% ✓ 5000  ✗ 0
data_received..................: 12 MB   300 kB/s
http_req_duration...............: avg=84ms  min=12ms  med=71ms  max=198ms  p(90)=145ms  p(99)=192ms
code_save_duration..............: avg=52ms  min=10ms  med=47ms  max=199ms  p(90)=98ms   p(99)=175ms ✓
code_execution_duration.........: avg=1.2s  min=200ms med=1.1s  max=3.9s   p(90)=2.8s   p(99)=3.7s  ✓
session_completions.............: 500
session_failures................: 0
http_5xx_errors.................: 0
```

Key columns to watch:

| Column | What to look for |
|---|---|
| `p(99)` on `code_save_duration` | Must be < 200ms. Rising values indicate DB or Redis bottleneck. |
| `p(90)` on `code_execution_duration` | Must be < 4000ms. Spikes indicate Docker container startup contention. |
| `p(90)` on `llm_response_duration` | Must be < 7000ms. High values with mocked OpenRouter mean gateway overhead is too high. |
| `p(99)` on `auto_save_duration` | Must be < 300ms. Spikes indicate connection pool exhaustion. |
| `http_req_failed` | Must be 0.00% (or as close as the test allows). |
| `session_completions` | Must equal 500. Any shortfall is a bug. |
| `rate_limit_hits` | Must be ≥ 5. Zero means rate limiting is not enforced. |

A **failed** run will show `✗` next to the threshold that was violated and exit with a non-zero status code — suitable for CI gate usage.

---

## Pass/Fail Thresholds Reference

| Test file | Metric | Threshold | NFR |
|---|---|---|---|
| `test-concurrent-sessions.js` | `code_save_duration` p99 | < 200ms | NFR-06 |
| `test-concurrent-sessions.js` | `code_execution_duration` p90 | < 4000ms | NFR-02 |
| `test-concurrent-sessions.js` | `http_5xx_errors` | count == 0 | NFR-07 |
| `test-concurrent-sessions.js` | `session_completions` | count >= 500 | NFR-07 |
| `test-llm-gateway-throughput.js` | `llm_response_duration` p90 | < 7000ms | NFR-01 |
| `test-llm-gateway-throughput.js` | `rate_limit_hits` | count >= 5 | FR-04 |
| `test-llm-gateway-throughput.js` | `llm_unexpected_gateway_errors` | count == 0 | — |
| `test-auto-save-spike.js` | `http_req_failed` rate | == 0% | NFR-07 |
| `test-auto-save-spike.js` | `auto_save_duration` p99 | < 300ms | NFR-06 |
| `test-auto-save-spike.js` | `auto_save_failures` | count == 0 | NFR-05 |

---

## CI Integration

Add to your pipeline (GitHub Actions example):

```yaml
load-test:
  runs-on: ubuntu-latest
  needs: [deploy-staging]
  steps:
    - uses: actions/checkout@v4
    - name: Run k6 auto-save spike
      uses: grafana/k6-action@v0.3.1
      with:
        filename: load-tests/test-auto-save-spike.js
      env:
        BASE_URL: ${{ secrets.STAGING_BASE_URL }}
        ADMIN_EMAIL: ${{ secrets.LOADTEST_ADMIN_EMAIL }}
        ADMIN_PASSWORD: ${{ secrets.LOADTEST_ADMIN_PASSWORD }}
    - name: Run k6 concurrent sessions
      uses: grafana/k6-action@v0.3.1
      with:
        filename: load-tests/test-concurrent-sessions.js
      env:
        BASE_URL: ${{ secrets.STAGING_BASE_URL }}
        ADMIN_EMAIL: ${{ secrets.LOADTEST_ADMIN_EMAIL }}
        ADMIN_PASSWORD: ${{ secrets.LOADTEST_ADMIN_PASSWORD }}
```

k6 exits with code `99` when any threshold is violated, failing the CI step automatically.

---

## Troubleshooting

**`admin login failed`** — The seeded admin account does not exist or credentials are wrong. Re-run the seed script.

**`Only generated X/500 invite tokens`** — The assessment API may be rate-limiting token generation, or the DB is under too much pressure during setup. Reduce parallelism in setup or increase `max_connections`.

**`p(99)` on code saves consistently near 200ms** — Check Postgres query times for `UPDATE sessions SET currentCode = $1`. Add an index on `sessions.id` if missing. Also check Redis connection pool size in the session service.

**Rate limit hits count is 0** — The `RATE_LIMIT_PER_SESSION` constant in the test (60) does not match the actual gateway config. Check `api-llm-gateway` env var for the per-session cap.

**Docker execution timeouts during concurrent test** — The Docker daemon may not support 500 concurrent container spawns. Confirm `dockerd` `--default-ulimit` settings and host kernel `ulimit -u` (max user processes).
