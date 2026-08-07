# DevTrackAcademy Interview — home-page.md

**Property:** `interview.devtrackacademy.com`
**Audience (now):** students and early-career devs practising for interviews. Not recruiters — see §"Do not build yet".
**The page's one job:** get a visitor to start a mock interview. Everything on this page either explains the product or removes a reason to hesitate.

**Design language:** inherits `design.md` exactly. `--brand` resolves to `--cobalt` on this property — it's a sibling of the Learning Platform, not the Workshop Platform. The marker highlight, ink borders, hard shadows, lift-and-press interaction, and motion tokens are unchanged.

**Pre-launch honesty rule:** no invented testimonials, no fabricated user counts, no fake "10,000 interviews conducted". Every number on this page must be true or absent.

---

## Section order

```
01  Navbar
02  Hero  ······················ the thesis: a live interview in progress
03  Three inputs strip
04  Live product theatre  ······ the interview window
05  How it works (5 steps)
06  What gets measured
07  Report preview  ············ highest-converting section on the page
08  The adaptive interviewer  ·· the differentiator
09  Coding mode
10  Who it's for
11  How scoring works (trust)
12  Privacy & your recordings
13  Pricing / beta access
14  The DevTrackAcademy ecosystem strip
15  FAQ
16  Final CTA
17  Footer
```

Sections 02, 04, and 07 carry the page. If you have to ship a smaller v1, ship 01–05, 07, 15–17.

---

## 01 · Navbar

**Elements**
- Wordmark: `DevTrackAcademy` + mono tag `INTERVIEW` in a `--r-pill` badge, `--bd-hair`
- Links: `How it works` · `What you get` · `Pricing` · `FAQ`
- Right: `Log in` (Ghost button) + `Start free interview` (Primary, `sm`)
- Back-to-ecosystem link: small mono `← devtrackacademy.com`

**Notes**
- Sticky, shrinks 80px → 64px past 100px scroll (per `design.md` §7.9)
- Scroll progress bar 4px `--brand` pinned above the nav border
- Mobile: full-screen ink overlay, `Start free interview` stays visible in the collapsed bar — never hide the primary CTA behind a hamburger

---

## 02 · Hero

**Purpose:** in one screen, show that this is a *conversation*, not a quiz. Most competitors show a form. Show the interview.

**Elements**
- Eyebrow (mono, `--t-label`): `— AI MOCK INTERVIEWS`
- H1 (`--t-hero`, 2 lines, manual break):
  ```
  Practice the
  interview. Not the answers.
  ```
  Alternates: `Talk your way through it.` / `The interview before the interview.`
- Marker highlight on **one** word — `interview` in line 1. Cobalt swipe, ink text on top.
- Sub-line (`--t-lead`, ≤48ch): *Upload your resume, the job description, and the company site. Get a voice interview built for that exact role — then a report that shows what you missed and how to say it better.*
- Primary CTA: `Start a free interview` → `/setup`
- Secondary CTA: `See a sample report` → `/sample-report` (scrolls or routes; this is the most-clicked secondary link on pages like this — do not omit it)
- Micro-line under CTAs (`--t-small`, 70% ink): `No card. Takes about 15 minutes.`
- Trust chips (mono `--t-tag`, `--bd-hair`, pill): `VOICE` · `ADAPTIVE FOLLOW-UPS` · `EVIDENCE-BACKED SCORING`
- Right side / below on mobile: the **hero artefact** (see below)

**Hero artefact — the thesis**

Not an illustration. A stylised, animated interview window:
- A hard-cornered `--r-0` panel, `--bd`, `--sh-xl`, ink fill
- Top: mono filename-style label `interview · backend engineer @ stripe`
- Center: a live waveform bar row animating on a loop (12–16 bars, `--brand`, sine-staggered)
- Below it: the interviewer's question typing in, then the candidate's transcript appearing word by word with a timestamp gutter
- Two floating side objects: a small `SPEAKING · 142 WPM` mono chip and a `FOLLOW-UP QUEUED` chip
- Loop length ~8s, then restart. `aria-hidden="true"`, with a text alternative in the sub-line

**Motion:** hero sequence from `design.md` §6.4 — SplitText → marker swipe → sub-line → CTAs → artefact begins its loop last.

**Mobile:** artefact below the CTAs, height-capped at 320px, waveform reduced to 8 bars.

---

## 03 · Three inputs strip

**Purpose:** kill the "what do I need to give it?" hesitation immediately, one scroll below the fold.

**Elements**
- Small centered heading (`--t-h2`): `Three things in. One real interview out.`
- Three cards, base card style, tilts `-1deg / 1deg / -1.5deg`:

| Card | Mono label | Body |
|---|---|---|
| 1 | `RESUME` | Your PDF. We pull out your skills, projects, and the claims worth probing. |
| 2 | `JOB DESCRIPTION` | Paste the posting. We separate what's required from what's nice-to-have. |
| 3 | `COMPANY SITE` | Optional. We read what they build so the questions sound like they came from them. |

- Below: difficulty selector preview — three pills `Easy` / `Medium` / `Hard`, and a toggle chip `Include a coding round`
- Micro-line: `Setup takes about 60 seconds.`

**Notes:** mark the company site card visibly optional (dashed `--bd`, per roadmap card treatment) — an optional field presented as required costs signups.

---

## 04 · Live product theatre

**Purpose:** show the interview actually running. This is where a skeptical visitor decides the product is real.

**Elements**
- Heading: `This is what it sounds like.`
- A large framed player, `--bd-thick`, `--sh-xl`, `--r-0`:
  - **Option A (best):** a real 40–60s audio clip of a sample interview with a synced transcript highlighting word by word. Play/pause, waveform scrubber, mute.
  - **Option B (fallback until you have audio):** a scripted, scroll-scrubbed transcript replay — no audio, same visual frame, GSAP `scrub: 1` advancing the conversation as the user scrolls.
- Left gutter shows live-updating mono readouts as the clip plays: `00:42` · `138 WPM` · `FILLERS 3.1%`
- A callout that fires mid-clip: a small `--yellow` card labelled `FOLLOW-UP GENERATED` with the follow-up question text — this single moment is the clearest proof the interviewer is adaptive
- Caption below: `Sample interview · Backend Engineer · medium difficulty`

**Notes:** never autoplay audio. Muted-by-default with an obvious play affordance. Provide the full transcript as real text under the player for accessibility and SEO.

---

## 05 · How it works

**Purpose:** the sequence. This *is* a real ordered process, so numbering is correct here (`design.md` §7.6 rule).

**Elements** — horizontal pinned timeline at `lg`, vertical at `md` and below. Five nodes:

| # | Step | One line |
|---|---|---|
| 01 | `Upload` | Resume, job description, company site. |
| 02 | `We plan the interview` | We compare what you claim against what the role needs, and build a section plan around the gaps. |
| 03 | `You talk` | A voice interviewer works through the plan, follows up when your answer is thin, and comes back to things you mentioned earlier. |
| 04 | `We break it down` | The transcript is split question by question, with timing on every answer. |
| 05 | `You get the report` | Per-question scores, the concepts you missed, and a better version of every answer you gave. |

- Progress line draws in `--brand` across the pin
- Active node fills `--brand`, scales `1.15`, `--ease-snap`
- Step 03 node gets the waveform icon; step 05 gets a small document icon

**Notes:** each step's caption stays under 22 words. This section is scanned, not read.

---

## 06 · What gets measured

**Purpose:** name the two axes so the report section makes sense.

**Elements** — two large cards side by side (ecosystem-card treatment, scaled down):

**Card A — `ACCURACY`** (fill `--paper-pure`, `--cobalt` shadow)
- Sub: *Did you actually answer the question?*
- Bullets: Concepts a strong answer covers · What you covered, partially covered, and missed · Anything you said that was wrong, with the correction · Evidence, not vibes
- Small inline example: a concept row showing `Bridge networking ✓` / `DNS discovery ~` / `Port publishing ✗`

**Card B — `DELIVERY`** (fill `--yellow`, ink border)
- Sub: *How did it come across?*
- Bullets: Speaking pace · Filler-word rate · Long pauses and hesitation · Repetition
- Small inline example: three mono readouts with band labels — `142 WPM · good` / `6.3% fillers · high` / `2 long pauses`

**Third, smaller strip below (`--paper-sunk`, `--bd-hair`):**
`Delivery is coaching, not a verdict.` — one sentence explaining that pace and fillers are practice signals and are reported separately from whether you knew the material. This matters to your audience and it belongs above the fold of trust, not buried in FAQ.

---

## 07 · Report preview

**Purpose:** the highest-converting section on the page. People sign up for the report, not the interview.

**Elements** — a large, real-looking report card, `--bd-thick`, `--sh-xl`, containing:

1. **Header row:** role title, date, overall band (e.g. `Developing`), duration
2. **Section scores strip:** four small bars — Intro · Your skills · Role skills · Coding
3. **One expanded question card** (the centrepiece):
   - The question text
   - Your answer, as a transcript excerpt with fillers subtly marked
   - **Concept coverage rows:** ✓ covered / ~ partial / ✗ missed, in `--mint` / `--yellow` / `--negative`
   - **What you got wrong**, with the correction, in a bordered callout
   - **Two tabs:** `Better version of what you said` and `Ideal answer` — the improved-vs-ideal pair from the rewrite coach. Default to the *improved* tab; that's the one people find usable.
   - Delivery readouts in the footer of the card
4. **Improvement plan preview:** two ranked items with a concrete action and a "you'll know it worked when…" line
5. CTA below the card: `See the full sample report →`

**Motion:** the concept rows stagger in `0.06s`, ✓ rows with `--ease-snap`, ✗ rows plainly. Same restraint rule as the comparison cards — the positive side gets the energy.

**Notes:** use a genuine sample from your own system, not lorem. A real report at medium quality is more persuasive than a fabricated perfect one.

---

## 08 · The adaptive interviewer

**Purpose:** the differentiator. Most tools ask a fixed list. Say so, plainly, without naming competitors.

**Elements** — comparison treatment from `design.md` §7.5, two columns:

**Left (`--paper-sunk`, desaturated):** `A question list`
✕ Same questions for every candidate ✕ No follow-ups ✕ Ignores what you already said ✕ Generic feedback at the end

**Right (`--paper-pure`, `--sh`):** `An interviewer`
✓ Questions built from your resume against that job ✓ Follows up when an answer is thin ✓ Comes back to things you mentioned earlier ✓ Steps in only if you say something badly wrong ✓ Evidence for every score

**Plus one highlighted proof card below** — the memory callback, which is the feature people find uncanny:
> Earlier you mentioned building a chatbot with Pinecone — how did you decide what to embed?

Label it mono: `ASKED AT 18:40 · YOU MENTIONED IT AT 04:12`. That timestamp pair does more work than a paragraph of explanation.

---

## 09 · Coding mode

**Purpose:** show the editor switch. Short section — one card, not a full band.

**Elements**
- Heading: `When it's time to code, the screen changes.`
- Split panel: left = editor mock (hard corners, mono, syntax-colored with `--mint` output lines); right = the interviewer waveform still active
- Three bullets: `You think out loud while you type` · `Tests run against your solution` · `Scored on the code and on how you explained it`
- Small chip: `Optional — toggle it off in setup`

---

## 10 · Who it's for

**Elements** — three cards, one accent each:
- `Campus placements` (`--orange`) — practise the exact company you're interviewing at next week
- `Switching roles` (`--violet`) — find out which claims on your resume don't hold up yet
- `First job` (`--mint`) — get used to talking about your projects before it counts

Each card: one line of copy + one honest micro-example. No stock photos of people.

---

## 11 · How scoring works

**Purpose:** trust. A voice product that scores people has to explain itself or it feels arbitrary.

**Elements** — a `--paper-sunk` band, `--bd-hair`, four short blocks:
1. `Scores come from a rubric, not a vibe.` — the concepts a good answer covers are written before you're asked, and your answer is checked against them.
2. `Some questions can't be graded for correctness.` — questions about your own projects and your own experience are scored on depth and specificity, never marked wrong.
3. `We don't score your accent.` — pronunciation is never scored. Pace bands are calibrated per English variety, and delivery is reported separately from whether you knew the material.
4. `You can see the evidence.` — every score links to the exact part of your answer it came from.

**Notes:** this section is the one place on the page where longer prose is allowed. Keep it to ~40 words per block.

---

## 12 · Privacy & your recordings

**Elements** — compact band, `--bd-hair`, three lines + a link:
- What's recorded (audio + transcript) and why
- How long it's kept, and a `Delete any interview, any time` line
- `Your interviews are not shared with employers` — state it explicitly; people will assume the opposite of a product with "interview" in the name
- Link: `Read the privacy policy →`

---

## 13 · Pricing / beta access

**Elements**
- If free during beta, say exactly that: heading `Free while we're in beta.` with a mono sub-line stating any limits (e.g. `3 interviews per month`)
- One card, not a three-tier table. You don't have tiers yet, and a fake tier table invites comparison you'll lose
- Below: `Pricing after beta will be announced before it changes. Beta users get notice first.`
- CTA: `Start a free interview`

---

## 14 · Ecosystem strip

**Purpose:** the page is part of DevTrackAcademy. One band, low height, no competition with the primary CTA.

**Elements**
- Line: `Part of DevTrackAcademy.`
- Two small cards: `Workshops →` (orange, → `workshop.devtrackacademy.com`) and `Learning Platform →` (cobalt, → `learn.devtrackacademy.com`)
- One line each, `--t-small`

---

## 15 · FAQ

Accordion, `design.md` §7.11. Ten questions, in this order:

1. Do I need to talk out loud? *(yes — say it plainly, it's the #1 hesitation)*
2. How long does an interview take?
3. What if I don't know an answer?
4. Can I do a coding round?
5. Is my recording shared with anyone?
6. How accurate is the scoring?
7. Can I retry the same role?
8. Which languages / accents are supported?
9. What if the transcript mishears me?
10. Is this for practice or for real hiring?

Answer 10 honestly: built for practice today, screening later. That honesty is a feature for your current audience.

---

## 16 · Final CTA

**Elements**
- Full-width `--brand` band, `--bd-mega`
- Heading (`--t-display`, ink): `Find out what you'd actually say.`
- Sub-line: `One interview. Fifteen minutes. A report that tells you where you actually stand.`
- Primary CTA (Dark variant): `Start a free interview`
- Secondary (Ghost, ink border): `See a sample report`
- No third option here. Two choices, maximum.

---

## 17 · Footer

Ink band. Product links · DevTrackAcademy properties · Legal (privacy, terms, data deletion) · Contact · Social. Mono `--t-tag` for column headers.

---

## Do not build yet

Keep these off the homepage until they're true:

| Element | Why not |
|---|---|
| Testimonials / user quotes | You don't have users. Use `Become one of our first candidates.` if you need the slot filled |
| Interview counts, success rates, "hired at X" logos | Unverifiable, and the claim is checkable by anyone who cares |
| Recruiter / employer positioning | You're targeting practice first. Mixing audiences makes both messages weaker |
| Leaderboards or public scores | Turns practice into performance, which is the opposite of what a mock interview is for |
| Company logos as "we interview for these" | Implies a relationship you don't have |
| A three-tier pricing table | You have one tier |

---

## Build order

**v1 (ship this):** 01 Navbar · 02 Hero · 03 Inputs · 05 How it works · 07 Report preview · 12 Privacy · 15 FAQ · 16 Final CTA · 17 Footer

**v1.1:** 04 Live theatre (Option B scroll-scrubbed) · 06 What gets measured · 11 How scoring works

**v1.2:** 04 upgraded to real audio · 08 Adaptive interviewer · 09 Coding mode · 10 Who it's for · 13 Pricing · 14 Ecosystem strip

---

## Page checklist

- [ ] Primary CTA (`Start a free interview`) appears at least three times: nav, hero, final CTA
- [ ] Same CTA wording everywhere it appears, and the page it lands on repeats that wording
- [ ] "You'll be speaking out loud" is communicated above the fold — this is the single biggest drop-off cause
- [ ] Every number on the page is true
- [ ] Sample report is a real output, not a mockup
- [ ] Audio never autoplays; full transcript available as text
- [ ] Hero artefact and all floating objects `aria-hidden`
- [ ] `prefers-reduced-motion`: the hero loop stops, the timeline renders complete, the page still explains the product
- [ ] Longest heading tested at 320px
- [ ] `--brand` resolves to `--cobalt` on this property