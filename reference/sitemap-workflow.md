# DevTrackAcademy Interview — sitemap-workflow.md

**Scope:** every page in `interview.devtrackacademy.com`, what is on it, where its data comes from, and how the user moves between them.
**Companions:** `home-page.md` (the marketing homepage), `design.md` (visual system), `db-design.md` (queries referenced here), `agent-design.md` (agent IDs referenced here).

**Page count:** 24 routes across four shells. **13 are MVP** — marked ✅.

---

## 0. Conventions

### Four layout shells

| Shell | Chrome | Used by |
|---|---|---|
| **Marketing** | Public nav, footer | Landing, pricing, legal |
| **Auth** | Centered card, no nav | Login, register, reset |
| **App** | Sidebar + top bar + credit pill | Everything after login |
| **Interview** | **No chrome at all** | The live interview only |

The interview gets its own shell and its own route tree deliberately. A sidebar, a notification badge, or a "back to dashboard" link during a live voice interview is an invitation to leave mid-session — and leaving mid-session costs the user a credit and produces an unscorable transcript. The room should have one door and it should be clearly marked.

### Tabs are routes, not client state

Every tab inside a project is a real URL. Three reasons: they're deep-linkable and shareable, browser back works the way people expect, and — per `db-design.md` §6 — each tab fetches exactly one JSONB column, so tab-as-route is also the cheapest data pattern.

### Async prep is never a blocking spinner

Preparation (P1–P5) takes 30–90 seconds. The user is not held on a loading screen for that. The project is created immediately in `preparing` state and the user lands on its Overview page, which fills in progressively over realtime. Same rule for post-interview evaluation.

---

## 1. Sitemap

```
interview.devtrackacademy.com
│
├── (marketing)  ─────────────────────────── public
│   ├── /                        Landing                        ✅  → home-page.md
│   ├── /pricing                 Credits & plans                 ✅
│   ├── /sample-report           Public sample report            ✅
│   ├── /privacy                 Privacy policy                  ✅
│   └── /terms                   Terms                           ✅
│
├── (auth)  ──────────────────────────────── public, redirect if signed in
│   ├── /login                                                   ✅
│   ├── /register                                                ✅
│   ├── /forgot-password
│   ├── /reset-password
│   └── /auth/callback           OAuth handoff                   ✅
│
├── (app)  ───────────────────────────────── auth required
│   ├── /dashboard               Project workspace               ✅
│   │
│   ├── /projects/new            Create project wizard           ✅
│   │
│   ├── /projects/[projectId]
│   │   ├── /                    Overview                        ✅
│   │   ├── /resume              Resume + ATS
│   │   ├── /resume/compare      Version diff
│   │   ├── /jd                  Parsed job description
│   │   ├── /company             Company analysis
│   │   ├── /gaps                Gap analysis + skill progress   ✅
│   │   ├── /history             Interview history               ✅
│   │   └── /interview/new       Interview setup                 ✅
│   │
│   ├── /sessions/[sessionId]
│   │   ├── /processing          Evaluation in progress          ✅
│   │   ├── /report              Interview report                ✅
│   │   ├── /report/questions    Question-by-question review     ✅
│   │   ├── /report/speech       Speech analysis
│   │   ├── /report/coding       Coding review
│   │   └── /report/design       System design review
│   │
│   ├── /credits                 Balance, purchase, usage        ✅
│   ├── /settings                Voice, language, persona, data
│   └── /profile                 Account
│
└── (interview)  ─────────────────────────── auth required, no chrome
    └── /interview/[sessionId]   Live interview                  ✅
```

### Navigation model

```
                        ┌──────────────┐
                        │  /dashboard  │ ◀── every path returns here
                        └──────┬───────┘
              ┌────────────────┼────────────────┐
              ▼                ▼                ▼
      /projects/new    /projects/[id]      /credits
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
   tabs (resume,      /projects/[id]/          /sessions/[id]/report
   jd, company,        interview/new            ◀── from /history
   gaps, history)            │
                             ▼
                    /interview/[sessionId]        ← no chrome
                             │
                             ▼
                 /sessions/[id]/processing        ← resumable
                             │
                             ▼
                   /sessions/[id]/report
```

**The loop that matters:** report → gaps → new interview. The report's action plan links directly into the Gap Analysis tab, which links directly into interview setup pre-filled to target the weak skills. That loop is the product's retention mechanism, and it should never require a trip through the dashboard.

---

## 2. Marketing & auth

### `/` Landing ✅

Fully specified in `home-page.md`. Signed-in visitors get `Go to dashboard` in place of `Start a free interview`.

### `/pricing` ✅

| | |
|---|---|
| **Data** | Static, plus `profiles.credits_balance` if signed in |
| **On page** | Credit pack cards (single / placement pack / season pass) · what one interview costs in credits · what a credit covers (voice minutes, coding round, system design) · free tier terms · FAQ block on credits · B2B/college enquiry link |
| **Action** | `Buy credits` → `/credits` if signed in, `/register?next=/credits` if not |
| **Not here** | A feature comparison matrix. There is one tier |

### `/sample-report` ✅

A real report from a real session, statically rendered. This is the highest-intent page on the marketing side — people who reach it are deciding. Use the same components as `/sessions/[id]/report` with a fixed dataset, plus a persistent `Start your own interview` bar.

### `/login`, `/register` ✅

| | |
|---|---|
| **On page** | Email + password · Google · GitHub · `next` param preserved through the whole OAuth round trip |
| **Register extra** | One line stating what they get: *"One free interview. No card."* |
| **After** | `/auth/callback` → `profiles` row exists via the signup trigger → redirect to `next` or `/dashboard` |
| **Guard** | Signed-in users hitting these routes redirect to `/dashboard` |

**Do not** ask for role, experience level, or goals at registration. That information arrives with the first resume upload, and every field between "I want to try this" and trying it costs signups.

---

## 3. App shell

Persistent across all `(app)` routes.

**Sidebar** — `Dashboard` · `Credits` · `Settings`. Below a divider, the four most recent projects as direct links. Collapses to icons under `lg`, becomes a bottom bar under `md`.

**Top bar** — breadcrumb (`Dashboard / Google · Software Engineer / Gap Analysis`) · credit pill showing balance, `--yellow` fill under 3 credits, tappable to `/credits` · avatar menu.

**Global rule:** `Start Interview` appears in exactly two places — the project Overview and the project header. Not in the sidebar, not in the top bar. An action that can be fired from anywhere gets fired accidentally, and this one spends a credit.

---

## 4. `/dashboard` ✅

| | |
|---|---|
| **Purpose** | The workspace. Shows **projects**, never individual interviews |
| **Data** | `db-design.md` §6 "Dashboard" — one query, no joins, no aggregates |
| **Guard** | Auth |

**Header strip** — four counters from the same query plus `profiles`: `Credits remaining` · `Projects` · `Interviews completed` · `Average score`. Stat block treatment from `design.md` §7.4, `tabular-nums`, count-up on first paint only.

**Project grid** — one tile per project, base card with resting tilt:

- Company logo and name · role title
- **Readiness ring** — `readiness_overall` as the primary number. This is the tile's focal point, not the last interview score. Readiness is the thing that changes because you practised; a single score is noise
- Resume match % · interviews count · `Last interview: 2 days ago`
- Status chip when `status != 'ready'`: `Preparing…` with a pulse, or `Preparation failed` in `--negative` with a `Retry` action
- Whole tile is a link to `/projects/[id]`

**Primary action** — `New interview project`, Primary button, top right of the grid.

**States**

- *Loading* — three skeleton tiles at the real tile dimensions. Never a centered spinner; layout shift on a grid is worse than a slightly longer wait
- *Empty (new user)* — a single full-width card, not an empty grid: heading `Start with the job you're actually interviewing for.`, one line on what to have ready (resume PDF, the job posting, the company URL), and `Create your first project`. Below it, a `See a sample report` link — new users who aren't ready to upload will otherwise bounce
- *Zero credits* — a `--yellow` band above the grid: `You're out of credits. Buy more to run another interview.` Projects stay fully browsable; reading past reports must never be gated

**Not here** — a list of individual interviews, a global activity feed, or a chart. Sessions belong to projects.

---

## 5. `/projects/new` ✅

A four-step wizard, one step per screen, back always available.

| Step | Field | Notes |
|---|---|---|
| 1 | Resume PDF | Drag-drop or picker. Parse client-side page count for immediate feedback. Max 5 MB, PDF/DOCX |
| 2 | Job description | Large textarea. `Paste the posting` — do not offer URL-fetch as the primary path; job boards block scrapers and the failure is silent and confusing |
| 3 | Company URL | **Marked optional, visibly** — dashed border per `design.md` §7.8. Auto-derived from the JD when a company name is detectable |
| 4 | Details | Target role (pre-filled from JD) · seniority · language · default difficulty |

**Submit** — `Generate project`.

**What happens on submit, and why it matters:**

```
POST /api/projects
  ├─ insert projects (status = 'preparing')       ← returns immediately
  ├─ insert resumes (version 1), upload to storage
  ├─ enqueue prep job → P2, P3, P1 in parallel → P4 → P5
  └─ redirect to /projects/[id]                   ← user lands in ~1s
```

The user is **not** held on a spinner for 30–90 seconds. They land on the Overview page and watch it fill in over realtime. If they close the tab, prep continues and the dashboard tile shows `Preparing…`.

**States** — per-step validation inline; upload progress on step 1; on API failure, keep every field populated and show the error above the submit button. Never clear a form the user spent two minutes filling.

**Not here** — anything about the interview itself. Difficulty, duration, and coding are chosen per session at `/interview/new`, not per project. A project outlives its settings.

---

## 6. `/projects/[projectId]` — Overview ✅

| | |
|---|---|
| **Purpose** | Everything important about this project on one screen |
| **Data** | `db-design.md` §6 "Project Overview tab" — one row, artifacts not fetched |
| **Guard** | Auth + ownership (RLS handles it; the page handles the 404) |

**Project header** — persists across all tabs: company logo, name, role, seniority chip, tab bar, and `Start interview` as the only Primary button on the page.

**Readiness panel** — the emotional centre of the page. Large overall number plus five sub-bars from `projects.readiness`: resume match, technical, behavioral, coding, system design. A sparkline from `readiness.history`. One sentence of interpretation: *"Up 9 points since your first interview. System design is the biggest remaining gap."*

**Quick stats row** — interviews count · average score · best score · last interview date, from `projects.stats`.

**Weak skills strip** — top 4 rows from `skill_progress` ordered by `jd_importance desc, score asc`, each a link into `/gaps`.

**Recommended next** — one card: `Practise system design at medium difficulty` → `/interview/new?focus=system_design`. One recommendation, not a list. A list is a menu; a recommendation is a nudge.

**Recent interviews** — last three, each linking to its report, with `See all →` to `/history`.

**Secondary actions** — `Improve resume` → `/resume` · `Upload new resume version`.

**States**

- *`status = 'preparing'`* — the page renders its skeleton with a progress strip naming the current stage (`Reading the company site…`, `Comparing your resume to the role…`). Realtime on the `projects` row swaps sections in as they land. `Start interview` is disabled with the reason shown, not hidden
- *`status = 'failed'`* — an error card naming which stage failed and a `Retry preparation` button. If only P1 failed, say so and offer `Continue without company research` — the project is still fully usable, per `agent-design.md`'s failure policy
- *Zero sessions* — the readiness panel is replaced by: *"Run your first interview to see where you stand."* Do not show a 0% readiness ring; a zero that means "no data" reads as a zero that means "you're bad at this"

---

## 7. Project tabs

### `/projects/[projectId]/resume`

| | |
|---|---|
| **Data** | `resumes` for this project, ordered by version desc |

- Version selector — `v1 (original)` · `v2 (AI improved)`, with `Set as active`
- ATS score dial from `resumes.ats.score` · keyword coverage bar
- Missing keywords as tags, each showing where it appears in the JD
- Section quality bars: experience, projects, achievements, formatting
- Formatting issues list
- AI suggestions, each with `Apply` / `Ignore`
- Original PDF in an inline viewer
- **Action:** `Generate improved resume` → Resume Improvement Agent → new `resumes` row at `version + 1`. Never overwrites
- Link: `Compare versions →`

### `/projects/[projectId]/resume/compare`

Side-by-side of two versions with changed sections highlighted, and an ATS delta at the top (`72 → 84`). This page is what makes resume improvement feel real rather than asserted.

### `/projects/[projectId]/jd`

Read-only rendering of `projects.jd_profile`: required skills with importance bars · preferred skills · implicit expectations, each showing what it was derived from · responsibilities · soft skills · domain knowledge · seniority. Collapsible `View original posting` from `jd_raw`.

### `/projects/[projectId]/company`

Rendering of `projects.company_profile`: one-liner, industry, size · products · tech stack tagged by area with confidence · engineering culture signals, each with its source link · values · recent news with a relevance note · **interview emphasis** — the section that explains why the questions look the way they do.

*Empty state (P1 skipped or failed):* `No company research for this project.` plus `Add a company URL` — which triggers P1 and updates the project in place.

### `/projects/[projectId]/gaps` ✅

The most valuable page in the app, and the one the report links back into.

- **Skill matrix** — rows from `skill_progress`: skill · status chip (`STRONG` mint / `WEAK` yellow / `UNVERIFIED` violet / `MISSING` negative) · score bar · confidence · depth reached · `seen in N interviews`. Sorted by JD importance, then ascending score
- **Two columns:** `Strengths` and `What to work on`
- **Learning priority list** — ranked, each item with a concrete action and an estimated effort, carried forward from report action plans
- **Per-skill drill-down** (expand row) — every question that touched this skill across every session, with its score and a link to that question in its report
- **Action:** `Practise these skills` → `/interview/new?focus=skill_a,skill_b`

**The distinction to make visible on this page:** the initial gap report (P4) is what your *resume* claims versus what the *role* needs. `skill_progress` is what the *interviews* actually established. Label them `Claimed` and `Verified` and show both. The gap between those two columns is the single most useful thing this product tells anyone.

### `/projects/[projectId]/history` ✅

| | |
|---|---|
| **Data** | `db-design.md` §6 "Interview History" |

One row per session: sequence number · date · duration · module chips (Technical / Coding / System design) · overall score · score delta against the previous session · status. Rows link to the report; in-flight sessions link to `/processing` instead.

Header: a line chart of `overall_score` by sequence. Six data points is enough to show a trend, and the trend is why people come back.

*Empty:* `No interviews yet.` + `Start your first interview`.

---

## 8. `/projects/[projectId]/interview/new` ✅

The last screen before a credit is spent. It must be unambiguous.

| Choice | Options | Default |
|---|---|---|
| Difficulty | Easy · Medium · Hard | From `profiles.prefs.defaults` |
| Duration | 15 · 30 · 45 · 60 min | 15 |
| Coding round | On / off | From prefs |
| System design | On / off | Off below mid seniority |
| Focus skills | Optional multi-select from `skill_progress` | Pre-filled from `?focus=` |

**Cost panel — always visible, updating live:**

```
Voice (15 min)            2 credits
Coding round             +1 credit
System design             —
─────────────────────────────────
Total                     3 credits
Your balance              7 credits
After this interview      4 credits
```

**Pre-flight check** — before the Start button enables:

- Microphone permission — request it *here*, not on the interview screen. A permission prompt in a live interview costs the first thirty seconds of the session
- Mic level meter with a `Say something to test` prompt
- Headphone recommendation: `Headphones recommended — they stop the interviewer's voice being picked up as your answer`
- Quiet-environment note

**Action** — `Start interview`:

```
POST /api/sessions
  ├─ spend_credits(amount, session_id)      ← atomic, fails closed on insufficient balance
  ├─ insert sessions (status = 'preparing')
  ├─ enqueue P6 blueprint → P7 coding → P8 voice pre-synthesis   (seconds, not minutes)
  └─ redirect to /interview/[sessionId]
```

The interview page shows a short `Preparing your interview…` state while P6–P8 run, then transitions to `ready` and begins. Because P1–P5 already ran at project creation, this is genuinely fast — which is the entire payoff of the project/session split.

*Insufficient credits:* the Start button is replaced by `Buy credits`, with the shortfall named. Do not let a user reach a live interview screen and then fail.

---

## 9. `/interview/[sessionId]` ✅ — the live interview

**Interview shell. No sidebar, no top bar, no notifications.**

### States

| `sessions.status` | Screen |
|---|---|
| `preparing` | `Building your interview…` with the three prep stages ticking through |
| `ready` | `Ready when you are.` + a single large `Begin` button. **The user starts the interview, not the system** — a voice agent that starts talking on page load catches people mid-sentence with a colleague |
| `live` | The interview |
| `processing` | Auto-redirect to `/sessions/[id]/processing` |

### The live screen

**Center — the interviewer.** An animated waveform that is genuinely driven by TTS output amplitude, not a decorative loop. It is the only indicator of whether the system is speaking, thinking, or listening, so it must be honest:

| State | Waveform |
|---|---|
| Speaking | Active, amplitude-driven |
| Listening | Idle pulse, `--brand` |
| Thinking | Slow sweep — shown while L1/L4 run |

**Above** — the current question in large type. It stays on screen for the whole answer. People forget the question mid-answer; making them ask you to repeat it wastes interview time and rattles them.

**Below** — a live transcript of the candidate's own words, streaming from the STT partials. Seeing your words appear is reassuring and it makes mistranscription visible immediately.

**Top strip** — elapsed time · section name (`Verifying your skills`) · a segmented progress bar by section. **No question counter** — the interview is goal-driven and the number of questions is not fixed, so a counter would be a lie.

**Bottom** — mute · `End interview` (behind a confirm) · a mic level indicator.

**Coding mode** — the layout splits: editor left, interviewer rail right. Language selector, problem statement above the editor, `Run tests` for the visible examples only, `Submit`. The waveform stays visible; hidden test results do not appear until after submission.

### Rules on this page

- **No sidebar, no back link, no in-app notifications.** The one exit is `End interview`, and it confirms first
- **`beforeunload` guard** while `live` — closing the tab abandons a paid session
- **Reconnection** — on network drop, show `Reconnecting…` over the waveform and resume from the last checkpoint (`sessions.live_state`). Do not restart the interview
- **Never show scores, correctness, or feedback here.** Per `agent-design.md` R5, mid-interview evaluation changes how the candidate performs and corrupts the data the report is built on
- **Silence is not an error state.** Eight seconds of quiet triggers one gentle spoken prompt from L5. The UI shows nothing

---

## 10. `/sessions/[sessionId]/processing` ✅

A route, not a modal — because evaluation takes 1–3 minutes and people close the tab.

- Stage list with ticks, driven by realtime on `sessions.status`: `Assembling your transcript` → `Measuring how you spoke` → `Checking your answers` → `Writing your report`
- Honest estimate: `About two minutes.`
- `We'll email you when it's ready — you can close this page.` and mean it
- On `complete`, auto-redirect to the report
- On `failed`, an apology, an automatic credit refund (a `refund` row in `credit_ledger`), and a `Contact support` link. A failed evaluation must never silently consume a credit

Reachable at any time; if the session is already `complete`, redirect straight to the report.

---

## 11. `/sessions/[sessionId]/report` ✅

The product. Everything else exists to produce this page.

| | |
|---|---|
| **Data** | `db-design.md` §6 "Interview Report page" — one row for the report, one query for questions |

**Header** — company, role, date, duration, module chips, `Download PDF`, `Share` (signed link, expiring).

**Overall panel** — the composite score, then the sub-scores as bars: communication, technical, coding, system design, behavioral, confidence. Readiness band label (`Developing`), and the delta against the previous session in this project.

> Per `agent-design.md` §9.4, **fluency is presented as coaching, not competence**, and stays out of the headline number in practice mode. Label the speech panel accordingly.

**Summary** — the narrative from E6. Four to six sentences, referencing actual questions.

**Goal outcomes** — the block worth leading with, and the one that distinguishes this report:

```
Establish whether the Kubernetes claim is hands-on          ✗ not established
   3 questions · 1 of 4 evidence items verified
   "Hands-on depth not established after three probes."

Verify PostgreSQL design reasoning                          ✓ established
   2 questions · 4 of 4 evidence items verified
```

It tells the candidate *what the interview was trying to find out and whether it succeeded* — which is the real answer to "how did I do", and something a score alone cannot say.

**Timeline** — sections with durations, jumping to that part of the question list.

**Strengths / What to work on** — each tied to a specific question, each clickable through to it.

**Action plan** — three to five ranked items, each with a concrete action, effort estimate, and success check. Each has `Add to learning priorities` → writes into `skill_progress` and appears on `/gaps`.

**Footer CTA** — `Practise these areas` → `/interview/new` pre-filled with the weak skills. This is the loop; make it the last thing on the page.

**Sub-page links** — Question review · Speech analysis · Coding · System design.

### `/report/questions` ✅

One card per question, in order. Collapsed: question text, score, evidence coverage `2/4`. Expanded:

- Your answer, transcript, with fillers subtly marked
- **Evidence coverage rows** — ✓ covered / ~ partial / ✗ missed, each with the quoted span from your answer that earned it
- **What you got wrong**, with the correction, in a bordered callout — only when `incorrect_claims` is non-empty
- **Two tabs:** `Better version of what you said` (default) and `Ideal answer`. Default to *improved*; it's the one people can act on
- `One thing to change` — the single highest-leverage note
- Delivery readouts in the card footer
- Evidence sources with links, when E3 ran

Deep-linkable per question (`?q=7`) so report links from `/gaps` land on the right card. A `partially_heard` badge on any question the candidate didn't hear in full — and it must be visible, because that question was graded differently.

### `/report/speech`

Overall WPM · per-question WPM chart · pause profile · filler breakdown by word · repetition · time-to-first-word trend. A trend note (`filler rate rose from 3% to 8% in the second half — a stress signal, not a habit`).

Low-reliability answers are excluded from aggregates and marked as such. Below the charts, one persistent line: **speech metrics are coaching signals; pronunciation and accent are never scored.**

### `/report/coding`

Problem statement · your submission with syntax highlighting · test results, visible and hidden · complexity achieved versus target · a better solution with commentary · what you said while coding, aligned to the code you were writing at that moment.

### `/report/design`

Your architecture as described · components covered and missing · scalability and trade-off discussion · an ideal design for comparison.

---

## 12. Account pages

### `/credits` ✅

Balance as the hero number · what a credit buys · purchase packs (single / placement pack / season pass) · purchase history from `credit_ledger` where `kind = 'purchase'` · usage history where `kind = 'spend'`, each row linking to its session · refunds shown explicitly, because a visible refund builds more trust than a silent one.

### `/settings`

- **Interview** — default difficulty, duration, modules, language variety (`en-IN`, `en-US`, …), TTS voice with a preview, interviewer persona
- **Data & privacy** — what's recorded and kept, `Download my data`, `Delete an interview`, `Delete my account`. Deleting a session soft-deletes and removes audio from storage
- **Notifications** — email when a report is ready

Language variety is not cosmetic: per `agent-design.md` §9.4 it selects the WPM calibration band. A US-calibrated band tells fluent Indian-English speakers they're too slow. Label it plainly: *"Used to calibrate speaking-pace feedback."*

### `/profile`

Name, avatar, email, connected accounts, password. Small page — most preferences belong in Settings.

---

## 13. Core workflows

### A · First-time user → first report

```
/  ──▶ /register ──▶ /dashboard (empty state)
                          │
                          ▼
                   /projects/new  (4 steps, ~2 min)
                          │  submit → project created in 'preparing'
                          ▼
              /projects/[id]  ── realtime fills in over ~60s
                          │  status → 'ready'
                          ▼
              /projects/[id]/interview/new
                          │  mic check · cost shown · credits spent
                          ▼
                /interview/[id]   'preparing' → 'ready' → Begin → 'live'
                          │  ~15 min
                          ▼
              /sessions/[id]/processing   (~2 min, closable)
                          │
                          ▼
                /sessions/[id]/report
```

**Time to value:** ~20 minutes end to end, of which ~3 is setup. Every asynchronous stage is closable and resumable — the user is never trapped watching a progress bar.

### B · Returning user → second interview

```
/dashboard ──▶ /projects/[id]  (readiness visible)
                     │
                     ├──▶ /gaps  ── "Practise these skills"
                     │
                     └──▶ /interview/new?focus=…   ← prep already done, seconds to start
```

The whole point of the project/session split shows up here: the second interview costs seconds of setup and a fraction of the AI spend, because P1–P5 never run again.

### C · The retention loop

```
report ──▶ action plan ──▶ /gaps (learning priorities)
   ▲                              │
   │                              ▼
   └──────── new session ◀── /interview/new?focus=…
```

Every report ends pointing into this loop. If a user finishes a report and the only next step is the sidebar, the product has stopped working.

### D · Resume improvement

```
/resume ──▶ Generate improved resume ──▶ resumes v2 created
              │
              ├──▶ /resume/compare   (ATS 72 → 84)
              └──▶ Set as active     ──▶ next session uses v2
                                          readiness.resume_match updates
```

Resume versions are never overwritten, so a user can always go back — and the version used by each session is recorded on `sessions.resume_id`, which is what makes the ATS delta meaningful.

### E · Buying credits mid-flow

```
/interview/new  (insufficient credits)
      │  Start replaced by "Buy credits", shortfall named
      ▼
/credits?next=/projects/[id]/interview/new
      │  purchase
      ▼
back to setup, selections preserved
```

Preserve the setup selections through the purchase round trip. Losing them is a small thing that reads as carelessness at exactly the moment the user is spending money.

---

## 14. Status → screen map

| `sessions.status` | Where the user is sent | Notes |
|---|---|---|
| `created` | `/interview/[id]` | Transient |
| `preparing` | `/interview/[id]` | P6–P8 running, seconds |
| `ready` | `/interview/[id]` | Waiting on `Begin` |
| `live` | `/interview/[id]` | Cannot be reached from any other route |
| `processing` | `/sessions/[id]/processing` | Realtime, closable |
| `complete` | `/sessions/[id]/report` | |
| `failed` | `/sessions/[id]/processing` | Error state + automatic refund |
| `abandoned` | `/projects/[id]/history` | Shown as `Abandoned`, greyed |

| `projects.status` | Overview behaviour |
|---|---|
| `draft` | Wizard created draft prior to submitting preparation pipeline; resume attached |
| `preparing` | Skeleton + stage progress; `Start interview` disabled with reason |
| `ready` | Full page |
| `failed` | Error card + `Retry preparation`; partial results still shown |
| `archived` | Read-only; no `Start interview` |

---

## 15. Guards and redirects

| Condition | Behaviour |
|---|---|
| Not authenticated on an `(app)` route | → `/login?next=<path>` |
| Authenticated on `/login` or `/register` | → `/dashboard` |
| Project not owned | 404, not 403 — a 403 confirms the resource exists |
| Session not owned | 404 |
| `/interview/[id]` when status is `complete` | → report |
| `/report` when status is not `complete` | → processing |
| Insufficient credits at setup | Start disabled, `Buy credits` shown with the shortfall |
| Leaving `/interview/[id]` while `live` | `beforeunload` confirm |
| Mic permission denied at setup | Block Start, show OS-specific recovery instructions |

---

## 16. Global state patterns

**Loading** — skeletons at true component dimensions, never centered spinners. Any operation over 10 seconds gets a named stage, not a percentage: people tolerate "Reading the company site…" far better than a bar at 40%.

**Empty** — every empty state has a heading, one line of context, and exactly one action. Never a bare "No data".

**Error** — say what failed, whether anything was lost, whether credits were affected, and what to do next. `Something went wrong` is not an error state.

**Offline during an interview** — `Reconnecting…` over the waveform, resume from checkpoint, never restart.

---

## 17. Mobile

The full flow must work on a phone; most of your users will run at least one interview on one.

| Screen | Mobile treatment |
|---|---|
| Dashboard | Single-column tiles, tilt reduced to ±1° |
| Project tabs | Horizontally scrollable tab bar, sticky under the header |
| Interview setup | Full-screen steps; cost panel sticky at the bottom |
| **Live interview** | Waveform centered, question above, transcript below, controls in a thumb-reachable bottom bar. Keep the screen awake with a wake lock |
| **Coding mode** | Editor full-screen with the interviewer collapsed to a floating pill. Warn at setup that coding rounds are much better on a laptop |
| Report | Single column; question cards collapsed by default; charts horizontally scrollable |

---

## 18. Build order

**Phase 1 — the spine (13 routes)**

```
/  /login  /register  /auth/callback  /dashboard  /projects/new
/projects/[id]  /projects/[id]/gaps  /projects/[id]/history
/projects/[id]/interview/new  /interview/[id]
/sessions/[id]/processing  /sessions/[id]/report  /sessions/[id]/report/questions
/credits  /pricing
```

That is a complete product: create a project, run an interview, read a real report, buy credits.

**Phase 2 — depth**

`/projects/[id]/resume` · `/company` · `/jd` · `/report/speech` · `/settings` · `/sample-report`

**Phase 3 — polish**

`/resume/compare` · `/report/coding` · `/report/design` · `/profile` · shareable reports · PDF export

**Build `/sessions/[id]/report` against a fixed JSON fixture before the interview pipeline exists.** It's the page that sells the product, it's the hardest to design, and building it first tells you exactly what the evaluation phase has to produce. Working backwards from the report is how you avoid discovering at integration time that E6 doesn't emit something the UI needs.
