const fs = require('fs')

const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).map((line) => {
  const idx = line.indexOf('=')
  return idx > 0 ? [line.slice(0, idx), line.slice(idx + 1)] : null
}).filter(Boolean))

const weakTitles = [
  'Consensus Vote Finding', 'Bandwidth Distribution', 'Deployment Steps', 'Target Revenue Subarray',
  'Max Storage Volume', 'Unique Signal Stream', 'Merge System Logs', 'Server Hop Validation',
  'Peak Revenue Subarray', 'Database Search Insert', 'Model inference drops requests under load',
  'Min-Max scaler divides by zero', 'Tokenizer ignores punctuation', 'K-Means crashes on empty cluster',
  'Recommender returns undefined for new users', 'Train-test split includes overlapping data',
  'Sanitizer fails to strip system prompt leaks', 'Gradient descent diverges instead of converging',
  'Dot product incorrectly transposes dimensions', 'Imputer replaces nulls with 0 instead of mean',
]

const coding = [
  ['Student BOM Enrollment Audit', 'Data Structures', 'EASY', `# Student BOM Enrollment Audit

Given a CSV-style list of student course selections, compute the bill-of-material item quantities required for one department.

Input format:
\`department n\`, then \`n\` lines of \`student_id,department,course,kit,quantity\`.

Count only rows matching the requested department. If the same student has duplicate rows for the same kit, count that kit only once for that student using the largest quantity. Print kits sorted alphabetically as \`kit:total\`, one per line.`, [
    ['CSE 4\ns1,CSE,AI,KIT_A,1\ns1,CSE,AI,KIT_A,2\ns2,ECE,ML,KIT_B,1\ns3,CSE,DS,KIT_B,3', 'KIT_A:2\nKIT_B:3', false],
    ['ME 3\ns1,ME,CAD,GEAR,2\ns2,ME,CAD,GEAR,2\ns2,ME,LAB,SENSOR,1', 'GEAR:4\nSENSOR:1', false],
    ['CSE 2\ns1,ECE,AI,KIT_A,1\ns2,ME,DS,KIT_B,1', '', true],
  ]],
  ['Inventory Reorder Window', 'Sliding Window', 'EASY', `# Inventory Reorder Window

Given daily inventory deltas and a reorder threshold, find the shortest continuous window whose total shortage reaches at least the threshold.

Input: \`threshold n\`, then \`n\` integers. Positive numbers are shortages, negative numbers are replenishments. Print the minimum window length, or \`0\` if no window qualifies.`, [
    ['7 6\n2 -1 3 4 -2 5', '3', false],
    ['5 3\n1 1 1', '0', false],
    ['4 4\n4 -10 4 4', '1', true],
  ]],
  ['Access Log Sessionizer', 'Hash Maps', 'EASY', `# Access Log Sessionizer

Given sorted access logs, count user sessions. A new session starts when the gap from that user's previous event is greater than \`gap\` minutes.

Input: \`gap n\`, then \`n\` lines \`user minute\`. Print users alphabetically as \`user:sessions\`.`, [
    ['10 5\nu1 0\nu1 5\nu2 8\nu1 30\nu2 40', 'u1:2\nu2:2', false],
    ['15 3\na 1\nb 2\na 16', 'a:1\nb:1', false],
    ['0 3\na 1\na 1\na 2', 'a:2', true],
  ]],
  ['Dependency Release Order', 'Graphs', 'MEDIUM', `# Dependency Release Order

Given package dependencies, output a valid lexicographically smallest build order.

Input: \`n m\`, then \`n\` package names, then \`m\` dependency lines \`before after\`. Print \`CYCLE\` if no valid order exists.`, [
    ['4 3\napi\nweb\ndb\ncache\ndb api\napi web\ncache web', 'cache db api web', false],
    ['3 2\na\nb\nc\na b\nb a', 'CYCLE', false],
    ['3 0\nz\na\nm', 'a m z', true],
  ]],
  ['Rate Limit Burst Buckets', 'Queues', 'MEDIUM', `# Rate Limit Burst Buckets

Simulate a per-user sliding-window rate limiter.

Input: \`limit window n\`, then \`n\` lines \`time user\`. For each request print \`ALLOW\` if the user has fewer than \`limit\` accepted requests in the last \`window\` seconds inclusive, otherwise \`BLOCK\`.`, [
    ['2 10 5\n0 a\n3 a\n9 a\n11 a\n12 b', 'ALLOW\nALLOW\nBLOCK\nALLOW\nALLOW', false],
    ['1 5 3\n0 x\n5 x\n6 x', 'ALLOW\nBLOCK\nALLOW', false],
    ['2 0 3\n1 a\n1 a\n1 a', 'ALLOW\nALLOW\nBLOCK', true],
  ]],
  ['SLA Breach Intervals', 'Intervals', 'MEDIUM', `# SLA Breach Intervals

Merge incident intervals and compute total downtime per service.

Input: \`n\`, then \`n\` lines \`service start end\`. Intervals touching at endpoints are continuous. Print services alphabetically as \`service:minutes\`.`, [
    ['4\napi 0 10\napi 10 15\nweb 5 8\napi 20 25', 'api:20\nweb:3', false],
    ['3\na 1 3\na 2 5\na 6 7', 'a:5', false],
    ['2\nz 5 5\nz 5 6', 'z:1', true],
  ]],
  ['Config Drift Detector', 'Maps', 'MEDIUM', `# Config Drift Detector

Compare desired and actual key-value configuration snapshots.

Input: \`d a\`, then \`d\` desired lines \`key=value\`, then \`a\` actual lines. Print \`missing:key\`, \`extra:key\`, or \`changed:key\` sorted by key then issue type.`, [
    ['2 2\nA=1\nB=2\nA=1\nB=3', 'changed:B', false],
    ['1 2\nA=1\nA=1\nC=9', 'extra:C', false],
    ['2 1\nB=2\nA=1\nB=2', 'missing:A', true],
  ]],
  ['Shard Load Rebalancer', 'Binary Search', 'HARD', `# Shard Load Rebalancer

Split ordered shard loads across \`k\` workers while minimizing the maximum worker load. Shard order must be preserved.

Input: \`k n\`, then \`n\` positive integers. Print the minimal possible maximum load.`, [
    ['2 5\n7 2 5 10 8', '18', false],
    ['3 5\n1 2 3 4 5', '6', false],
    ['1 4\n9 1 1 1', '12', true],
  ]],
  ['Streaming Percentile Alerts', 'Heaps', 'HARD', `# Streaming Percentile Alerts

For each incoming latency, print the current median rounded down.

Input: \`n\`, then \`n\` integers. Output medians separated by spaces.`, [
    ['5\n5 15 1 3 8', '5 10 5 4 5', false],
    ['4\n10 9 8 7', '10 9 9 8', false],
    ['1\n42', '42', true],
  ]],
  ['Multi-Region Failover Planner', 'Dynamic Programming', 'HARD', `# Multi-Region Failover Planner

Given failover costs for regions over days, choose one region per day with no same region on consecutive days and minimum total cost.

Input: \`days regions\`, then a cost matrix. Print the minimum total cost, or \`IMPOSSIBLE\`.`, [
    ['3 3\n1 9 9\n9 1 9\n9 9 1', '3', false],
    ['2 1\n5\n6', 'IMPOSSIBLE', false],
    ['2 2\n5 1\n2 100', '3', true],
  ]],
]

function b64(s) { return Buffer.from(s, 'utf8').toString('base64') }
const projects = [
  ['BOM CSV kit aggregation misses duplicate students', 'EASY', 'PYTHON', 'Fix `bom.py` so it parses student BOM CSV rows, filters one department, de-duplicates repeated student-kit rows using the largest quantity, and returns sorted kit totals.', ['Duplicate student-kit rows use the largest quantity only', 'Only the requested department is counted', 'Output is sorted by kit name'], 'bom.py', `def summarize_bom(rows, department):\n    totals = {}\n    for row in rows:\n        student, dept, course, kit, qty = row.split(',')\n        if dept == department:\n            totals[kit] = totals.get(kit, 0) + int(qty)\n    return totals\n`],
  ['Import validator accepts malformed BOM rows', 'EASY', 'PYTHON', 'Fix `validator.py` so BOM import rows reject missing columns, negative quantity, blank student IDs, and unknown departments while collecting all row-level errors.', ['Invalid rows are rejected with row numbers', 'Valid rows are returned normalized', 'Multiple errors are collected without stopping early'], 'validator.py', `VALID_DEPTS = {'CSE','ECE','ME'}\ndef validate_rows(rows):\n    return [r.split(',') for r in rows]\n`],
  ['Session export drops late proctor events', 'EASY', 'JAVASCRIPT', 'Fix `exportEvents()` so events exactly on the end boundary are included, events are sorted stably, and duplicate event IDs are removed.', ['End-boundary events are included', 'Duplicate event IDs are removed', 'Events are returned sorted by timestamp then id'], 'events.js', `function exportEvents(events, start, end) {\n  return events.filter(e => e.ts > start && e.ts < end).sort((a,b) => a.ts - b.ts);\n}\nmodule.exports = { exportEvents };\n`],
  ['Assessment scheduler double-books candidate slots', 'MEDIUM', 'TYPESCRIPT', 'Fix `scheduler.ts` so overlapping intervals for the same candidate are rejected, touching intervals are allowed, and checks remain efficient for many slots.', ['Overlapping slots for the same candidate are rejected', 'Touching intervals are allowed', 'Different candidates do not conflict'], 'scheduler.ts', `export function canSchedule(slots: any[], next: any) {\n  return !slots.some(s => s.candidateId === next.candidateId && s.start <= next.end && next.start <= s.end);\n}\n`],
  ['Rubric weight normalizer silently changes totals', 'MEDIUM', 'PYTHON', 'Fix `rubric.py` so criteria weights must sum to 100, disabled criteria are excluded deliberately, and validation returns clear errors instead of silently normalizing.', ['Enabled weights must sum to 100', 'Disabled criteria are excluded', 'Validation errors name the bad criteria'], 'rubric.py', `def normalize(criteria):\n    total = sum(c['weight'] for c in criteria)\n    for c in criteria:\n        c['weight'] = c['weight'] * 100 / total\n    return criteria\n`],
  ['Candidate file sync overwrites newer edits', 'MEDIUM', 'JAVASCRIPT', 'Fix `sync.js` so file updates use per-file versions, reject stale writes, and merge independent file changes without overwriting newer content.', ['Stale writes are rejected', 'Independent file changes are preserved', 'Conflict responses include the current version'], 'sync.js', `function applyUpdate(files, update) {\n  files[update.path] = { content: update.content, version: update.version };\n  return files;\n}\nmodule.exports = { applyUpdate };\n`],
  ['Leaderboard pagination skips tied scores', 'MEDIUM', 'TYPESCRIPT', 'Fix `leaderboard.ts` so cursor pagination handles equal total scores, equal code scores, same submitted timestamp, and stable id tie-breaks.', ['No candidates are skipped across pages', 'No candidates are duplicated across pages', 'Tie ordering is stable by id'], 'leaderboard.ts', `export function pageAfter(rows: any[], cursor: any) {\n  return rows.filter(r => r.totalScore < cursor.totalScore).slice(0, cursor.limit);\n}\n`],
  ['Project scorer ignores deterministic caps', 'HARD', 'PYTHON', 'Fix `scorer.py` so weighted criterion scores are calculated, difficulty weights are applied, deterministic caps are enforced in the correct order, and audit details are returned.', ['Criterion contributions sum correctly', 'Difficulty weighting is applied', 'Final score is min(base score, all caps)', 'Audit output explains every cap'], 'scorer.py', `def score_task(criteria, difficulty_weight, caps):\n    base = sum(c['score'] for c in criteria) / len(criteria)\n    return base * difficulty_weight\n`],
  ['Concurrent submission finalizer creates duplicate scores', 'HARD', 'TYPESCRIPT', 'Fix `finalize.ts` so concurrent submit/finalize calls are idempotent, create one score row, and safely enqueue scoring exactly once.', ['Concurrent calls create one final session state', 'Only one score row is created', 'Scoring is enqueued once with retry-safe behavior'], 'finalize.ts', `export async function finalize(db: any, sessionId: string) {\n  await db.session.update({ id: sessionId, status: 'SUBMITTED' });\n  await db.score.create({ sessionId });\n  await db.queue.add({ sessionId });\n}\n`],
  ['Evidence retention cleanup deletes active recordings', 'HARD', 'JAVASCRIPT', 'Fix `retention.js` so cleanup deletes only expired evidence, batches deletions safely, skips active sessions, and reports partial failures without aborting the whole cleanup.', ['Active-session evidence is never deleted', 'Expired evidence is deleted in batches', 'Partial deletion failures are reported and cleanup continues'], 'retention.js', `async function cleanup(items, now, remove) {\n  for (const item of items) {\n    if (item.expiresAt <= now) await remove(item.id);\n  }\n}\nmodule.exports = { cleanup };\n`],
]

async function request(base, path, options = {}) {
  const res = await fetch(`${base}/api/v1${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} failed ${res.status}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}

async function apply(base) {
  const login = await request(base, '/auth/login', { method: 'POST', body: JSON.stringify({ email: env.MASTER_EMAIL, password: env.MASTER_PASSWORD }) })
  const auth = { Authorization: `Bearer ${login.data.access_token}` }
  const existingProblems = await request(base, '/library/problems?page=1&limit=100', { headers: auth })
  const existingTasks = await request(base, '/library/tasks', { headers: auth })
  for (const item of [...existingProblems.data, ...existingTasks.data]) {
    if (!weakTitles.includes(item.title)) continue
    const path = item.topic != null ? `/library/problems/${item.id}` : `/library/tasks/${item.id}`
    await request(base, path, { method: 'DELETE', headers: auth })
  }
  for (const [title, topic, difficulty, description, cases] of coding) {
    if (existingProblems.data.some((p) => p.title === title)) continue
    await request(base, '/library/problems', { method: 'POST', headers: auth, body: JSON.stringify({ title, topic, difficulty, description, allowCopyPaste: false, testCases: cases.map(([input, expected, isHidden]) => ({ input, expected, isHidden })) }) })
  }
  for (const [title, difficulty, language, description, doneWhen, file, content] of projects) {
    if (existingTasks.data.some((p) => p.title === title)) continue
    const referenceFiles = [{ path: file, contentBase64: b64(content) }]
    const solutionFiles = [{ path: file, contentBase64: b64(content.replace(/return totals/g, 'return dict(sorted(totals.items()))')) }]
    await request(base, '/library/tasks', { method: 'POST', headers: auth, body: JSON.stringify({ title, difficulty, language, description, doneWhen, referenceFiles, solutionFiles }) })
  }
  const afterProblems = await request(base, '/library/problems?page=1&limit=100', { headers: auth })
  const afterTasks = await request(base, '/library/tasks', { headers: auth })
  console.log(JSON.stringify({ base, coding: afterProblems.total, project: afterTasks.data.length }, null, 2))
}

const base = process.argv[2]
if (!base) throw new Error('Usage: node scripts/replaceLibraryQualitySet.js <baseUrl>')
apply(base).catch((err) => { console.error(err); process.exit(1) })
