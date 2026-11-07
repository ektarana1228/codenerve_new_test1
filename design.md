# design.md — apexcoder.io

Design direction for the apexcoder.io redesign. An AI-integrated coding interview / assessment platform. Candidates solve problems in a browser IDE with an embedded AI assistant; admins author assessments and read scored reports. Two roles: **Candidate** and **Admin**.

This file is the visual contract. `CLAUDE.md` governs how the system is built; this governs how it looks. When they touch the same surface (Monaco `theme: 'vs-dark'`, hidden-score rules), `CLAUDE.md` wins on behavior, this wins on appearance.

Synthesized from real references pulled via refero: **Vapi**, **Depot**, and **Linear/Changelog** for the visual language; **Factory.ai** and **Lovable** editors, **Attio**/**Kit** dashboards, **Homerun** candidate lists, and **Linear** issue detail for concrete product patterns.

---

## 1. North star

**A midnight command center for judged work.** The candidate is being measured; the interface should feel precise, calm, and serious — a well-lit instrument panel, not a marketing site. Depth comes from layered near-black surfaces and thin borders, never from heavy shadow. Color is scarce and *meaningful*.

### The signature: the dual-signal system

apexcoder scores two things at once — **code correctness** and **how the candidate used the AI** (`codeWeight` + `aiuWeight`, per `CLAUDE.md`). The entire accent palette encodes exactly those two axes, and nothing else:

- **Signal Green** → correctness, passing tests, "your code works."
- **Signal Violet** → AI-usage intelligence (AIU), the human↔AI interaction, the assistant itself.

Every other pixel is achromatic. Because the two accents are reserved for the two scored dimensions, the color *is* the product's mental model. A green pill always means "the code side," a violet glow always means "the AI side." This is the one thing that makes the platform recognizable and must not be diluted with decorative color.

> **Candidate-side caveat (hard rule from `CLAUDE.md`):** AIU scores are never shown to candidates. In the candidate app, Signal Violet marks the *AI assistant surface* (chat panel, prompt input, "AI is thinking"), never a score. Scored violet only appears in the admin app.

---

## 2. Color tokens

**Every page ships both a dark and a light theme.** Tokens are *semantic* — components reference `--bg-canvas`, `--text-primary`, `--signal-green`, etc., and never a raw hex. Switching theme just re-points those tokens, so no component knows or cares which mode it's in. Dark is the default (a judged coding tool reads best dark); the user can switch, and the choice persists (see §2.3).

The **Monaco editor tracks the app theme** — `vs-dark` in dark mode, a light Monaco theme (`vs` / a tuned custom light) in light mode — so the code surface flips with everything else on the user's toggle. *This intentionally relaxes `CLAUDE.md`'s "non-negotiable `vs-dark`" rule per the product owner; autocomplete-off and all other Monaco settings from `CLAUDE.md` still stand — update that line in `CLAUDE.md` to match.*

### 2.1 Dark theme (default)

| Token | Hex | Role |
|---|---|---|
| `--bg-canvas` | `#0A0B0E` | App background, deepest layer |
| `--bg-raised` | `#131418` | Cards, panels, editor gutter, nav bar |
| `--bg-overlay` | `#1A1C21` | Popovers, modals, dropdowns, hover fills |
| `--bg-inset` | `#08090B` | Recessed wells: code output, terminal, console |
| `--border-subtle` | `#24262C` | Default dividers and card borders |
| `--border-strong` | `#34373E` | Input borders, focus-adjacent, active separators |
| `--text-primary` | `#F5F6F7` | Headings, primary body, code |
| `--text-secondary` | `#C6CAD1` | Supporting copy, secondary labels |
| `--text-muted` | `#868B94` | Placeholders, timestamps, tertiary meta, disabled |
| `--signal-green` | `#57D98A` | Code correctness / pass |
| `--signal-green-dim` | `#1E3A2B` | Green pill/badge fill behind green text |
| `--signal-violet` | `#8B7BFF` | AI usage / AIU / assistant |
| `--signal-violet-dim` | `#241F42` | Violet pill/badge fill behind violet text |
| `--status-fail` | `#FF6B6B` | Failing tests, errors, destructive |
| `--status-fail-dim` | `#3A1F22` | Fill behind fail text |
| `--status-warn` | `#F5B84E` | Time low, rate-limit near, drafts |
| `--status-link` | `#6BA9FF` | Hyperlinks / inline nav text only |

### 2.2 Light theme

Same token names, re-pointed. Neutrals invert to layered off-whites; the two signals **darken for contrast** (a `#57D98A` on white fails text contrast — light mode uses deeper green/violet), and the dim fills become pale tints instead of deep shades. Meaning is identical; only the values move.

| Token | Hex | Role |
|---|---|---|
| `--bg-canvas` | `#FBFBFC` | App background |
| `--bg-raised` | `#FFFFFF` | Cards, panels, nav bar (lift with border + soft shadow) |
| `--bg-overlay` | `#FFFFFF` | Popovers, modals (rely on `--shadow-float`) |
| `--bg-inset` | `#F1F2F5` | Recessed wells, console, code output |
| `--border-subtle` | `#E7E9ED` | Default dividers and card borders |
| `--border-strong` | `#CDD2DA` | Input borders, active separators |
| `--text-primary` | `#14161A` | Headings, primary body |
| `--text-secondary` | `#454A52` | Supporting copy |
| `--text-muted` | `#71767F` | Placeholders, meta, disabled |
| `--signal-green` | `#12874A` | Correctness / pass (text-safe on light) |
| `--signal-green-dim` | `#E3F6EC` | Pale green pill fill |
| `--signal-violet` | `#5B4BD6` | AI / AIU / assistant (text-safe on light) |
| `--signal-violet-dim` | `#ECE9FD` | Pale violet pill fill |
| `--status-fail` | `#D93A3F` | Errors, destructive |
| `--status-fail-dim` | `#FCEAEA` | Pale fail fill |
| `--status-warn` | `#B7791A` | Time low, drafts |
| `--status-link` | `#2B6CF3` | Links / inline nav |

Green still means correctness, violet still means AI — in both themes, without exception. On light surfaces, use the *-dim* pale fills behind accent text (a green badge = deep-green text on pale-green fill); on dark, the dim is a deep shade. Verify accent-on-fill and text-on-canvas pairs hit **WCAG AA (4.5:1)** in *both* themes; the hexes above are chosen to pass.

### 2.3 Theming mechanism
- Theme is set by a `data-theme="dark|light"` attribute on `<html>`. `:root` holds dark; `[data-theme="light"]` overrides (see §11).
- **Default = system** via `prefers-color-scheme`; an explicit user choice (top-bar toggle, §5) overrides and persists to `localStorage`. Set the attribute pre-paint (tiny inline head script) to avoid a flash of the wrong theme (FOUC).
- The atmospheric violet glow (login/marketing) softens in light mode to a faint tint so it doesn't wash out.

**Rules**
- Green and violet are *semantic*, not stylistic — never a generic "primary" or a random highlight. If a button isn't about correctness or AI, it's neutral (see §6).
- No gradients on functional UI. One optional atmospheric violet glow behind the candidate hero / login only (§9), never behind data.
- Large fills stay achromatic in both themes. Accents live on text, 1px borders, small badges, icons, thin status bars — not big blocks.

---

## 3. Typography

Two families. Sans for everything human, mono for everything the machine produces or measures.

| Family | Token | Use |
|---|---|---|
| **Geist Sans** (fallback: Inter) | `--font-sans` | All UI text, headings, body, buttons, nav |
| **Geist Mono** (fallback: `ui-monospace`) | `--font-mono` | Code, scores, metrics, timestamps, invite tokens, test IDs, latency |

Mono is not just for code blocks — it is the voice of *measurement*. Every number that represents a judgment (a score, a pass count, a countdown, a turn number) is set in mono. This makes the platform read as instrumented.

### Discipline: refined weight, not heavy weight

Headlines use **weight 500**, not 700 (the Linear move). Authority comes from size, tight tracking, and space — not boldness. Reserve 600 for small emphatic labels only.

| Role | Size / LH | Weight | Tracking | Notes |
|---|---|---|---|---|
| Display (marketing hero) | 56 / 1.05 | 500 | -0.02em | Public page only |
| H1 (page title) | 32 / 1.15 | 500 | -0.02em | |
| H2 (section) | 22 / 1.25 | 500 | -0.015em | |
| H3 (card title) | 16 / 1.4 | 560 | -0.01em | |
| Body | 15 / 1.6 | 400 | 0 | |
| Small / meta | 13 / 1.45 | 400 | 0 | |
| Caption / label | 12 / 1.4 | 500 | 0.01em | Often uppercased for eyebrows |
| Code / metric | 13–14 / 1.5 | 400 | 0 | `--font-mono` |

---

## 4. Shape, spacing, elevation

**Density: compact-comfortable.** Dashboards and the IDE are information-dense; give data room but don't sprawl.

| Radius | Value | Applies to |
|---|---|---|
| Cards / panels / editor frame | `10px` | |
| Buttons / inputs / dropdowns | `8px` | Precise tool feel — *not* marketing pills |
| Tags / status badges / avatars | `9999px` | The only fully-round elements |
| Inner code wells | `6px` | |

**Spacing scale:** 4, 8, 12, 16, 24, 32, 48, 64. Card padding `16px`; section gap `24px` in-app, `64px` on the marketing page; element gap `8px`.

**Elevation = color + border, not shadow.** Step surfaces up (`canvas → raised → overlay`) and use a 1px `--border-subtle`. Shadows are allowed only on truly floating layers (modals, popovers, the nav bar) and stay soft:
```
--shadow-float: 0 0 0 1px rgba(0,0,0,.6), 0 8px 24px rgba(0,0,0,.35);
```
Focus ring (keyboard + inputs): `0 0 0 1px var(--border-strong), 0 0 0 3px rgba(139,123,255,.25)` — a quiet violet halo, since focus is an interaction/AI-adjacent affordance.

---

## 5. Layout system

- **Max content width:** 1200px for dashboards/reports; the candidate IDE is full-bleed (uses all viewport width).
- **App chrome:** slim sticky top bar (`--bg-raised`, 1px bottom border, `--shadow-float`), height 56px. Left: wordmark. Center/left: contextual nav. Right: **theme toggle** (sun/moon, on every page), then session timer (candidate) or user menu (admin). The toggle is a quiet icon button — a thin sun/moon that cross-fades on switch (`--dur-2`); the whole UI transitions colors over `--dur-2` (see §8).
- **Admin shell:** left sidebar (240px, `--bg-raised`), collapsible, icon+label nav — the Attio/Linear pattern. Active item: `--text-primary` on `--bg-overlay` with a 2px `--signal-*` left indicator matched to the section (violet for AI/reports, green for assessments/results, neutral otherwise).
- **Vertical rhythm:** generous; let dense tables and code breathe with 24px section gaps.

---

## 6. Core components

### Buttons
Buttons are **neutral by default**. Accent color is earned by meaning.

| Variant | Fill | Text | Border | When |
|---|---|---|---|---|
| Primary (neutral) | `--text-primary` | `--bg-canvas` | none | Main non-semantic action ("Create assessment", "Save") |
| Secondary / ghost | transparent | `--text-primary` | 1px `--border-strong` | Secondary actions |
| Tertiary | transparent | `--text-muted` | none | Low-emphasis, inline |
| **Run code** | `--signal-green-dim` | `--signal-green` | 1px `--signal-green` @ 30% | Correctness action |
| **Submit** | `--signal-green` | `--bg-canvas` | none | Final correctness commit |
| **Ask AI / Send** | `--signal-violet-dim` | `--signal-violet` | 1px `--signal-violet` @ 30% | AI action |
| Destructive | transparent | `--status-fail` | 1px `--status-fail` @ 30% | Delete, expire, revoke |

Radius 8px; padding `10px 16px`; disabled = 40% opacity, no pointer. Hover lifts fill one step (`+overlay`) or intensifies border, never shifts hue.

### Cards & panels
`--bg-raised`, 1px `--border-subtle`, radius 10px, padding 16px. Title in H3, meta in mono. Hover (if interactive): border → `--border-strong`. No colored card backgrounds — status lives in a badge or a 3px left rail, not a tinted card.

### Tags, badges, status pills
Pill (9999px), 12px mono/caption text, dim fill + accent text:
- Pass `✓ 8/10` → green · Fail → fail-red · Draft/Scheduled → warn/muted · AI turn count → violet (admin) · Difficulty `EASY/MEDIUM/HARD` → neutral with a single colored dot.

### Inputs
`--bg-inset`, 1px `--border-strong`, radius 8px, `--text-primary`, placeholder `--text-muted`. Focus → violet halo (§4). Labels: caption, `--text-muted`, above field.

### Tables (candidate lists, leaderboards, test results)
Header row: caption/uppercase, `--text-muted`, 1px bottom `--border-subtle`. Rows: 1px `--border-subtle` dividers, hover `--bg-raised`. Numeric/score columns right-aligned in mono. Rank and totals in the leaderboard use mono at a larger step. Alternating fills are unnecessary — dividers carry it (the Linear/Athletic pattern).

### Score display (admin)
The hero data object of the platform. A total score is a large mono numeral (48–60px) over a caption label. Break it into its two signals with a **split meter**: a single horizontal bar, green segment = code correctness portion, violet segment = AIU portion, widths proportional to `codeWeight`/`aiuWeight`. This one component visually restates the dual-signal thesis on every report. Individual AIU metrics (prompt quality, iteration efficiency, etc.) list below as mono values with thin violet track meters.

### AI chat panel (candidate)
The violet surface. Right-docked panel, `--bg-raised`, 1px left border. Assistant messages on `--bg-overlay` with a thin violet left rail; candidate messages plain. Prompt input pinned bottom with a violet **Send**. "AI is thinking" = three pulsing violet dots. Code blocks in AI responses: `--bg-inset`, mono, 6px radius, copy button. Rate-limit remaining shown as small mono meta; turns to warn color as it nears the cap.

### Code editor — VS Code-style shell over Monaco
Monaco **is** VS Code's editor component, so we keep it and dress it as a familiar VS Code workspace — the look and muscle memory, none of the full-IDE weight (no terminal, no extension installs, no per-user container; those conflict with the `CLAUDE.md` sandbox/AI/autocomplete rules). The shell is presentation over the same Monaco instance:

- **Activity strip (far left, 48px, `--bg-raised`):** 2–3 thin-line icons only — Files, Problem, (AI toggles the right panel). No source-control/extensions/debug icons; this is a scoped assessment, not an IDE.
- **File tab strip (top, `--bg-raised`):** VS Code-style tabs, filename in mono, active tab lifts to `--bg-canvas` with a 2px top accent (neutral). Most assessments are single-file, so often one tab — but the pattern scales if a problem ships a stub + helper.
- **Command palette (`Ctrl/Cmd+Shift+P`):** `--bg-overlay`, `--shadow-float`, mono list. Scoped to *safe* actions only — Run, Submit, Toggle theme, Toggle AI panel, Reset to starter. No file-system, terminal, or settings commands.
- **Editor (center):** Monaco **tracks the app theme** — `vs-dark` in dark, `vs`/tuned-custom-light in light — via `setTheme` on the same toggle. Autocomplete stays off in both (`CLAUDE.md`). Line numbers, current-line highlight, bracket matching on.
- **Run/output console (bottom, `--bg-inset`):** VS Code "panel" feel. Passing tests green rows, failing fail-red; hidden-test failures show count only (hard rule). Syntax/console colors match the active theme so the whole workspace reads as one surface.
- **Status bar (bottom, 22px, `--bg-raised`):** VS Code-style — language, line:col in mono, autosave state, and the mono countdown timer. This is where the "VS Code feel" lands cheaply.

Everything above is layout + theming over one client-side Monaco editor. No new runtime, no server-side IDE. Passing tests render green rows, failing render fail-red — the console is where Signal Green earns its most frequent appearance for the candidate. Hidden test failures show count only (never content — hard rule).

---

## 7. Iconography & imagery

- **Icons:** thin-stroke (1.5px), monochrome line icons, `--text-secondary` default, accent only when the icon *is* the signal (a green check on a passed test, a violet spark on the AI action). One family throughout (Lucide-style).
- **No photography, no mascots, no stock illustration.** The product imagery *is* the UI: framed editor screenshots, score meters, console output — contained in dark panels with thin borders, à la Depot/Vapi.
- **Atmosphere, sparingly:** a single soft violet radial glow is allowed behind the candidate login and the marketing hero. Never behind tables, editors, or scores — data must sit on flat neutral surfaces.
- **Empty states:** a thin-line icon, one line of `--text-secondary` copy, one action. E.g. admin with no assessments → "No assessments yet" + "Create assessment".

---

## 8. Motion

Motion here is **instrumentation, not decoration** — it shows state changing, draws the eye to a result, and makes a judged interface feel responsive and alive. Every animation earns its place by communicating something (a save landed, tests passed, the AI is working, a score resolved). Nothing loops for vibe alone. Green and violet keep their meaning in motion exactly as they do at rest.

### Motion tokens

```css
:root {
  --dur-1:120ms;  /* micro: hover, press, toggle */
  --dur-2:200ms;  /* standard: fades, popovers, tab switches */
  --dur-3:320ms;  /* entrance: modals, panels, cards */
  --dur-4:600ms;  /* expressive: score meters, count-ups */
  --ease-out:cubic-bezier(.22,.61,.36,1);       /* default — decisive settle */
  --ease-inout:cubic-bezier(.65,.05,.36,1);      /* symmetric moves */
  --ease-spring:cubic-bezier(.34,1.56,.64,1);    /* one soft overshoot — success only */
}
```
Rule of thumb: the bigger the surface, the slower and the more it eases *out*. Micro-interactions are near-instant; a resolving score is allowed to take its time.

### Signature motions (the ones that define the product)

- **Split-meter resolve.** On report/leaderboard load, the green/violet score meter draws from 0 → its two proportional widths over `--dur-4`, green filling first then violet, and the big total **counts up** in mono alongside. This is the platform's hero animation — the two signals literally assembling into a verdict. Runs once, on first paint of the score.
- **Test-result cascade.** After Run, result rows resolve top-to-bottom, ~40ms stagger: each row fades+slides in 6px, its status dot popping to green (pass) or fail-red with a tiny `--ease-spring` overshoot. A passing *whole* run gives one brief green sweep across the console top border.
- **AI thinking → answer.** While waiting: three violet dots in a soft staggered pulse (opacity .3↔1, 1.2s loop) — the *only* sanctioned loop. On response: dots crossfade out, the answer streams in token-by-token (server already streams), and the assistant message's violet left-rail wipes down top→bottom over `--dur-3`.
- **Autosave pulse.** On each successful save, the "Saved 12:04:31" mono meta ticks: timestamp crossfades and a 4px violet dot blips once (`--dur-1`). Silent, peripheral, reassuring — proof the platform is holding your work.
- **Timer urgency.** The countdown is calm until 5:00 remaining, then the mono digits shift to `--status-warn`; under 1:00 a slow 1s opacity breathing begins. Escalation by motion, not alarm.

### Standard interaction motion

| Element | Motion |
|---|---|
| Buttons | Press = scale .97 + fill step, `--dur-1`. Hover fills/border shift, `--dur-1`. Never hue-shift. |
| Modals / popovers | Backdrop fades; panel fade + scale from .98, `--dur-3 --ease-out`. Reverse faster (`--dur-2`). |
| Right AI panel / sidebar collapse | Width + opacity, `--dur-3 --ease-inout`. Content fades at 60% of the slide so it doesn't smear. |
| Tabs / segmented controls | Active pill slides between segments, `--dur-2 --ease-inout` (shared-element, not fade). |
| Rows / list items | Enter: fade + 6px rise, `--dur-2`. Stagger 30–40ms when a set arrives together. |
| Weight sliders (authoring) | The green/violet `codeWeight`/`aiuWeight` segments animate toward each other as you drag — direct, no lag, `--dur-1`. |
| Focus ring | Violet halo fades in `--dur-1`; never abrupt. |
| Toasts | Slide up + fade from bottom-right, `--dur-2`; auto-dismiss fades over `--dur-2`. |

### Cursor effect — the "signal trail"
A single, platform-defining pointer effect that reuses the violet identity. A **soft violet glow (~16px, blurred, ~40% opacity) trails the cursor with slight lag** (`--dur-2 --ease-out`), so movement leaves a brief comet-like wake that catches up when you stop. It reinforces the "live instrument" feel without touching content.

- **Magnetic targets.** Over interactive elements (buttons, tabs, cards, chat send), the glow tightens and warms toward the element's accent — green over Run/Submit, violet over AI actions — a subtle pull that signals "this is actionable." Off interactive elements it stays neutral violet.
- **Press ripple.** On click, one quick radial pulse (`--dur-2`, opacity out) from the point, in the target's accent color. One shot, never lingering.
- **Implementation:** a single fixed full-viewport layer, pointer-events `none`, driven by `transform: translate()` on `pointermove` (GPU-composited, `requestAnimationFrame`-throttled). No per-move DOM churn, no library — a few lines of vanilla JS + one element.
- **Hard exclusions:** disabled inside the Monaco editor text area (the native caret and code selection own that space — no glow over code), on text inputs, and on touch/coarse pointers (`@media (pointer:coarse)` → off). Under `prefers-reduced-motion: reduce` the trail and ripple are **off**; only the plain native cursor remains. It is ambient polish, never a functional cue — nothing depends on seeing it.

### Page & route transitions
Keep them cheap: a `--dur-2` fade + 8px rise on the main content region. No full-page wipes, no parallax, no scroll-jacking. Admin route changes swap content only — sidebar and top bar stay put.

### Guardrails
- **`prefers-reduced-motion: reduce` is honored everywhere** — replace all transforms/loops with a plain `--dur-1` opacity fade; the AI-thinking dots become a static "Thinking…" label; the split meter and count-up render at final value instantly. Meaning must survive with zero motion.
- No animation blocks input — the editor, chat, and buttons stay interactive mid-transition.
- One loop only (AI thinking). Everything else is a one-shot triggered by a real state change.
- Animate `transform` and `opacity`, not layout properties (`width`/`top`/`height`) on hot paths; the sidebar/panel width change is the one deliberate exception and is GPU-composited.
- Respect the judged context: motion should feel precise and confident, never playful or bouncy — spring overshoot is reserved for success moments only.

---

## 9. Surface-by-surface direction

**Candidate — Login / token entry.** Centered card on `--bg-canvas` with one soft violet glow behind it. Single mono input for the invite token, one neutral primary button. Calm, low-stakes, zero navigation.

**Candidate — Assessment IDE.** A **LeetCode-familiar** layout so candidates need zero ramp-up: top nav (logo, Problem List, prev/next, mono **countdown timer** that turns `--status-warn` under 5 min, theme toggle, exit), then three regions — problem statement (left, Description tab, markdown), editor (center: LeetCode toolbar with locked-language label + fullscreen, file tabs, Monaco, and a **Testcase / Result console** with Case pills and an Accepted/Wrong-Answer verdict), AI chat (right, violet surface). Run + green **Submit** live in the console action bar. **Deliberately omitted from the LeetCode pattern: Discussion, Solutions, and other candidates' Submissions** — a proctored assessment must not surface answers. Auto-save state shows as mono `--text-muted`.

**Candidate — Submitted.** Full-stop confirmation: "Assessment submitted." One green check, no score, no metrics (hard rule). Done.

**Admin — Dashboard.** Sidebar shell. Stat tiles up top (mono numerals: active sessions, submissions, avg score) with the split green/violet meter motif. Recent assessments as a table.

**Admin — Assessment authoring.** Form-dense. The `codeWeight`/`aiuWeight` split is a live green/violet split slider (must sum to 100 — validated server-side per `CLAUDE.md`; the UI shows the two segments filling toward each other). AIU metric weights as violet-tracked sliders. Problem/test-case editors use mono inputs; hidden test cases flagged with a muted lock badge.

**Admin — Candidate report.** The score hero (§6 score display) at top: big mono total + split meter. Below: correctness breakdown (green test grid) and AIU breakdown (violet metric meters) as two clearly separated columns — the two signals, side by side. PDF export (Puppeteer) mirrors this layout on white with the same green/violet accents.

**Admin — Leaderboard.** Dense mono table, rank + total right-aligned, each row's mini split-meter showing the green/violet composition of that candidate's score at a glance.

**Public — Marketing page.** The one place atmosphere is allowed: weight-500 display headline, single violet nebula glow, framed product screenshots of the IDE and a report. Themes like everything else (dark default / light toggle); the glow softens to a faint tint in light mode.

> **Theme coverage:** every surface ships both themes via the semantic tokens (§2) — including the Monaco editor, which flips `vs-dark`/`vs` with the user's toggle. Nothing is dark-only.

---

## 10. Do / Don't

**Do**
- Keep green = correctness and violet = AI, everywhere, without exception.
- Set every judged number in mono. Scores, counts, timers, turns, latency.
- Build depth from layered near-black surfaces + 1px borders.
- Use weight 500 for headlines; let size and space carry authority.
- Keep the candidate IDE calm and full-bleed; keep admin dense but ordered.
- Ship both themes on every page via semantic tokens; verify AA contrast in each.

**Don't**
- Don't show any AIU score, meter, or hint to a candidate.
- Don't use green or violet decoratively, or introduce a third accent hue.
- Don't lean on shadows or gradients for in-app depth.
- Don't use heavy bold, marketing pills on tool buttons, or full-round card corners.
- Don't put color fills behind data tables, editors, or scores — flat neutral only.
- Don't ever surface hidden test-case content, or the OpenRouter key, in any view.

---

## 11. Token starter (CSS custom properties)

```css
:root {                              /* dark = default */
  --bg-canvas:#0A0B0E; --bg-raised:#131418; --bg-overlay:#1A1C21; --bg-inset:#08090B;
  --border-subtle:#24262C; --border-strong:#34373E;
  --text-primary:#F5F6F7; --text-secondary:#C6CAD1; --text-muted:#868B94;
  --signal-green:#57D98A; --signal-green-dim:#1E3A2B;
  --signal-violet:#8B7BFF; --signal-violet-dim:#241F42;
  --status-fail:#FF6B6B; --status-fail-dim:#3A1F22; --status-warn:#F5B84E; --status-link:#6BA9FF;
  --shadow-float:0 0 0 1px rgba(0,0,0,.6),0 8px 24px rgba(0,0,0,.35);
  /* theme-invariant */
  --font-sans:"Geist","Inter",system-ui,sans-serif;
  --font-mono:"Geist Mono",ui-monospace,"SF Mono",monospace;
  --r-card:10px; --r-control:8px; --r-pill:9999px; --r-well:6px;
}
[data-theme="light"] {               /* light = override */
  --bg-canvas:#FBFBFC; --bg-raised:#FFFFFF; --bg-overlay:#FFFFFF; --bg-inset:#F1F2F5;
  --border-subtle:#E7E9ED; --border-strong:#CDD2DA;
  --text-primary:#14161A; --text-secondary:#454A52; --text-muted:#71767F;
  --signal-green:#12874A; --signal-green-dim:#E3F6EC;
  --signal-violet:#5B4BD6; --signal-violet-dim:#ECE9FD;
  --status-fail:#D93A3F; --status-fail-dim:#FCEAEA; --status-warn:#B7791A; --status-link:#2B6CF3;
  --shadow-float:0 1px 2px rgba(16,18,22,.06),0 8px 24px rgba(16,18,22,.10);
}
/* smooth theme switch; skip for motion-sensitive users */
body{transition:background-color var(--dur-2),color var(--dur-2);}
@media (prefers-reduced-motion:reduce){body{transition:none;}}
```
Set the theme before first paint to avoid FOUC:
```html
<script>
  // in <head>, before CSS: honor saved choice, else system
  var t = localStorage.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  document.documentElement.setAttribute('data-theme', t);
</script>
```

---

*References (refero): Vapi (11db6cab), Depot (707c2922), Linear/Changelog (11d3e58a) for style; Factory.ai, Lovable, Attio, Kit, Homerun, Linear for product patterns. Synthesized — no single source copied.*
