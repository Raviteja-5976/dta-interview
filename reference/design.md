# DevTrackAcademy — design.md

**Design system reference.** Read this before writing any UI for `devtrackacademy.com`, `workshop.devtrackacademy.com`, `learn.devtrackacademy.com`, or `interview.devtrackacademy.com`

**Direction:** Neo-Brutalist, developer-native, playful but disciplined. 4px thick ink borders, hard offset shadows, oversized Space Grotesk type, flat saturated colors, warm cream surfaces.

---

## 1. Design principles

1. **Ink is structure.** Every meaningful surface is enclosed by a Deep Navy (`#1B1F3B`) 4px border. Borders do the work that shadows and gradients do elsewhere. No soft shadows, no gradients, no glassmorphism anywhere in this system.
2. **Flat color, no blends.** Fills are solid flat colors (`#FF6B35` Primary Orange, `#1B1F3B` Deep Navy, `#FFF8F0` Cream, `#6EE7B7` Mint, `#4EA8FF` Sky Blue, `#FF5C7A` Coral).
3. **Rounded Brutalism.** Neo-Brutalist cards and containers use 20–30px rounded corners (`rounded-3xl` / 24px radius) paired with 4px ink borders and 6–14px hard offset shadows.
4. **One accent per viewport.** Orange (`#FF6B35`) plus ink (`#1B1F3B`) plus paper (`#FFF8F0`) is the default. A section may introduce exactly one secondary accent.
5. **No custom cursor / pointer tracker.** Native pointer tracking is preserved for crisp usability, keyboard focus indicators, and fast performance.
6. **Depth comes from offset, never blur.** `box-shadow` is always `Xpx Ypx 0` — zero blur, zero spread, ink-colored (`#1B1F3B`).
7. **Mono is the voice of the machine.** Labels, stats, eyebrows, tags, and code artifacts use JetBrains Mono. Headings use Space Grotesk, body copy uses Inter.

---

## 2. Color Palette

### 2.1 Foundations

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#1B1F3B` | All borders, all body text, dark section backgrounds. Deep Navy. |
| `--paper` | `#FFF8F0` | Default page background. Warm cream, low-glare, makes saturated accents pop. |
| `--paper-sunk` | `#F5EBE0` | Recessed surfaces: input fields, code blocks on light, alternating band sections. |
| `--paper-pure` | `#FFFFFF` | Card faces only, when a card must separate from `--paper`. |

### 2.2 Accents

| Token | Hex | Role | Where |
|---|---|---|---|
| `--orange` | `#FF6B35` | **Primary brand.** Marker highlight, primary CTA, final CTA section, main wordmark. | Everywhere |
| `--sky` | `#4EA8FF` | Secondary accent, link hovers, platform tags. | Navigation, secondary cards |
| `--yellow` | `#FFC93C` | Stats, counters, highlight panels, "limited seats" urgency. | Stats, badges |
| `--mint` | `#6EE7B7` | Success, verified, checkmark column of comparison cards. | Comparison, progress |
| `--coral` | `#FF5C7A` | Warning/Negative states, specializations, errors. | Badges, callouts |

### 2.3 Semantic aliases

```css
--brand:            var(--orange);   /* #FF6B35 */
--platform-workshop:var(--orange);   /* #FF6B35 */
--platform-learn:   var(--sky);      /* #4EA8FF */
--accent-data:      var(--yellow);   /* #FFC93C */
--accent-positive:  var(--mint);     /* #6EE7B7 */
--accent-future:    var(--coral);    /* #FF5C7A */
--negative:         var(--coral);    /* #FF5C7A */
```

---

## 3. Typography

### 3.1 Faces

| Role | Face | Weights |
|---|---|---|
| **Display / Headings** | Space Grotesk | 500, 600, 700, 800 |
| **Body** | Inter | 400, 500, 600, 700 |
| **Utility / Mono** | JetBrains Mono | 400, 700 |

### 3.2 Scale

- **Hero Headings:** 72px+ (`clamp(3rem, 8.5vw, 7.5rem)`)
- **Section Titles:** 48px (`clamp(2.25rem, 5.5vw, 4.5rem)`)
- **Card Titles:** 24px (`clamp(1.375rem, 2.2vw, 2rem)`)
- **Body Copy:** 16–18px (`clamp(1rem, 1.1vw, 1.125rem)`)

---

## 4. Borders, Shadows & Radii

### 4.1 Borders
- `--bd-hair`: `2px solid var(--ink)`
- `--bd`: `4px solid var(--ink)` (4px default Neo-Brutalist border)
- `--bd-thick`: `4px solid var(--ink)`
- `--bd-mega`: `6px solid var(--ink)`

### 4.2 Shadows
- `--sh-sm`: `4px 4px 0 var(--ink)`
- `--sh`: `6px 6px 0 var(--ink)`
- `--sh-lg`: `10px 10px 0 var(--ink)`
- `--sh-xl`: `14px 14px 0 var(--ink)`

### 4.3 Radii
- `--r-card`: `24px` (20-30px range for Neo-Brutalist cards)
- `--r-btn`: `16px`
- `--r-pill`: `999px`

---

## 5. Token Sheet

```css
:root {
  /* foundations */
  --ink:        #1B1F3B;
  --paper:      #FFF8F0;
  --paper-sunk: #F5EBE0;
  --paper-pure: #FFFFFF;

  /* accents */
  --orange: #FF6B35;
  --sky:    #4EA8FF;
  --cobalt: #4EA8FF;
  --yellow: #FFC93C;
  --mint:   #6EE7B7;
  --coral:  #FF5C7A;
  --violet: #FF5C7A;
  --negative:#FF5C7A;

  /* semantic */
  --brand:             var(--orange);
  --platform-workshop: var(--orange);
  --platform-learn:    var(--sky);

  /* typography */
  --font-display: 'Space Grotesk', system-ui, sans-serif;
  --font-body:    'Inter', system-ui, sans-serif;
  --font-mono:    'JetBrains Mono', monospace;

  /* borders & radii */
  --bd:       4px solid var(--ink);
  --r-card:   24px;
  --r-btn:    16px;
  --r-pill:   999px;
}
```