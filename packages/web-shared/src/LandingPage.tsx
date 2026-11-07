import { useEffect, useRef, useState } from 'react'
import { motion, useInView, useReducedMotion, useScroll } from 'framer-motion'
import { Logo } from './Logo'
import { ParticleLogo } from './ParticleLogo'
import { ThemeToggle } from './ThemeToggle'
import { Reveal } from './Reveal'
import { ADMIN_URL, CANDIDATE_URL } from './appUrls'

const WORDMARK = 'apexcoder.io'

// Syntax-highlighted Two Sum snippet for the hero preview. Static tokens (VS Code
// dark palette) so the code reads as real; revealed line-by-line for the animation.
type Tok = { t: string; c?: string }
const KW = '#C586C0', FN = '#DCDCAA', VAR = '#9CDCFE', PUN = '#8B949E'
const CODE_LINES: Tok[][] = [
  [{ t: 'def ', c: KW }, { t: 'two_sum', c: FN }, { t: '(', c: PUN }, { t: 'nums', c: VAR }, { t: ', ', c: PUN }, { t: 'target', c: VAR }, { t: '):', c: PUN }],
  [{ t: '    seen ', c: VAR }, { t: '= {}', c: PUN }],
  [{ t: '    for ', c: KW }, { t: 'i', c: VAR }, { t: ', ', c: PUN }, { t: 'n', c: VAR }, { t: ' in ', c: KW }, { t: 'enumerate', c: FN }, { t: '(', c: PUN }, { t: 'nums', c: VAR }, { t: '):', c: PUN }],
  [{ t: '        if ', c: KW }, { t: 'target', c: VAR }, { t: ' - ', c: PUN }, { t: 'n', c: VAR }, { t: ' in ', c: KW }, { t: 'seen', c: VAR }, { t: ':', c: PUN }],
  [{ t: '            return ', c: KW }, { t: '[', c: PUN }, { t: 'seen', c: VAR }, { t: '[', c: PUN }, { t: 'target', c: VAR }, { t: ' - ', c: PUN }, { t: 'n', c: VAR }, { t: '], ', c: PUN }, { t: 'i', c: VAR }, { t: ']', c: PUN }],
  [{ t: '        seen', c: VAR }, { t: '[', c: PUN }, { t: 'n', c: VAR }, { t: '] = ', c: PUN }, { t: 'i', c: VAR }],
  [{ t: '    return ', c: KW }, { t: '[]', c: PUN }],
]

// Marketing landing page - sells apexcoder.io to hiring companies.
// Identical in web-candidate and web-admin (each app serves it at "/").
// Theme-aware via design tokens (light + dark); blue accent = --status-link.

const NAV_LINKS = [
  { label: 'Platform', href: '#platform' },
  { label: 'Why apexcoder', href: '#why' },
  { label: 'How it works', href: '#how' },
]

const FEATURES = [
  {
    title: 'A real editor, not a text box',
    body: 'Candidates solve in a full VS Code editor with the language tooling they know. What you see is how they actually build.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="m6.75 7.5 3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21 18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0 2.25 2.25Z" />
    ),
  },
  {
    title: 'Measure how they use AI',
    body: 'An embedded assistant is part of the assessment. apexcoder scores prompt quality, iteration efficiency, and independent judgement - the skills that matter in an AI-native team.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
    ),
  },
  {
    title: 'Signal you can defend',
    body: 'Hidden test cases, paste controls, and a full interaction log per candidate. Every score is auditable and comparable across your pipeline.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12c0 1.268-.63 2.39-1.593 3.068a3.745 3.745 0 0 1-1.043 3.296 3.745 3.745 0 0 1-3.296 1.043A3.745 3.745 0 0 1 12 21c-1.268 0-2.39-.63-3.068-1.593a3.746 3.746 0 0 1-3.296-1.043 3.745 3.745 0 0 1-1.043-3.296A3.745 3.745 0 0 1 3 12c0-1.268.63-2.39 1.593-3.068a3.745 3.745 0 0 1 1.043-3.296 3.746 3.746 0 0 1 3.296-1.043A3.746 3.746 0 0 1 12 3c1.268 0 2.39.63 3.068 1.593a3.746 3.746 0 0 1 3.296 1.043 3.746 3.746 0 0 1 1.043 3.296A3.745 3.745 0 0 1 21 12Z" />
    ),
  },
  {
    title: 'Decisions, not spreadsheets',
    body: 'Per-candidate reports and leaderboards combine code correctness with AI-usage into one comparable score. Share a defensible shortlist in minutes.',
    icon: (
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z" />
    ),
  },
]

const STATS = [
  { label: '4 AIU metrics scored per session' },
  { label: '10s sandboxed execution, network-isolated' },
  { label: 'Hidden test cases never reach the client' },
  { label: 'Full prompt/response log per candidate' },
]

const STEPS = [
  { n: '01', title: 'Invite', body: 'Send a single-use link. Candidates start in the browser - nothing to install.' },
  { n: '02', title: 'Assess', body: 'They build in a real IDE with an AI assistant, under time and integrity controls.' },
  { n: '03', title: 'Score', body: 'Code correctness and AI-usage combine into one comparable, defensible score.' },
]

const FOOTER_COLUMNS = [
  {
    title: 'Product',
    links: [
      { label: 'Platform', href: '#platform' },
      { label: 'Why apexcoder', href: '#why' },
      { label: 'How it works', href: '#how' },
    ],
  },
  {
    title: 'Access',
    links: [
      { label: 'Login', href: `${CANDIDATE_URL}/login` },
      { label: 'Book a demo', cal: true },
    ],
  },
  {
    title: 'Company',
    links: [
      { label: 'Contact', href: 'mailto:hello@apexcoder.io' },
      { label: 'Security', href: 'mailto:security@apexcoder.io' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: 'mailto:hello@apexcoder.io?subject=Privacy%20request' },
      { label: 'Terms', href: 'mailto:hello@apexcoder.io?subject=Terms%20request' },
    ],
  },
]

const CAL_LINK = 'apexcoder/discovery-call'
const CAL_CONFIG = '{"layout":"month_view"}'

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--status-link)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--bg-canvas)]'
const primaryBtn = 'bg-[color:var(--status-link)] text-[color:var(--bg-canvas)] transition hover:opacity-90'
const accent = 'text-[color:var(--status-link)]'

// Cal.com's official embed loader (https://cal.com/docs/embed), unmodified apart from the TS/idempotency guard.
function loadCalEmbed() {
  if ((window as any).Cal) return
  ;(function (C: any, A: string, L: string) {
    const p = (a: any, ar: unknown) => a.q.push(ar)
    const d = C.document
    C.Cal = C.Cal || function (...ar: unknown[]) {
      const cal = C.Cal
      if (!cal.loaded) {
        cal.ns = {}
        cal.q = cal.q || []
        d.head.appendChild(d.createElement('script')).src = A
        cal.loaded = true
      }
      if (ar[0] === L) {
        const api: any = (...apiAr: unknown[]) => p(api, apiAr)
        const namespace = ar[1]
        api.q = api.q || []
        if (typeof namespace === 'string') {
          cal.ns[namespace] = cal.ns[namespace] || api
          p(cal.ns[namespace], ar)
          p(cal, ['initNamespace', namespace])
        } else p(cal, ar)
        return
      }
      p(cal, ar)
    }
  })(window, 'https://app.cal.eu/embed/embed.js', 'init')
  ;(window as any).Cal('init', { origin: 'https://cal.eu' })
}

export function LandingPage() {
  const reduce = useReducedMotion()
  useEffect(loadCalEmbed, [])

  // Type the wordmark in on load: a_, ap_, ape_ … apexcoder.io
  const [typed, setTyped] = useState(reduce ? WORDMARK.length : 0)
  useEffect(() => {
    if (reduce || typed >= WORDMARK.length) return
    const id = setTimeout(() => setTyped((c) => c + 1), 180)
    return () => clearTimeout(id)
  }, [typed, reduce])
  const dot = WORDMARK.indexOf('.io') // 9
  const namePart = WORDMARK.slice(0, Math.min(typed, dot))
  const ioPart = typed > dot ? WORDMARK.slice(dot, typed) : ''
  const typingDone = typed >= WORDMARK.length

  const heroItem = {
    hidden: { opacity: 0, y: reduce ? 0 : 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' as const } },
  }

  // (8) Page scroll progress - thin accent bar under the sticky nav.
  const { scrollYProgress: pageProgress } = useScroll()

  // (6) Product preview: code lines reveal, then the pass count ticks up, once scrolled into view.
  const previewRef = useRef<HTMLDivElement>(null)
  const previewInView = useInView(previewRef, { once: true, amount: 0.4 })
  const [passed, setPassed] = useState(reduce ? 8 : 0)
  useEffect(() => {
    if (reduce || !previewInView || passed >= 8) return
    // Wait for the code lines to finish revealing (~0.9s) before the tests tick.
    const id = setTimeout(() => setPassed((p) => p + 1), passed === 0 ? 900 : 110)
    return () => clearTimeout(id)
  }, [previewInView, passed, reduce])

  // (4) "How it works" - a connector line fills as the section scrolls through view.
  const stepsRef = useRef<HTMLDivElement>(null)
  const { scrollYProgress: stepsProgress } = useScroll({ target: stepsRef, offset: ['start 0.8', 'end 0.3'] })

  return (
    <div className="min-h-dvh bg-[color:var(--bg-canvas)] font-sans text-[color:var(--text-primary)]">
      {/* (8) Scroll progress - fills as the page scrolls */}
      <motion.div
        aria-hidden="true"
        className="fixed inset-x-0 top-0 z-50 h-[2px] origin-left bg-[color:var(--status-link)]"
        style={{ scaleX: pageProgress }}
      />

      {/* ── Nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] backdrop-blur">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <Logo size={28} label="ApexCoder" />
          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map((l) => (
              <a key={l.href} href={l.href} className={`rounded text-sm font-medium text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--text-primary)] ${focusRing}`}>
                {l.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <a href={`${CANDIDATE_URL}/login`} className={`rounded-lg px-3 py-2 text-sm font-semibold text-[color:var(--text-secondary)] transition-colors hover:text-[color:var(--text-primary)] ${focusRing}`}>
              Login
            </a>
            <button
              type="button"
              data-cal-link={CAL_LINK}
              data-cal-config={CAL_CONFIG}
              className={`rounded-lg px-4 py-2 text-sm font-semibold ${primaryBtn} ${focusRing}`}
            >
              Book a demo
            </button>
          </div>
        </nav>
      </header>

      {/* ── Hero ────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-b border-[color:var(--border-subtle)] bg-gradient-to-b from-[color:var(--bg-raised)] to-[color:var(--bg-canvas)]">
        {/* (5) Ambient glow, slowly drifting rather than static */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-16 h-[520px] w-[520px] -translate-x-1/2 rounded-full"
          style={{ background: 'radial-gradient(closest-side, var(--signal-violet), transparent)', opacity: 0.14, filter: 'blur(60px)' }}
          animate={reduce ? undefined : { x: [0, 40, -30, 0], y: [0, -20, 30, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: 'easeInOut' }}
        />
        <div className="relative z-10 mx-auto max-w-7xl px-6 pb-16 pt-20 md:pt-24">
          <motion.div
            className="mx-auto max-w-3xl text-center"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.05 } } }}
          >
            {/* Big brand lockup - cube revolves continuously, wordmark types in on load */}
            <motion.div variants={heroItem} className="mb-10 flex items-center justify-center gap-9">
              <ParticleLogo size={190} />
              <span aria-label={WORDMARK} className="text-5xl font-bold tracking-tight text-[color:var(--text-primary)] md:text-6xl">
                <span aria-hidden="true">{namePart}<span className={accent}>{ioPart}</span></span>
                <span aria-hidden="true" className={`${accent} ${typingDone ? 'animate-pulse' : ''}`}>_</span>
              </span>
            </motion.div>
            <motion.span variants={heroItem} className={`inline-flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] px-3 py-1 text-xs font-semibold ${accent}`}>
              AI Coding Assessment Platform
            </motion.span>
            <motion.h1 variants={heroItem} className="mt-6 text-4xl font-bold leading-tight tracking-tight text-[color:var(--text-primary)] md:text-6xl">
              Hire engineers who can build with AI -
              <span className={accent}> and prove it.</span>
            </motion.h1>
            <motion.p variants={heroItem} className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[color:var(--text-secondary)]">
              apexcoder assesses real engineering in a real IDE with a real AI assistant, and
              scores both the code and how the candidate used AI. Proof, not proxies.
            </motion.p>
            <motion.div variants={heroItem} className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <button
                type="button"
                data-cal-link={CAL_LINK}
                data-cal-config={CAL_CONFIG}
                className={`w-full rounded-lg px-6 py-3 text-sm font-semibold sm:w-auto ${primaryBtn} ${focusRing}`}
              >
                Book a demo
              </button>
              <a href="#how" className={`w-full rounded-lg border border-[color:var(--border-strong)] bg-[color:var(--bg-raised)] px-6 py-3 text-sm font-semibold text-[color:var(--text-primary)] transition-colors hover:bg-[color:var(--bg-overlay)] sm:w-auto ${focusRing}`}>
                See how it works
              </a>
            </motion.div>
          </motion.div>

          {/* Product preview - a mock of the real 3-pane assessment IDE: code lines
              reveal, tests tick up, AI answers fade in, once scrolled into view (6) */}
          <Reveal className="mx-auto mt-16 max-w-6xl">
            <div ref={previewRef} className="overflow-hidden rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] shadow-xl shadow-black/20">
              {/* window chrome */}
              <div className="flex items-center gap-2 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-inset)] px-4 py-3">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
                <span className="ml-3 font-mono text-xs text-[color:var(--text-muted)]">apexcoder — Two Sum</span>
              </div>

              <div className="grid gap-px bg-[color:var(--border-subtle)] md:grid-cols-[0.85fr_1.4fr_0.9fr]">
                {/* Description */}
                <div className="hidden bg-[color:var(--bg-raised)] p-5 md:block">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[color:var(--text-primary)]">Two Sum</span>
                    <span className="rounded-full bg-[color:var(--signal-green-dim)] px-2 py-0.5 text-[10px] font-semibold text-[color:var(--signal-green)]">Easy</span>
                  </div>
                  <p className="mt-3 text-xs leading-6 text-[color:var(--text-secondary)]">
                    Return the indices of the two numbers that add up to <span className="font-mono text-[color:var(--text-primary)]">target</span>.
                  </p>
                  <div className="mt-4 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Input</p>
                    <p className="mt-1 font-mono text-xs text-[color:var(--text-secondary)]">[2,7,11,15], 9</p>
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">Expected</p>
                    <p className="mt-1 font-mono text-xs text-[color:var(--text-secondary)]">[0, 1]</p>
                  </div>
                </div>

                {/* Editor + result */}
                <div className="flex flex-col bg-[#0d1117]">
                  <div className="flex items-center gap-2 border-b border-white/5 px-4 py-2">
                    <span className="rounded-md bg-white/5 px-2 py-0.5 font-mono text-[11px] text-gray-300">solution.py</span>
                  </div>
                  <div className="flex-1 p-4 font-mono text-[12.5px] leading-6">
                    <motion.div
                      initial="hidden"
                      animate={previewInView || reduce ? 'show' : 'hidden'}
                      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.08 } } }}
                    >
                      {CODE_LINES.map((line, i) => (
                        <motion.div key={i} variants={{ hidden: { opacity: 0, y: 4 }, show: { opacity: 1, y: 0 } }} className="flex">
                          <span className="mr-4 w-4 shrink-0 select-none text-right text-gray-600">{i + 1}</span>
                          <span className="whitespace-pre">
                            {line.map((tok, j) => <span key={j} style={{ color: tok.c ?? '#d4d4d4' }}>{tok.t}</span>)}
                          </span>
                        </motion.div>
                      ))}
                    </motion.div>
                    <p className="mt-4 pl-8 text-[12px] text-[color:var(--signal-green)]"># {passed} / 8 tests passed</p>
                  </div>
                  {/* console / actions strip */}
                  <div className="flex items-center justify-between border-t border-white/5 px-4 py-2">
                    <span className="font-mono text-[11px] text-gray-500">Console · Testcase</span>
                    <span className="flex gap-2">
                      <span className="rounded-md bg-[color:var(--signal-green-dim)] px-3 py-1 text-[11px] font-semibold text-[color:var(--signal-green)]">Run</span>
                      <span className="rounded-md bg-[color:var(--signal-green)] px-3 py-1 text-[11px] font-semibold text-black">Submit</span>
                    </span>
                  </div>
                </div>

                {/* AI Assistant */}
                <div className="bg-[color:var(--bg-raised)] p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-[color:var(--signal-violet)]" />
                    <span className="font-mono text-xs text-[color:var(--text-secondary)]">openai/gpt-4o-mini</span>
                  </div>
                  <div className="space-y-3 text-[12.5px] leading-relaxed">
                    <motion.p
                      initial={{ opacity: 0, y: 6 }}
                      animate={previewInView || reduce ? { opacity: 1, y: 0 } : {}}
                      transition={{ delay: reduce ? 0 : 0.9 }}
                      className="ml-auto max-w-[90%] rounded-lg bg-[color:var(--signal-violet)] px-3 py-2 text-white"
                    >
                      How do I detect a duplicate in one pass?
                    </motion.p>
                    <motion.p
                      initial={{ opacity: 0, y: 6 }}
                      animate={previewInView || reduce ? { opacity: 1, y: 0 } : {}}
                      transition={{ delay: reduce ? 0 : 1.4 }}
                      className="max-w-[95%] rounded-lg border-l-2 border-[color:var(--signal-violet)] bg-[color:var(--bg-overlay)] px-3 py-2 text-[color:var(--text-secondary)]"
                    >
                      Track seen values in a hash map and check membership as you iterate — O(n).
                    </motion.p>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── Stats strip ─────────────────────────────────── */}
      <section className="border-b border-[color:var(--border-subtle)] py-10">
        <Reveal className="mx-auto max-w-7xl px-6">
          <dl className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {STATS.map((s) => (
              <div
                key={s.label}
                data-cursor="violet"
                className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-5 text-center transition-all duration-200 hover:-translate-y-1 hover:border-[color:var(--signal-violet)] hover:shadow-lg"
              >
                <dd className="text-sm font-medium leading-snug text-[color:var(--text-secondary)]">{s.label}</dd>
              </div>
            ))}
          </dl>
        </Reveal>
      </section>

      {/* ── Value line ──────────────────────────────────── */}
      <section id="why" className="border-b border-[color:var(--border-subtle)] py-16">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <Reveal>
            <p className="text-xl font-medium leading-relaxed text-[color:var(--text-secondary)] md:text-2xl">
              AI has changed how engineering teams deliver. The résumé no longer predicts who
              thrives - <span className="text-[color:var(--text-primary)]">how someone builds with AI does.</span>
            </p>
          </Reveal>
        </div>
      </section>

      {/* ── Features ────────────────────────────────────── */}
      <section id="platform" className="bg-[color:var(--bg-raised)] py-20">
        <div className="mx-auto max-w-7xl px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[color:var(--text-primary)] md:text-4xl">One platform, real signal</h2>
            <p className="mt-4 text-[color:var(--text-secondary)]">Everything you need to assess engineers for an AI-native world.</p>
          </Reveal>
          <div className="mt-14 grid gap-6 md:grid-cols-2">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 0.08}>
                <div
                  data-cursor="violet"
                  className="group h-full -translate-y-0 rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-7 transition-all duration-200 hover:-translate-y-1 hover:border-[color:var(--signal-violet)] hover:shadow-lg"
                >
                  <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--bg-inset)] transition-transform duration-200 group-hover:scale-110">
                    <svg className={`h-6 w-6 ${accent}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor">{f.icon}</svg>
                  </div>
                  <h3 className="mb-2 text-xl font-semibold text-[color:var(--text-primary)]">{f.title}</h3>
                  <p className="text-sm leading-relaxed text-[color:var(--text-secondary)]">{f.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────── */}
      <section id="how" className="py-20">
        <div className="mx-auto max-w-7xl px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-[color:var(--text-primary)] md:text-4xl">From invite to decision</h2>
          </Reveal>
          <div ref={stepsRef} className="relative mt-14">
            {/* (4) Connector line fills as the section scrolls through view */}
            <div className="relative mb-8 hidden md:block">
              <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[color:var(--border-subtle)]" />
              <motion.div
                className="absolute inset-y-0 left-0 top-1/2 h-px w-full origin-left -translate-y-1/2 bg-[color:var(--status-link)]"
                style={{ scaleX: stepsProgress }}
              />
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={i * 0.1}>
                  <div data-cursor="violet" className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] p-7 transition-colors duration-200 hover:border-[color:var(--signal-violet)]">
                    <p className={`font-mono text-3xl font-bold ${accent}`}>{s.n}</p>
                    <h3 className="mt-4 text-lg font-semibold text-[color:var(--text-primary)]">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-[color:var(--text-secondary)]">{s.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Testimonial ─────────────────────────────────── */}
      <section className="bg-[color:var(--bg-raised)] py-16">
        <div className="mx-auto max-w-4xl px-6">
          <Reveal>
            <figure className="rounded-2xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-overlay)] p-10 text-center">
              <blockquote className="text-xl font-medium leading-relaxed text-[color:var(--text-primary)] md:text-2xl">
                “We stopped guessing from résumés. apexcoder shows us who can actually build -
                and how they think with AI in the loop.”
              </blockquote>
              <figcaption className="mt-6 text-sm text-[color:var(--text-muted)]">
                VP Engineering · high-growth SaaS
              </figcaption>
            </figure>
          </Reveal>
        </div>
      </section>

      {/* ── Closing CTA ─────────────────────────────────── */}
      <section className="px-6 py-20">
        <Reveal className="mx-auto max-w-5xl">
          <div className="bg-brand-gradient overflow-hidden rounded-3xl px-8 py-14 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-white md:text-4xl">Hire for proof, not proxies</h2>
            <p className="mx-auto mt-4 max-w-xl text-white/85">See apexcoder assess a real candidate end-to-end.</p>
            <button
              type="button"
              data-cal-link={CAL_LINK}
              data-cal-config={CAL_CONFIG}
              className="mt-8 inline-block rounded-lg bg-white px-6 py-3 text-sm font-semibold text-[#0052a3] transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0052a3]"
            >
              Book a demo
            </button>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ──────────────────────────────────────── */}
      <footer className="border-t border-[color:var(--border-subtle)] bg-[color:var(--bg-raised)] py-12">
        <div className="mx-auto grid max-w-7xl gap-10 px-6 md:grid-cols-[1.5fr_repeat(4,1fr)]">
          <div>
            <Logo size={28} />
            <p className="mt-4 max-w-xs text-sm leading-6 text-[color:var(--text-muted)]">
              AI-native coding assessments with real IDE workflows, auditable scoring, and candidate reports.
            </p>
            <address className="mt-4 text-sm not-italic text-[color:var(--text-muted)]">
              <a className={`hover:text-[color:var(--text-primary)] ${focusRing}`} href="mailto:hello@apexcoder.io">hello@apexcoder.io</a>
            </address>
          </div>
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="text-sm font-semibold text-[color:var(--text-primary)]">{column.title}</h2>
              <ul className="mt-4 space-y-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    {'cal' in link ? (
                      <button
                        type="button"
                        data-cal-link={CAL_LINK}
                        data-cal-config={CAL_CONFIG}
                        className={`text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] ${focusRing}`}
                      >
                        {link.label}
                      </button>
                    ) : (
                      <a className={`text-sm text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)] ${focusRing}`} href={link.href}>
                        {link.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mx-auto mt-10 flex max-w-7xl flex-col gap-3 border-t border-[color:var(--border-subtle)] px-6 pt-6 text-sm text-[color:var(--text-muted)] sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 apexcoder.io. All rights reserved.</p>
          <p>AI Coding Assessment Platform</p>
        </div>
      </footer>
    </div>
  )
}
