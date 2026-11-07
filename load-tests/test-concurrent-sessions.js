/**
 * NFR-07: 500 simultaneous active candidate sessions without degradation.
 * NFR-06: Non-LLM, non-execution endpoints p99 < 200ms.
 * NFR-02: Code execution p90 < 4000ms.
 *
 * Prerequisites:
 *   - Services running with LLM gateway pointing to a mock OpenRouter server
 *     (set OPENROUTER_BASE_URL=http://mock-openrouter:9090 in api-llm-gateway .env)
 *   - Admin account seeded with ADMIN_EMAIL / ADMIN_PASSWORD
 *
 * Run:
 *   k6 run load-tests/test-concurrent-sessions.js \
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
const TOTAL_SESSIONS = 500;

// Custom metrics let us assert on specific request categories independently
const codeSaveDuration = new Trend('code_save_duration', true);
const codeExecDuration = new Trend('code_execution_duration', true);
const sessionCompletions = new Counter('session_completions');
const sessionFailures = new Counter('session_failures');
const fivexxErrors = new Counter('http_5xx_errors');

export const options = {
  scenarios: {
    concurrent_sessions: {
      executor: 'shared-iterations',
      // 500 VUs each performing exactly 1 full session lifecycle
      vus: TOTAL_SESSIONS,
      iterations: TOTAL_SESSIONS,
      maxDuration: '15m',
      gracefulStop: '60s',
    },
  },
  thresholds: {
    // NFR-06: p99 code-save (non-LLM, non-execution) < 200ms
    code_save_duration: ['p(99)<200'],
    // NFR-02: code execution p90 < 4000ms (upper bound of 3–4s range)
    code_execution_duration: ['p(90)<4000'],
    // Zero tolerance for 5xx — server errors indicate degradation under load
    http_5xx_errors: ['count==0'],
    // NFR-07: all 500 sessions must complete successfully
    session_completions: [`count>=${TOTAL_SESSIONS}`],
    // Overall failure rate guard
    http_req_failed: ['rate<0.01'],
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

  // Create a dedicated assessment so this run is fully isolated
  const assessmentRes = http.post(
    `${BASE_URL}/api/v1/assessments`,
    JSON.stringify({
      title: `k6 Concurrent Sessions — ${new Date().toISOString()}`,
      timeLimitMinutes: 90,
      language: 'JAVASCRIPT',
      llmModel: 'openai/gpt-4o-mini',
      codeWeight: 60,
      aiuWeight: 40,
      aiuMetrics: ['PROMPT_QUALITY'],
      aiuMetricWeights: { prompt_quality: 100 },
      problems: [
        {
          title: 'Hello World',
          description: 'Write a function that returns the string `"hello world"`.',
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
  const inviteTokens = [];

  // Generate one invite token per VU — done sequentially in setup, not during the load run
  for (let i = 1; i <= TOTAL_SESSIONS; i++) {
    const res = http.post(
      `${BASE_URL}/api/v1/assessments/${assessmentId}/invite-tokens`,
      JSON.stringify({ candidateName: `k6-candidate-${i}` }),
      { headers: authHeaders }
    );
    if (res.status === 201) {
      inviteTokens.push(res.json('data.token'));
    } else {
      console.error(`Token generation failed for candidate ${i}: ${res.status}`);
    }
  }

  if (inviteTokens.length < TOTAL_SESSIONS) {
    throw new Error(
      `Only generated ${inviteTokens.length}/${TOTAL_SESSIONS} invite tokens — aborting`
    );
  }

  return { assessmentId, inviteTokens };
}

export default function (data) {
  // __VU is 1-based; each VU consumes exactly one unique invite token
  const token = data.inviteTokens[__VU - 1];

  if (!token) {
    sessionFailures.add(1);
    return;
  }

  let sessionToken, sessionId;

  // ── Step 1: Start session (consumes the one-time invite token) ──────────────
  group('start_session', () => {
    const res = http.post(
      `${BASE_URL}/api/v1/sessions/start`,
      JSON.stringify({ token }),
      {
        headers: { 'Content-Type': 'application/json' },
        tags: { step: 'start_session' },
      }
    );

    if (!check(res, { 'session started (200)': (r) => r.status === 200 })) {
      if (res.status >= 500) fivexxErrors.add(1);
      sessionFailures.add(1);
      return;
    }

    sessionToken = res.json('data.access_token');
    sessionId = res.json('data.session_id');
  });

  if (!sessionToken) return;

  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${sessionToken}`,
  };

  const sampleCode = [
    'function solution() {',
    '  return "hello world";',
    '}',
    'console.log(solution());',
  ].join('\n');

  // ── Step 2: Code auto-saves (3 saves with 10s interval — mirrors NFR-05) ───
  group('code_saves', () => {
    for (let i = 0; i < 3; i++) {
      const start = Date.now();
      const res = http.patch(
        `${BASE_URL}/api/v1/sessions/${sessionId}/code`,
        JSON.stringify({ code: `${sampleCode}\n// edit ${i + 1}` }),
        { headers, tags: { step: 'code_save' } }
      );
      codeSaveDuration.add(Date.now() - start);

      if (!check(res, { 'code saved (200)': (r) => r.status === 200 })) {
        if (res.status >= 500) fivexxErrors.add(1);
      }

      // Simulate real 10s keystroke-idle interval between saves
      if (i < 2) sleep(10);
    }
  });

  // ── Step 3: AI prompts × 3 (mocked at env level — see prerequisites) ───────
  group('ai_prompts', () => {
    const prompts = [
      'How do I return a string from a JavaScript function?',
      'What is the syntax for console.log in JavaScript?',
      'How do I write a hello world program in JavaScript?',
    ];

    for (const prompt of prompts) {
      const res = http.post(
        `${BASE_URL}/api/v1/llm/chat`,
        JSON.stringify({ prompt, session_id: sessionId }),
        { headers, tags: { step: 'ai_prompt' } }
      );

      if (!check(res, { 'AI responded (200)': (r) => r.status === 200 })) {
        if (res.status >= 500) fivexxErrors.add(1);
      }

      // Simulate candidate reading the response before typing the next prompt
      sleep(1);
    }
  });

  // ── Step 4: Execute code against visible test cases ──────────────────────────
  group('code_execution', () => {
    const start = Date.now();
    const res = http.post(
      `${BASE_URL}/api/v1/sessions/${sessionId}/execute`,
      JSON.stringify({ code: sampleCode }),
      { headers, tags: { step: 'code_execute' } }
    );
    codeExecDuration.add(Date.now() - start);

    if (!check(res, { 'code executed (200)': (r) => r.status === 200 })) {
      if (res.status >= 500) fivexxErrors.add(1);
    }
  });

  // ── Step 5: Submit session ───────────────────────────────────────────────────
  group('submit_session', () => {
    const res = http.post(
      `${BASE_URL}/api/v1/sessions/${sessionId}/submit`,
      JSON.stringify({ code: sampleCode }),
      { headers, tags: { step: 'submit' } }
    );

    if (!check(res, { 'session submitted (200)': (r) => r.status === 200 })) {
      if (res.status >= 500) fivexxErrors.add(1);
      sessionFailures.add(1);
    } else {
      sessionCompletions.add(1);
    }
  });
}

export function teardown(data) {
  console.log(
    `[teardown] test assessment ID: ${data.assessmentId} — archive manually via admin dashboard if needed`
  );
}
