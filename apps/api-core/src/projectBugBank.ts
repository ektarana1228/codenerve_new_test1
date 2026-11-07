export type ProjectBugBankFile = { path: string; contentBase64: string }

export type ProjectBugBankEntry = {
  id: string
  title: string
  difficulty: 'EASY' | 'MEDIUM' | 'HARD'
  language: 'PYTHON' | 'JAVASCRIPT' | 'TYPESCRIPT'
  description: string
  doneWhen: string[]
  files: ProjectBugBankFile[]
  solutionFiles: ProjectBugBankFile[]
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

// Each entry's file paths are prefixed with the entry id so that multiple bank
// selections in the same assessment can be merged into one referenceFiles /
// solutionFiles array without path collisions, and so worker-aiu can scope a
// task's solution files by matching `${task.bugBankId}/` at scoring time.
function files(id: string, entries: Record<string, string>): ProjectBugBankFile[] {
  return Object.entries(entries).map(([name, content]) => ({
    path: `${id}/${name}`,
    contentBase64: b64(content),
  }))
}

type Draft = Omit<ProjectBugBankEntry, 'files' | 'solutionFiles'> & {
  buggy: Record<string, string>
  fixed: Record<string, string>
}

const drafts: Draft[] = [
  {
    id: 'pagination-off-by-one',
    title: 'Pagination drops the last item',
    difficulty: 'EASY',
    language: 'JAVASCRIPT',
    description: [
      '# Bug report: Pagination drops the last item',
      '',
      '`paginate(items, page, pageSize)` is supposed to return exactly `pageSize`',
      'items per page. QA reports that the **last item of every page is missing**.',
      '',
      'Fix `pagination.js` so each page returns the correct items.',
    ].join('\n'),
    doneWhen: [
      'paginate(items, 1, 3) returns exactly 3 items when items.length >= 3',
      'The last page returns all remaining items without dropping the final element',
      'paginate() still returns a plain array (same signature, same export)',
    ],
    buggy: {
      'pagination.js': `function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize
  const end = start + pageSize - 1 // drops the last item of every page
  return items.slice(start, end)
}

module.exports = { paginate }
`,
    },
    fixed: {
      'pagination.js': `function paginate(items, page, pageSize) {
  const start = (page - 1) * pageSize
  const end = start + pageSize
  return items.slice(start, end)
}

module.exports = { paginate }
`,
    },
  },
  {
    id: 'mutable-default-argument',
    title: 'Inventory bucket leaks state between calls',
    difficulty: 'EASY',
    language: 'PYTHON',
    description: [
      '# Bug report: Inventory bucket leaks state between calls',
      '',
      '`add_item()` is called once per new order to build up a fresh bucket of',
      'items. Instead, unrelated orders are showing up in each other’s buckets.',
      '',
      'Fix `inventory.py` so each call without an explicit bucket starts empty.',
    ].join('\n'),
    doneWhen: [
      'Two separate calls to add_item("x") with no bucket argument do not share state',
      'Passing an explicit bucket list still appends to that same list (backward compatible)',
      'add_item() keeps its existing signature and return value',
    ],
    buggy: {
      'inventory.py': `def add_item(item, bucket=[]):
    bucket.append(item)
    return bucket
`,
    },
    fixed: {
      'inventory.py': `def add_item(item, bucket=None):
    if bucket is None:
        bucket = []
    bucket.append(item)
    return bucket
`,
    },
  },
  {
    id: 'missing-await',
    title: 'Order total comes out as NaN',
    difficulty: 'EASY',
    language: 'TYPESCRIPT',
    description: [
      '# Bug report: Order total comes out as NaN',
      '',
      '`computeTotal()` should sum the price of every id. In production it',
      'always returns `NaN`.',
      '',
      'Fix `totals.ts` so the total is computed correctly.',
    ].join('\n'),
    doneWhen: [
      'computeTotal(ids) returns a finite number, never NaN, for any non-empty ids array',
      'The returned total equals the sum of fetchPrice(id) for every id',
      'fetchPrice() itself is not modified',
    ],
    buggy: {
      'totals.ts': `async function fetchPrice(id: string): Promise<number> {
  return new Promise((resolve) => setTimeout(() => resolve(id.length * 10), 10))
}

export async function computeTotal(ids: string[]): Promise<number> {
  let total = 0
  for (const id of ids) {
    total += fetchPrice(id) as unknown as number // missing await
  }
  return total
}
`,
    },
    fixed: {
      'totals.ts': `async function fetchPrice(id: string): Promise<number> {
  return new Promise((resolve) => setTimeout(() => resolve(id.length * 10), 10))
}

export async function computeTotal(ids: string[]): Promise<number> {
  let total = 0
  for (const id of ids) {
    total += await fetchPrice(id)
  }
  return total
}
`,
    },
  },
  {
    id: 'stale-search-response',
    title: 'Search results flicker back to an old query',
    difficulty: 'MEDIUM',
    language: 'JAVASCRIPT',
    description: [
      '# Bug report: Search results flicker back to an old query',
      '',
      'The search box calls `search(query, onResult)` on every keystroke',
      '(debounced). Occasionally the results shown are for a **previous**,',
      'already-abandoned query - a slow response for an old query arrives',
      '*after* a faster response for the latest query and overwrites it.',
      '',
      'Fix `search.js` so a slow, stale response can never overwrite a newer one.',
    ].join('\n'),
    doneWhen: [
      'If an older query\'s fetch resolves after a newer query\'s fetch, onResult is only called with the newer query\'s results',
      'onResult is still called exactly once per query that is not superseded',
      'The debounce/search function signature (search(query, onResult)) is unchanged',
    ],
    buggy: {
      'search.js': `function debounce(fn, delay) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

function fakeFetch(query) {
  const delay = Math.random() * 200
  return new Promise((resolve) => setTimeout(() => resolve({ query, results: [\`result-for-\${query}\`] }), delay))
}

const search = debounce(async (query, onResult) => {
  const response = await fakeFetch(query)
  // no check that this response corresponds to the latest query
  onResult(response.results)
}, 50)

module.exports = { search }
`,
    },
    fixed: {
      'search.js': `function debounce(fn, delay) {
  let timer
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), delay)
  }
}

function fakeFetch(query) {
  const delay = Math.random() * 200
  return new Promise((resolve) => setTimeout(() => resolve({ query, results: [\`result-for-\${query}\`] }), delay))
}

let latestQuery = null

const search = debounce(async (query, onResult) => {
  latestQuery = query
  const response = await fakeFetch(query)
  if (response.query !== latestQuery) return // discard stale response
  onResult(response.results)
}, 50)

module.exports = { search }
`,
    },
  },
  {
    id: 'cache-key-missing-params',
    title: 'Product list cache ignores filters',
    difficulty: 'MEDIUM',
    language: 'JAVASCRIPT',
    description: [
      '# Bug report: Product list cache ignores filters',
      '',
      '`getProducts(req)` in `routes.js` caches results via `cache.js` to avoid',
      'repeated lookups. Candidates report that filtering by a different',
      'category returns **stale results from a previous, different filter**.',
      '',
      'Fix `routes.js` so the cache key accounts for the request filters. Do not',
      'change `cache.js`.',
    ].join('\n'),
    doneWhen: [
      'getProducts({ table: "products", filters: { category: "a" } }) and getProducts({ table: "products", filters: { category: "b" } }) return different, correct results even though both hit the same table',
      'Calling getProducts with the same table+filters twice in a row still returns the cached result on the second call (cache is still used)',
      'cache.js is unmodified',
    ],
    buggy: {
      'cache.js': `const store = new Map()

function cacheGet(key) { return store.get(key) }
function cacheSet(key, value) { store.set(key, value) }

module.exports = { cacheGet, cacheSet }
`,
      'routes.js': `const { cacheGet, cacheSet } = require('./cache')

function fakeQuery(table, filters) {
  return { table, filters, rows: [\`row-matching-\${JSON.stringify(filters)}\`] }
}

function getProducts(req) {
  const cacheKey = req.table // ignores req.filters entirely
  const cached = cacheGet(cacheKey)
  if (cached) return cached
  const result = fakeQuery(req.table, req.filters)
  cacheSet(cacheKey, result)
  return result
}

module.exports = { getProducts }
`,
    },
    fixed: {
      'cache.js': `const store = new Map()

function cacheGet(key) { return store.get(key) }
function cacheSet(key, value) { store.set(key, value) }

module.exports = { cacheGet, cacheSet }
`,
      'routes.js': `const { cacheGet, cacheSet } = require('./cache')

function fakeQuery(table, filters) {
  return { table, filters, rows: [\`row-matching-\${JSON.stringify(filters)}\`] }
}

function getProducts(req) {
  const cacheKey = \`\${req.table}:\${JSON.stringify(req.filters)}\`
  const cached = cacheGet(cacheKey)
  if (cached) return cached
  const result = fakeQuery(req.table, req.filters)
  cacheSet(cacheKey, result)
  return result
}

module.exports = { getProducts }
`,
    },
  },
  {
    id: 'bst-duplicate-infinite-recursion',
    title: 'Inserting a duplicate key hangs the server',
    difficulty: 'MEDIUM',
    language: 'PYTHON',
    description: [
      '# Bug report: Inserting a duplicate key hangs the server',
      '',
      'The BST `insert()` in `tree.py` is used to index unique-ish IDs. Whenever',
      'a duplicate key is inserted, the process **hangs and eventually crashes',
      'with a recursion error**.',
      '',
      'Fix `tree.py` so inserting a duplicate key is a safe no-op. Do not change',
      '`main.py`.',
    ].join('\n'),
    doneWhen: [
      'insert(root, key) where key already exists in the tree returns without raising RecursionError and without infinite recursion',
      'Inserting a duplicate key does not change the tree\'s in-order traversal (no new node is added)',
      'Inserting new, non-duplicate keys still places them in the correct left/right position',
    ],
    buggy: {
      'tree.py': `class Node:
    def __init__(self, key):
        self.key = key
        self.left = None
        self.right = None

def insert(node, key):
    if node is None:
        return Node(key)
    if key < node.key:
        node.left = insert(node.left, key)
    elif key > node.key:
        node.right = insert(node.right, key)
    else:
        # duplicate key: re-inserts into the SAME node with the SAME key,
        # so this branch calls itself forever.
        node.right = insert(node, key)
    return node

def inorder(node):
    if node is None:
        return []
    return inorder(node.left) + [node.key] + inorder(node.right)
`,
      'main.py': `from tree import insert, inorder

root = None
for key in [5, 3, 8, 3]:
    root = insert(root, key)

print(inorder(root))
`,
    },
    fixed: {
      'tree.py': `class Node:
    def __init__(self, key):
        self.key = key
        self.left = None
        self.right = None

def insert(node, key):
    if node is None:
        return Node(key)
    if key < node.key:
        node.left = insert(node.left, key)
    elif key > node.key:
        node.right = insert(node.right, key)
    else:
        return node  # duplicate key: tree already contains it, no-op
    return node

def inorder(node):
    if node is None:
        return []
    return inorder(node.left) + [node.key] + inorder(node.right)
`,
      'main.py': `from tree import insert, inorder

root = None
for key in [5, 3, 8, 3]:
    root = insert(root, key)

print(inorder(root))
`,
    },
  },
  {
    id: 'unsafe-query-builder',
    title: 'Looking up a user by name breaks on an apostrophe',
    difficulty: 'MEDIUM',
    language: 'JAVASCRIPT',
    description: [
      '# Bug report: Looking up a user by name breaks on an apostrophe',
      '',
      '`findUserByName()` in `queryBuilder.js` builds its query by concatenating',
      'the raw name into the query string. Looking up `"O\'Brien"` returns wrong',
      '(or no) results, and the concatenation pattern is exactly the shape that',
      'causes SQL injection against a real database.',
      '',
      '`db.js` already supports parameterized queries via a `?` placeholder -',
      'use that instead of string concatenation. Do not change `db.js`.',
    ].join('\n'),
    doneWhen: [
      'findUserByName("O\'Brien") returns the matching user record instead of throwing or returning the wrong rows',
      'The query is built using the parameterized ? placeholder, not string interpolation of the raw name',
      'findUserByName("Alice") and findUserByName("Bob") keep returning exactly one correct user each',
    ],
    buggy: {
      'db.js': `const rows = [
  { id: 1, name: "O'Brien", role: 'admin' },
  { id: 2, name: 'Alice', role: 'user' },
  { id: 3, name: 'Bob', role: 'user' },
]

// A tiny fake query engine so the bug is observable without a real database.
function runQuery(sql, params = []) {
  if (sql.includes('?')) {
    const match = sql.match(/WHERE\\s+(\\w+)\\s*=\\s*\\?/i)
    if (!match) return rows
    const [, field] = match
    return rows.filter((row) => String(row[field]) === String(params[0]))
  }
  const match = sql.match(/WHERE\\s+(\\w+)\\s*=\\s*'(.*)'/i)
  if (!match) return rows
  const [, field, value] = match
  return rows.filter((row) => String(row[field]) === value)
}

module.exports = { runQuery }
`,
      'queryBuilder.js': `const { runQuery } = require('./db')

function findUserByName(name) {
  // string-concatenated query - breaks on names containing a quote and is
  // the textbook SQL-injection shape.
  const sql = \`SELECT * FROM users WHERE name = '\${name}'\`
  return runQuery(sql)
}

module.exports = { findUserByName }
`,
    },
    fixed: {
      'db.js': `const rows = [
  { id: 1, name: "O'Brien", role: 'admin' },
  { id: 2, name: 'Alice', role: 'user' },
  { id: 3, name: 'Bob', role: 'user' },
]

// A tiny fake query engine so the bug is observable without a real database.
function runQuery(sql, params = []) {
  if (sql.includes('?')) {
    const match = sql.match(/WHERE\\s+(\\w+)\\s*=\\s*\\?/i)
    if (!match) return rows
    const [, field] = match
    return rows.filter((row) => String(row[field]) === String(params[0]))
  }
  const match = sql.match(/WHERE\\s+(\\w+)\\s*=\\s*'(.*)'/i)
  if (!match) return rows
  const [, field, value] = match
  return rows.filter((row) => String(row[field]) === value)
}

module.exports = { runQuery }
`,
      'queryBuilder.js': `const { runQuery } = require('./db')

function findUserByName(name) {
  return runQuery('SELECT * FROM users WHERE name = ?', [name])
}

module.exports = { findUserByName }
`,
    },
  },
  {
    id: 'event-listener-leak',
    title: 'Remounted widget logs every event multiple times',
    difficulty: 'HARD',
    language: 'TYPESCRIPT',
    description: [
      '# Bug report: Remounted widget logs every event multiple times',
      '',
      'A `Widget` subscribes to a shared `EventBus` on `mount()`. When a widget',
      'is unmounted and remounted (common during navigation), each subsequent',
      'event gets logged **multiple times** by the same widget instance.',
      '',
      'Fix `component.ts` so `unmount()` actually removes the listener that',
      '`mount()` added. Do not change `bus.ts`.',
    ].join('\n'),
    doneWhen: [
      'Mounting a Widget, unmounting it, then remounting it and emitting one event results in exactly one log entry, not two',
      'unmount() removes only this widget\'s own handler, never another widget\'s handler on the same bus',
      'EventBus.on/off/emit signatures in bus.ts are unchanged',
    ],
    buggy: {
      'bus.ts': `type Handler = (payload: unknown) => void

export class EventBus {
  private handlers: Handler[] = []
  on(handler: Handler): void { this.handlers.push(handler) }
  off(handler: Handler): void {
    this.handlers = this.handlers.filter((h) => h !== handler)
  }
  emit(payload: unknown): void { this.handlers.forEach((h) => h(payload)) }
}
`,
      'component.ts': `import { EventBus } from './bus'

export class Widget {
  private log: string[] = []
  constructor(private bus: EventBus) {}

  mount(): void {
    // subscribes on every mount but never unsubscribes on unmount
    this.bus.on((payload) => this.log.push(String(payload)))
  }

  unmount(): void {
    // no-op - the listener from mount() is never removed
  }

  getLog(): string[] { return this.log }
}
`,
    },
    fixed: {
      'bus.ts': `type Handler = (payload: unknown) => void

export class EventBus {
  private handlers: Handler[] = []
  on(handler: Handler): void { this.handlers.push(handler) }
  off(handler: Handler): void {
    this.handlers = this.handlers.filter((h) => h !== handler)
  }
  emit(payload: unknown): void { this.handlers.forEach((h) => h(payload)) }
}
`,
      'component.ts': `import { EventBus } from './bus'

export class Widget {
  private log: string[] = []
  private handler = (payload: unknown) => this.log.push(String(payload))
  constructor(private bus: EventBus) {}

  mount(): void { this.bus.on(this.handler) }
  unmount(): void { this.bus.off(this.handler) }

  getLog(): string[] { return this.log }
}
`,
    },
  },
  {
    id: 'transfer-deadlock',
    title: 'Concurrent transfers between the same two accounts hang',
    difficulty: 'HARD',
    language: 'PYTHON',
    description: [
      '# Bug report: Concurrent transfers between the same two accounts hang',
      '',
      '`transfer(source, dest, amount)` in `transfer.py` locks both accounts',
      'before moving funds. Under load, two threads running',
      '`transfer(a, b, ...)` and `transfer(b, a, ...)` at the same time',
      '**deadlock** and the service becomes unresponsive.',
      '',
      'Fix `transfer.py` so concurrent transfers between the same two accounts',
      'never deadlock, regardless of direction. Do not change `bank.py`.',
    ].join('\n'),
    doneWhen: [
      'Running transfer(a, b, x) and transfer(b, a, y) concurrently on two threads always completes without deadlocking, across repeated runs',
      'transfer() still raises ValueError when source.balance < amount',
      'Account balances are correct after any completed transfer (no lost updates)',
    ],
    buggy: {
      'bank.py': `import threading

class Account:
    def __init__(self, balance):
        self.balance = balance
        self.lock = threading.Lock()
`,
      'transfer.py': `from bank import Account

def transfer(source: Account, dest: Account, amount: int):
    # always locks source first, then dest - two concurrent transfers in
    # opposite directions acquire the locks in opposite order and can deadlock.
    with source.lock:
        with dest.lock:
            if source.balance < amount:
                raise ValueError('insufficient funds')
            source.balance -= amount
            dest.balance += amount
`,
    },
    fixed: {
      'bank.py': `import threading

class Account:
    def __init__(self, balance):
        self.balance = balance
        self.lock = threading.Lock()
`,
      'transfer.py': `from bank import Account

def transfer(source: Account, dest: Account, amount: int):
    # Always acquire locks in a consistent global order (by object identity)
    # regardless of transfer direction, so opposite-direction transfers can
    # never wait on each other's locks.
    first, second = (source, dest) if id(source) < id(dest) else (dest, source)
    with first.lock:
        with second.lock:
            if source.balance < amount:
                raise ValueError('insufficient funds')
            source.balance -= amount
            dest.balance += amount
`,
    },
  },
  {
    id: 'rate-limiter-refill-math',
    title: 'Rate limiter never refills under rapid requests',
    difficulty: 'HARD',
    language: 'JAVASCRIPT',
    description: [
      '# Bug report: Rate limiter never refills under rapid requests',
      '',
      '`TokenBucket` in `rateLimiter.js` is supposed to refill gradually based',
      'on elapsed time. Under load (requests arriving faster than once per',
      'second), the bucket **stops refilling entirely** and every request past',
      'the initial capacity is rejected, even minutes later.',
      '',
      'Fix `rateLimiter.js` so refill accounts for sub-second elapsed time. Do',
      'not change `server.js`.',
    ].join('\n'),
    doneWhen: [
      'A bucket with refillPerSecond=10 refills a fractional number of tokens correctly when checked at sub-second intervals (e.g. 100ms apart), not only on whole-second boundaries',
      'tryConsume() never allows this.tokens to exceed this.capacity',
      'The TokenBucket constructor and tryConsume() signatures are unchanged',
    ],
    buggy: {
      'rateLimiter.js': `class TokenBucket {
  constructor(capacity, refillPerSecond) {
    this.capacity = capacity
    this.tokens = capacity
    this.refillPerSecond = refillPerSecond
    this.lastRefill = Date.now()
  }

  _refill() {
    const now = Date.now()
    // truncates sub-second elapsed time to 0 - bursts of requests within the
    // same second never refill.
    const elapsedSeconds = Math.floor((now - this.lastRefill) / 1000)
    const refillAmount = elapsedSeconds * this.refillPerSecond
    this.tokens = Math.min(this.capacity, this.tokens + refillAmount)
    this.lastRefill = now
  }

  tryConsume() {
    this._refill()
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

module.exports = { TokenBucket }
`,
      'server.js': `const { TokenBucket } = require('./rateLimiter')

function handleRequest(bucket) {
  return bucket.tryConsume() ? 'ok' : 'rate_limited'
}

module.exports = { handleRequest }
`,
    },
    fixed: {
      'rateLimiter.js': `class TokenBucket {
  constructor(capacity, refillPerSecond) {
    this.capacity = capacity
    this.tokens = capacity
    this.refillPerSecond = refillPerSecond
    this.lastRefill = Date.now()
  }

  _refill() {
    const now = Date.now()
    const elapsedSeconds = (now - this.lastRefill) / 1000 // fractional, not truncated
    if (elapsedSeconds <= 0) return
    const refillAmount = elapsedSeconds * this.refillPerSecond
    this.tokens = Math.min(this.capacity, this.tokens + refillAmount)
    this.lastRefill = now
  }

  tryConsume() {
    this._refill()
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }
}

module.exports = { TokenBucket }
`,
      'server.js': `const { TokenBucket } = require('./rateLimiter')

function handleRequest(bucket) {
  return bucket.tryConsume() ? 'ok' : 'rate_limited'
}

module.exports = { handleRequest }
`,
    },
  },
  {
    id: 'ai-model-batching',
    title: 'Model inference drops requests under load',
    difficulty: 'MEDIUM',
    language: 'PYTHON',
    description: [
      '# Bug report: Model inference drops requests',
      '',
      '`process_batch()` in `inference.py` processes multiple requests using a dummy',
      'AI model. However, it overrides previous items in the batch array, losing requests.',
      '',
      'Fix `inference.py` so all inputs are accumulated and returned correctly.',
    ].join('\n'),
    doneWhen: [
      'process_batch(["req1", "req2"]) returns predictions for both requests',
      'It preserves the order of incoming requests',
    ],
    buggy: {
      'inference.py': `def process_batch(requests):\n    res = []\n    for r in requests:\n        res = [r + "_pred"]\n    return res\n`,
    },
    fixed: {
      'inference.py': `def process_batch(requests):\n    res = []\n    for r in requests:\n        res.append(r + "_pred")\n    return res\n`,
    },
  },
  {
    id: 'ml-feature-scaling',
    title: 'Min-Max scaler divides by zero',
    difficulty: 'EASY',
    language: 'PYTHON',
    description: [
      '# Bug report: Scaler throws ZeroDivisionError',
      '',
      '`scale_features(data)` in `scaler.py` scales data to [0, 1].',
      'When all values are the same, it divides by zero.',
      '',
      'Fix `scaler.py` to return an array of zeros when max == min.',
    ].join('\n'),
    doneWhen: [
      'scale_features([5, 5, 5]) returns [0, 0, 0]',
      'scale_features([0, 10]) returns [0.0, 1.0]',
    ],
    buggy: {
      'scaler.py': `def scale_features(data):\n    min_v = min(data)\n    max_v = max(data)\n    return [(x - min_v) / (max_v - min_v) for x in data]\n`,
    },
    fixed: {
      'scaler.py': `def scale_features(data):\n    min_v = min(data)\n    max_v = max(data)\n    if min_v == max_v:\n        return [0.0 for _ in data]\n    return [(x - min_v) / (max_v - min_v) for x in data]\n`,
    },
  },
  {
    id: 'text-tokenization-offset',
    title: 'Tokenizer ignores punctuation',
    difficulty: 'MEDIUM',
    language: 'JAVASCRIPT',
    description: [
      '# Bug report: Tokenizer ignores punctuation',
      '',
      '`tokenize(text)` in `nlp.js` strips punctuation completely, but downstream NLP tasks',
      'need punctuation as separate tokens.',
      '',
      'Fix `nlp.js` to treat punctuation marks (!, ?, .) as standalone tokens.',
    ].join('\n'),
    doneWhen: [
      'tokenize("Hello, world!") returns ["Hello", ",", "world", "!"]',
    ],
    buggy: {
      'nlp.js': `function tokenize(text) {\n  return text.replace(/[.,!?]/g, '').split(/\\s+/);\n}\nmodule.exports = { tokenize };\n`,
    },
    fixed: {
      'nlp.js': `function tokenize(text) {\n  return text.match(/\\w+|[.,!?]/g) || [];\n}\nmodule.exports = { tokenize };\n`,
    },
  },
  {
    id: 'kmeans-empty-cluster',
    title: 'K-Means crashes on empty cluster',
    difficulty: 'HARD',
    language: 'PYTHON',
    description: [
      '# Bug report: K-Means crashes on empty cluster',
      '',
      '`update_centroids(clusters)` in `kmeans.py` recalculates centroid means.',
      'If a cluster has no points, `sum()` over empty list crashes or returns 0 instead of maintaining the old centroid.',
      '',
      'Fix `kmeans.py` to keep the old centroid if a cluster is empty.',
    ].join('\n'),
    doneWhen: [
      'update_centroids keeps previous centroid for empty clusters',
    ],
    buggy: {
      'kmeans.py': `def update_centroids(clusters, old_centroids):\n    return [sum(cluster)/len(cluster) for cluster in clusters]\n`,
    },
    fixed: {
      'kmeans.py': `def update_centroids(clusters, old_centroids):\n    res = []\n    for i, cluster in enumerate(clusters):\n        if not cluster:\n            res.append(old_centroids[i])\n        else:\n            res.append(sum(cluster)/len(cluster))\n    return res\n`,
    },
  },
  {
    id: 'recommender-cold-start',
    title: 'Recommender returns undefined for new users',
    difficulty: 'MEDIUM',
    language: 'TYPESCRIPT',
    description: [
      '# Bug report: Recommender fails for new users',
      '',
      '`recommend(userId)` in `rec.ts` throws when user has no history.',
      'It should return popular items as a fallback.',
      '',
      'Fix `rec.ts` to return `["pop1", "pop2"]` if user history is empty.',
    ].join('\n'),
    doneWhen: [
      'recommend("new_user") returns popular items',
    ],
    buggy: {
      'rec.ts': `const history: Record<string, string[]> = { "u1": ["itemA"] };\nexport function recommend(userId: string): string[] {\n  return history[userId].map(x => x + "_sim");\n}\n`,
    },
    fixed: {
      'rec.ts': `const history: Record<string, string[]> = { "u1": ["itemA"] };\nexport function recommend(userId: string): string[] {\n  const hist = history[userId];\n  if (!hist || hist.length === 0) return ["pop1", "pop2"];\n  return hist.map(x => x + "_sim");\n}\n`,
    },
  },
  {
    id: 'dataset-train-test-split',
    title: 'Train-test split includes overlapping data',
    difficulty: 'EASY',
    language: 'PYTHON',
    description: [
      '# Bug report: Train and test sets overlap',
      '',
      '`split_data(data, ratio)` in `split.py` duplicates elements into both train and test sets.',
      '',
      'Fix `split.py` to properly slice the list into two disjoint sets.',
    ].join('\n'),
    doneWhen: [
      'split_data returns completely disjoint train and test lists',
      'The lengths sum up to the original data length',
    ],
    buggy: {
      'split.py': `def split_data(data, ratio=0.8):\n    idx = int(len(data) * ratio)\n    return data[:idx], data[idx-1:]\n`,
    },
    fixed: {
      'split.py': `def split_data(data, ratio=0.8):\n    idx = int(len(data) * ratio)\n    return data[:idx], data[idx:]\n`,
    },
  },
  {
    id: 'prompt-injection-sanitizer',
    title: 'Sanitizer fails to strip system prompt leaks',
    difficulty: 'MEDIUM',
    language: 'JAVASCRIPT',
    description: [
      '# Bug report: Sanitizer misses uppercase injection tags',
      '',
      '`sanitize(prompt)` in `llm.js` removes `<system>` tags, but is case-sensitive.',
      '',
      'Fix `llm.js` to remove tags case-insensitively.',
    ].join('\n'),
    doneWhen: [
      'sanitize("<SYSTEM> ignore rules") strips the tag',
    ],
    buggy: {
      'llm.js': `function sanitize(text) {\n  return text.replace(/<system>/g, '');\n}\nmodule.exports = { sanitize };\n`,
    },
    fixed: {
      'llm.js': `function sanitize(text) {\n  return text.replace(/<system>/gi, '');\n}\nmodule.exports = { sanitize };\n`,
    },
  },
  {
    id: 'gradient-descent-divergence',
    title: 'Gradient descent diverges instead of converging',
    difficulty: 'HARD',
    language: 'PYTHON',
    description: [
      '# Bug report: Optimizer updates weights in the wrong direction',
      '',
      '`optimize(w, grad, lr)` in `optim.py` adds the gradient instead of subtracting it.',
      '',
      'Fix `optim.py` to correctly step in the direction of steepest descent.',
    ].join('\n'),
    doneWhen: [
      'optimize(w, grad, lr) subtracts lr * grad from w',
    ],
    buggy: {
      'optim.py': `def optimize(w, grad, lr):\n    return w + lr * grad\n`,
    },
    fixed: {
      'optim.py': `def optimize(w, grad, lr):\n    return w - lr * grad\n`,
    },
  },
  {
    id: 'matrix-dot-product',
    title: 'Dot product incorrectly transposes dimensions',
    difficulty: 'MEDIUM',
    language: 'JAVASCRIPT',
    description: [
      '# Bug report: Dot product loops are swapped',
      '',
      '`dot(a, b)` in `math.js` computes 1D dot product but returns NaN for valid arrays.',
      '',
      'Fix `math.js` to properly compute sum(a[i]*b[i]).',
    ].join('\n'),
    doneWhen: [
      'dot([1, 2], [3, 4]) returns 11',
    ],
    buggy: {
      'math.js': `function dot(a, b) {\n  let sum = 0;\n  for(let i=1; i<=a.length; i++) sum += a[i] * b[i];\n  return sum;\n}\nmodule.exports = { dot };\n`,
    },
    fixed: {
      'math.js': `function dot(a, b) {\n  let sum = 0;\n  for(let i=0; i<a.length; i++) sum += a[i] * b[i];\n  return sum;\n}\nmodule.exports = { dot };\n`,
    },
  },
  {
    id: 'data-imputation-mean',
    title: 'Imputer replaces nulls with 0 instead of mean',
    difficulty: 'MEDIUM',
    language: 'PYTHON',
    description: [
      '# Bug report: Missing values are zeroed out',
      '',
      '`impute(data)` in `clean.py` should replace `None` with the mean of valid values.',
      'Instead, it replaces them with 0.',
      '',
      'Fix `clean.py` to calculate the mean of non-None values and use it for imputation.',
    ].join('\n'),
    doneWhen: [
      'impute([2, 4, None]) returns [2, 4, 3]',
    ],
    buggy: {
      'clean.py': `def impute(data):\n    return [0 if x is None else x for x in data]\n`,
    },
    fixed: {
      'clean.py': `def impute(data):\n    valid = [x for x in data if x is not None]\n    mean = sum(valid)/len(valid) if valid else 0\n    return [mean if x is None else x for x in data]\n`,
    },
  },
]

export const projectBugBank: ProjectBugBankEntry[] = drafts.map((draft) => ({
  id: draft.id,
  title: draft.title,
  difficulty: draft.difficulty,
  language: draft.language,
  description: draft.description,
  doneWhen: draft.doneWhen,
  files: files(draft.id, draft.buggy),
  solutionFiles: files(draft.id, draft.fixed),
}))
