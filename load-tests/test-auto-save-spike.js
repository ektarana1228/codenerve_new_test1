/**
 * NFR-06: Non-LLM, non-execution endpoints p99 < 200ms.
 * NFR-07: 500 simultaneous active sessions without degradation.
 *
 * Spike test: 500 pre-started sessions fire PATCH /sessions/:id/code simultaneously.
 * This simulates the worst-case auto-save burst — e.g., all candidates pressing a key
 * at the same moment after a long pause, triggering the 2s debounced save at the same time.
 *
 * Thresholds:
 *   - Zero request failures (http_req_failed rate == 0)
 *   - p99 response time < 300ms (generous vs NFR-06's 200ms to account for DB contention
 *     under spike conditions, while still catching severe degradation)
 *
 * Prerequisites:
 *   - Admin account seeded with ADMIN_EMAIL / ADMIN_PASSWORD
 *   - All backend services running with DATABASE_URL and REDIS_URL set
 *
 * Run:
 *   k6 run load-tests/test-auto-save-spike.js \
 *     -e BASE_URL=http://localhost:3000 \
 *     -e ADMIN_EMAIL=admin@test.local \
 *     -e ADMIN_PASSWORD=TestPassword123!
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const ADMIN_EMAIL = __ENV.ADMIN_EMAIL || 'admin@test.local';
const ADMIN_PASSWORD = __ENV.ADMIN_PASSWORD || 'TestPassword123!';
const TOTAL_SESSIONS = 500;

const autoSaveDuration = new Trend('auto_save_duration', true);
const autoSaveFailures = new Counter('auto_save_failures');

export const options = {
  scenarios: {
    auto_save_spike: {
      executor: 'shared-iterations',
      // All 500 VUs start immediately — k6 brings them up as fast as possible
      vus: TOTAL_SESSIONS,
      iterations: TOTAL_SESSIONS,
      maxDuration: '5m',
      gracefulStop: '30s',
    },
  },
  thresholds: {
    // No request must fail — a single failed save under spike is a bug
    http_req_failed: ['rate==0'],
    auto_save_failures: ['count==0'],
    // p99 < 300ms spike tolerance (NFR-06 requires 200ms p99 under normal load)
    // p50 < 100ms ensures median stays fast — spike should not cause sustained slowdown
    auto_save_duration: ['p(50)<100', 'p(99)<300'],
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
      title: `k6 Auto-Save Spike — ${new Date().toISOString()}`,
      timeLimitMinutes: 90,
      language: 'JAVASCRIPT',
      llmModel: 'openai/gpt-4o-mini',
      codeWeight: 60,
      aiuWeight: 40,
      aiuMetrics: ['PROMPT_QUALITY'],
      aiuMetricWeights: { prompt_quality: 100 },
      problems: [
        {
          title: 'Spike Test Problem',
          description: 'Write a hello world function.',
          difficulty: 'EASY',
          testCases: [
            { input: '', expected: 'hello world', isHidden: false },
            { input: '', expected: 'hello world', isHidden: true },
          ],
        },
      ],
    }),
    { headers: authHeaders }
  );

  if (!check(assessmentRes, { 'assessment created': (r) => r.status === 201 })) {
    throw new Error(`Assessment creation failed: ${assessmentRes.status} — ${assessmentRes.body}`);
  }

  const assessmentId = assessmentRes.json('data.id');
  const preStartedSessions = [];

  // Pre-start all 500 sessions so VUs can immediately fire the save request
  // without session-start latency skewing the spike measurement
  for (let i = 1; i <= TOTAL_SESSIONS; i++) {
    const tokenRes = http.post(
      `${BASE_URL}/api/v1/assessments/${assessmentId}/invite-tokens`,
      JSON.stringify({ candidateName: `k6-spike-candidate-${i}` }),
      { headers: authHeaders }
    );

    if (tokenRes.status !== 201) {
      console.error(`Token generation failed for candidate ${i}: ${tokenRes.status}`);
      continue;
    }

    const sessionRes = http.post(
      `${BASE_URL}/api/v1/sessions/start`,
      JSON.stringify({ token: tokenRes.json('data.token') }),
      { headers: { 'Content-Type': 'application/json' } }
    );

    if (sessionRes.status === 200) {
      preStartedSessions.push({
        accessToken: sessionRes.json('data.access_token'),
        sessionId: sessionRes.json('data.session_id'),
      });
    } else {
      console.error(`Session start failed for candidate ${i}: ${sessionRes.status}`);
    }
  }

  if (preStartedSessions.length < TOTAL_SESSIONS) {
    throw new Error(
      `Only pre-started ${preStartedSessions.length}/${TOTAL_SESSIONS} sessions — aborting`
    );
  }

  console.log(
    `[setup] ${preStartedSessions.length} sessions pre-started. Spike begins.`
  );

  return { assessmentId, preStartedSessions };
}

export default function (data) {
  // __VU is 1-based; map to session array (0-based)
  const session = data.preStartedSessions[__VU - 1];

  if (!session) {
    autoSaveFailures.add(1);
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.accessToken}`,
  };

  // No sleep before firing — all VUs start simultaneously to create the spike.
  // k6 ramps VUs to the configured count before dispatching iterations, so the
  // first iteration of each VU fires as close together as system scheduling allows.
  const start = Date.now();
  const res = http.patch(
    `${BASE_URL}/api/v1/sessions/${session.sessionId}/code`,
    JSON.stringify({
      code: [
        'function solution() {',
        '  // spike test payload — representative of real candidate code size',
        '  const result = [];',
        '  for (let i = 0; i < 10; i++) {',
        '    result.push(`item ${i}`);',
        '  }',
        '  return result.join(", ");',
        '}',
        'console.log(solution());',
      ].join('\n'),
    }),
    { headers, tags: { step: 'auto_save_spike' } }
  );
  autoSaveDuration.add(Date.now() - start);

  if (
    !check(res, {
      'auto-save returned 200': (r) => r.status === 200,
      'response contains saved_at timestamp': (r) =>
        r.json('data.saved_at') !== undefined,
    })
  ) {
    autoSaveFailures.add(1);
  }
}

export function teardown(data) {
  console.log(
    `[teardown] Auto-save spike test complete. Assessment ID: ${data.assessmentId}`
  );
}
