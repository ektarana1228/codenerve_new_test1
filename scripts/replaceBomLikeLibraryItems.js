const fs = require('fs')
const env = Object.fromEntries(fs.readFileSync('.env', 'utf8').split(/\r?\n/).map((line) => {
  const idx = line.indexOf('=')
  return idx > 0 ? [line.slice(0, idx), line.slice(idx + 1)] : null
}).filter(Boolean))

const removeTitles = [
  'Student BOM Enrollment Audit',
  'BOM CSV kit aggregation misses duplicate students',
  'Import validator accepts malformed BOM rows',
]

const codingReplacement = {
  title: 'Vendor Invoice Reconciliation',
  topic: 'Data Structures',
  difficulty: 'EASY',
  description: `# Vendor Invoice Reconciliation

Given purchase-order lines and invoice lines, identify mismatches by item code.

Input: \`p i\`, then \`p\` lines \`item,quantity,unit_price\`, then \`i\` invoice lines in the same format.

For each item appearing in either list, compare total quantity and total amount. Print mismatched items alphabetically as \`item:quantity_diff,amount_diff\`. If there are no mismatches, print \`OK\`.`,
  testCases: [
    { input: '2 2\nA,2,10\nB,1,5\nA,1,10\nB,1,5', expected: 'A:-1,-10', isHidden: false },
    { input: '1 1\nX,3,7\nX,3,7', expected: 'OK', isHidden: false },
    { input: '1 2\nA,1,10\nA,1,10\nC,2,4', expected: 'C:2,8', isHidden: true },
  ],
}

const projectReplacements = [
  {
    title: 'Invoice parser drops adjustment rows',
    difficulty: 'EASY',
    language: 'PYTHON',
    description: 'Fix `invoice.py` so invoice totals include regular rows, discount rows, and tax adjustment rows while rejecting malformed amounts with clear row-level errors.',
    doneWhen: ['Discount and tax adjustment rows affect totals correctly', 'Malformed amount rows are reported without stopping processing', 'Totals are grouped by invoice id'],
    file: 'invoice.py',
    content: `def summarize(rows):\n    totals = {}\n    for row in rows:\n        invoice_id, kind, amount = row.split(',')\n        if kind == 'ITEM':\n            totals[invoice_id] = totals.get(invoice_id, 0) + float(amount)\n    return totals\n`,
  },
  {
    title: 'CSV import accepts duplicate employee records',
    difficulty: 'EASY',
    language: 'PYTHON',
    description: 'Fix `employees.py` so employee imports detect duplicate employee ids, validate required fields, and return accepted records plus all validation errors.',
    doneWhen: ['Duplicate employee ids are rejected', 'Missing required fields include row numbers', 'Valid records are normalized and preserved'],
    file: 'employees.py',
    content: `def import_employees(rows):\n    return [dict(zip(['id','name','role'], row.split(','))) for row in rows]\n`,
  },
]

function b64(s) { return Buffer.from(s, 'utf8').toString('base64') }
async function request(base, path, options = {}) {
  const res = await fetch(`${base}/api/v1${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } })
  if (!res.ok) throw new Error(`${options.method || 'GET'} ${path} failed ${res.status}: ${await res.text()}`)
  return res.status === 204 ? null : res.json()
}
async function apply(base) {
  const login = await request(base, '/auth/login', { method: 'POST', body: JSON.stringify({ email: env.MASTER_EMAIL, password: env.MASTER_PASSWORD }) })
  const auth = { Authorization: `Bearer ${login.data.access_token}` }
  const problems = await request(base, '/library/problems?page=1&limit=100', { headers: auth })
  const tasks = await request(base, '/library/tasks', { headers: auth })
  for (const item of problems.data) if (removeTitles.includes(item.title)) await request(base, `/library/problems/${item.id}`, { method: 'DELETE', headers: auth })
  for (const item of tasks.data) if (removeTitles.includes(item.title)) await request(base, `/library/tasks/${item.id}`, { method: 'DELETE', headers: auth })
  const refreshedProblems = await request(base, '/library/problems?page=1&limit=100', { headers: auth })
  if (!refreshedProblems.data.some((p) => p.title === codingReplacement.title)) {
    await request(base, '/library/problems', { method: 'POST', headers: auth, body: JSON.stringify({ ...codingReplacement, allowCopyPaste: false }) })
  }
  const refreshedTasks = await request(base, '/library/tasks', { headers: auth })
  for (const task of projectReplacements) {
    if (refreshedTasks.data.some((t) => t.title === task.title)) continue
    await request(base, '/library/tasks', {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        title: task.title,
        difficulty: task.difficulty,
        language: task.language,
        description: task.description,
        doneWhen: task.doneWhen,
        referenceFiles: [{ path: task.file, contentBase64: b64(task.content) }],
        solutionFiles: [{ path: task.file, contentBase64: b64(task.content) }],
      }),
    })
  }
  const afterProblems = await request(base, '/library/problems?page=1&limit=100', { headers: auth })
  const afterTasks = await request(base, '/library/tasks', { headers: auth })
  console.log(JSON.stringify({ base, coding: afterProblems.total, project: afterTasks.data.length }, null, 2))
}
apply(process.argv[2]).catch((err) => { console.error(err); process.exit(1) })
