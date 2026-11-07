/**
 * NFR-01: LLM response time p90 < 7 seconds.
 * Also validates rate limiting fires at the configured 60 req/session cap.
 *
 * Two scenarios run back-to-back:
 *   1. llm_throughput  — 100 concurrent sessions each fire one LLM request simultaneously.
 *                        Measures gateway overhead (OpenRouter is mocked).
 *   2. rate_limit_check — one session sends 65 requests; asserts the 61st onward returns 429.
 *
 * Prerequisites:
 *   - api-llm-gateway OPENROUTER_BASE_URL points to a mock server returning instant responses
 *   - Admin account seeded with ADMIN_EMAIL / ADMIN_PASSWORD
 *
 * Run:
 *   k6 run load-tests/test-llm-gateway-throughput.js \
 *     -e BASE_URL=http://localhost:3000 \
 *     -e ADMIN_EMAIL=admin@test.local \
 *     -e ADMIN_PASSWORD=TestPassword123!
 */

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@test.local';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'TestPassword123!';

const CONCURRENT_LLM_VUS = 100;
// Must match api-llm-gateway rate limit config (defaults to 60 per session)
const RATE_LIMIT_PER_SESSION = 60;
const RATE_LIMIT_OVERFLOW = 5; // requests sent above the limit

const llmResponseDuration = new Trend('llm_response_duration', true);
const rateLimitHits = new Counter('rate_limit_hits');
const unexpectedGatewayErrors = new Counter('llm_unexpected_gateway_errors');

export const options = {
  scenarios: {
    // Scenario 1: concurrent throughput — all 100 VUs fire simultaneously
    llm_throughput: {
      executor: 'shared-iterations',
      vus: CONCURRENT_LLM_VUS,
      iterations: CONCURRENT_LLM_VUS,
      maxDuration: '3m',
      gracefulStop: '30s',
      env: { SCENARIO: 'throughput' },
    },
    // Scenario 2: rate limit correctness — runs after throughput test completes
    rate_limit_check: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: RATE_LIMIT_PER_SESSION + RATE_LIMIT_OVERFLOW,
      maxDuration: '3m',
      startTime: '3m30s', // buffer after throughput scenario ends
      gracefulStop: '10s',
      env: { SCENARIO: 'rate_limit' },
    },
  },
  thresholds: {
    // NFR-01: gateway p90 < 7000ms (mocked OpenRouter means this measures gateway overhead only)
    llm_response_duration: ['p(90)<7000'],
    // Rate limiting must engage — at least RATE_LIMIT_OVERFLOW requests must be blocked
    rate_limit_hits: [`count>=${RATE_LIMIT_OVERFLOW}`],
    // No unexpected 5xx from the gateway itself (429 is expected and handled separately)
    llm_unexpected_gateway_errors: ['count==0'],
  },
};

export function setup() {
  const loginRes = http.post(
    `${BASE_URL}/api/v1/auth/login`,
    JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (!check(loginRes, { 'admin login succeeded': (r) => r.status === 200 })) {
    throw new Error(`Admin login failed: ${loginRes.status} — ${loginRes.body}`);
  }

  const adminToken = loginRes.json('data.access_token');
  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${adminToken}`,
  };

  const assessmentRes = http.post(
    `${BASE_URL}/api/v1/assessments`,
    JSON.stringify({
      title: `k6 LLM Gateway Throughput — ${new Date().toISOString()}`,
      timeLimitMinutes: 90,
      language: 'JAVASCRIPT',
      llmModel: 'openai/gpt-4o-mini',
      codeWeight: 60,
      aiuWeight: 40,
      aiuMetrics: ['PROMPT_QUALITY'],
      aiuMetricWeights: { prompt_quality: 100 },
      problems: [
        {
          title: 'Throughput Test Problem',
          description: 'Write a hello world function.',
          difficulty: 'EASY',
          testCases: [{ input: '', expected: 'hello', isHidden: false }],
        },
      ],
    }),
    { headers: authHeaders }
  );

  if (!check(assessmentRes, { 'assessment created': (r) => r.status === 201 })) {
    throw new Error(`Assessment creation failed: ${assessmentRes.status}`);
  }

  const assessmentId = assessmentRes.json('data.id');

  // ── Generate and pre-start sessions for throughput scenario ─────────────────
  // Pre-starting avoids the session start overhead polluting LLM latency measurements
  const throughputSessions = [];

  for (let i = 1; i <= CONCURRENT_LLM_VUS; i++) {
    const tokenRes = http.post(
      `${BASE_URL}/api/v1/assessments/${assessmentId}/invite-tokens`,
      JSON.stringify({ candidateName: `k6-llm-throughput-${i}` }),
      { headers: authHeaders }
    );

    if (tokenRes.status !== 201) {
      console.error(`Token ${i} failed: ${tokenRes.status}`);
      continue;
    }

    const sessionRes = http.post(
      `${BASE_URL}/api/v1/sessions/start`,
      JSON.stringify({ token: tokenRes.json('data.token') }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (sessionRes.status === 200) {
      throughputSessions.push({
        accessToken: sessionRes.json('data.access_token'),
        sessionId: sessionRes.json('data.session_id'),
      });
    } else {
      console.error(`Session start ${i} failed: ${sessionRes.status}`);
    }
  }

  if (throughputSessions.length < CONCURRENT_LLM_VUS) {
    throw new Error(
      `Only pre-started ${throughputSessions.length}/${CONCURRENT_LLM_VUS} sessions`
    );
  }

  // ── Generate and pre-start the single session for rate limit scenario ────────
  const rlTokenRes = http.post(
    `${BASE_URL}/api/v1/assessments/${assessmentId}/invite-tokens`,
    JSON.stringify({ candidateName: 'k6-rate-limit-candidate' }),
    { headers: authHeaders }
  );

  if (!check(rlTokenRes, { 'rate limit token generated': (r) => r.status === 201 })) {
    throw new Error(`Rate limit token generation failed: ${rlTokenRes.status}`);
  }

  const rlSessionRes = http.post(
    `${BASE_URL}/api/v1/sessions/start`,
    JSON.stringify({ token: rlTokenRes.json('data.token') }),
    { headers: { 'Content-Type': 'application/json' } }
  );

  if (!check(rlSessionRes, { 'rate limit session started': (r) => r.status === 200 })) {
    throw new Error(`Rate limit session start failed: ${rlSessionRes.status}`);
  }

  return {
    assessmentId,
    throughputSessions,
    rateLimitSession: {
      accessToken: rlSessionRes.json('data.access_token'),
      sessionId: rlSessionRes.json('data.session_id'),
    },
  };
}

export default function (data) {
  const scenario = __ENV.SCENARIO;

  if (scenario === 'throughput') {
    runThroughput(data);
  } else if (scenario === 'rate_limit') {
    runRateLimitCheck(data);
  }
}

function runThroughput(data) {
  // __VU is 1-based; each VU owns one pre-started session
  const session = data.throughputSessions[__VU - 1];
  if (!session) return;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
  };

  group('llm_throughput_request', () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/v1/llm/chat`,
      JSON.stringify({
        prompt: 'Explain how to write a hello world function in JavaScript.',
        session_id: session.sessionId,
      }),
      { headers, tags: { step: 'llm_throughput' } }
    );
    llmResponseDuration.add(Date.now() - start);

    if (!check(res, { 'LLM responded (200)': (r) => r.status === 200 })) {
      // 429 here would be unexpected — each session is brand-new with 0 prior requests
      if (res.status >= 500) {
        unexpectedGatewayErrors.add(1);
      }
    }
  });
}

function runRateLimitCheck(data) {
  // Serial scenario: 1 VU, RATE_LIMIT_PER_SESSION + RATE_LIMIT_OVERFLOW iterations.
  // __ITER is 0-based; iterations 0–59 should succeed, 60–64 should return 429.
  const session = data.rateLimitSession;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
  };

  const requestNumber = __ITER + 1; // 1-based for human-readable logging

  group('rate_limit_check', () => {
    const res = http.post(
      `${BASE_URL}/api/v1/llm/chat`,
      JSON.stringify({
        prompt: `Rate limit stress prompt #${requestNumber} — testing gateway enforcement.`,
        session_id: session.sessionId,
      }),
      { headers, tags: { step: 'rate_limit_test' } }
    );

    if (res.status === 429) {
      rateLimitHits.add(1);
      check(res, {
        'rate limit error code is RATE_LIMITED': (r) =>
          r.json('error.code') === 'RATE_LIMITED',
        // Rate limit must not fire before the configured threshold
        [`rate limit fired at or after request ${RATE_LIMIT_PER_SESSION + 1}`]: () =>
          requestNumber > RATE_LIMIT_PER_SESSION,
      });
    } else if (res.status === 200) {
      check(res, {
        'successful request has response text': (r) =>
          r.json('data.response') !== undefined && r.json('data.response').length > 0,
        [`request ${requestNumber} within allowed limit`]: () =>
          requestNumber <= RATE_LIMIT_PER_SESSION,
      });
    } else {
      // Neither 200 nor 429 — genuine gateway error
      unexpectedGatewayErrors.add(1);
      check(res, {
        'unexpected non-200/429 status': () => false,
      });
    }
  });

  // Minimal pause to prevent Redis rate limit counter from expiring between requests
  sleep(0.05);
}

export function teardown(data) {
  console.log(
    `[teardown] LLM gateway test complete. Assessment ID: ${data.assessmentId}`
  );
}
