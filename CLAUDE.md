# ShopLens

Next.js (App Router) + Tailwind v4 app. An AI shopping agent with multiple "lenses"
(Gift, Skincare, Style, Nutrition run the live expert flow at `/api/expert`; the
remaining modes run the classic flow at `/shop/classic`).

## Design system — the ShopLens style guide

**This is the source of truth for everything user-facing.** The full guide lives at
[docs/shoplens-style-guide.html](docs/shoplens-style-guide.html) (open it in a browser
to see specimens). Design tokens are implemented in
[src/app/globals.css](src/app/globals.css) under `@theme` — always style with these
tokens/Tailwind classes, never hard-coded hex.

Guiding principle: **the input is the product; everything else stays quiet.**

### Color

Warm paper, dark ink, one working color (blue), one personality color (butter).

| Token (Tailwind) | Hex | Use |
| --- | --- | --- |
| `cream` (Paper) | `#FAFAF7` | Page background. **Never pure white.** |
| `white` (Card) | `#FFFFFF` | Surfaces: cards, chips, search bar. |
| `ink` | `#1C2230` | Primary text. Near-black, cool cast. |
| `ink-soft` | `#5B6372` | Secondary text, sublines, nav links. |
| `ink-faint` | `#949CAB` | Helper text, placeholders, labels. Never for must-read text. |
| `plum` (Blue) | `#2D5BFF` | Primary actions, brand mark, focus rings. White text on top. |
| `plum-dark` (Blue deep) | `#1E45D6` | Hover/pressed of Blue only. |
| `plum-wash` (Blue tint) | `#EDF1FF` | Ghost hover, subtle highlights. |
| `butter` | `#FFD84D` | **Selected state only.** Always Ink text, never white. |
| `butter-soft` | `#FFF3C2` | Icon tiles, gentle accents. |
| `line` | `#E8E8E2` | Hairline borders and dividers. |

> The historical token names `plum`/`gold`/`cream` are kept so existing classes keep
> working, but they now hold the guide's Blue/Butter/Paper values. Read `plum` as
> "the working blue".

**Do:** Blue for every primary action · Butter for the single active selection on
screen · Ink text on Butter.
**Do not:** per-category colors (lenses differ by icon + label, **not hue**) · Butter
on buttons/links/anything that navigates · pure black or pure gray text.

### Typography

Two families. **Fraunces speaks, DM Sans works.** Fraunces (`font-(family-name:--font-display)`)
appears **only at display sizes** — page headline (one per page) and section titles on
content pages. Everything else is DM Sans (the body default).

- Display: Fraunces 600, 48–58px, -0.02em, lh 1.08 — page headline only.
- Heading: Fraunces 600, 24–28px, -0.01em — section titles.
- Body large: DM Sans 400, 17px — sublines, leads.
- Body: DM Sans 400–500, 15px — cards, chips, controls, default.
- Caption: DM Sans 400, 13.5px, ink-faint — helper text under controls.
- Label: DM Sans 600, 12.5px, +0.12em, uppercase, ink-faint — eyebrows/section markers.

### Shape, space, motion

| Token | Value | Where |
| --- | --- | --- |
| radius-lg | `28px` (`rounded-[28px]`) | **Search bar only** |
| radius-md | `18px` (`rounded-2xl`≈16px / `rounded-[18px]`) | Cards and surfaces |
| radius-pill | `999px` (`rounded-full`) | Chips and buttons |
| Shadow resting | `0 2px 8px -2px rgba(28,34,48,.08)` | Chips, raised controls |
| Shadow hover | `0 12px 28px -12px rgba(28,34,48,.18)` + `-translate-y-0.5` | Cards on hover |
| Shadow hero | `0 18px 44px -18px rgba(45,91,255,.16)` | **Search bar only**, blue-cast |
| Transitions | `.15–.18s ease` | All hovers. Respect `prefers-reduced-motion` |

Motion budget: **one ambient moment per page** (the typing placeholder on the home
hero) plus hover feedback. Nothing else autoplays.

### Components

- **Primary button:** Blue, pill, sentence case, verb-first ("Find products").
- **Icon button:** circular Blue, reserved for submit inside the search bar.
- **Ghost button:** for secondary actions living inside another component ("Add a photo").
- **Lens chip:** raised white pill, 17px line icon at 1.9 stroke. Exactly one active at
  a time = the only Butter object on screen. The dashed "More lenses" chip is the
  expander and never takes the active state.
- **Search bar:** the hero. Largest radius (28px), soft blue-cast shadow, Blue border on
  focus. Nothing else may have a stronger shadow.
- **Prompt card:** white card, hairline border, Butter-soft icon tile. First person,
  always with a concrete constraint (budget/occasion/preference). Hover: border fades,
  card lifts.

### Voice

- Write as the user speaks ("Get me ready for a beach wedding").
- Say what you give and what you get.
- Sentence case everywhere except uppercase section labels.
- Plain names on chips (Gifts, Swaps, Travel); Lens names in captions (Gift Lens, Swap Lens).
- **Never** system language: catalog, API, query, GEO, deliverability.
- One helper line per control, max two sentences.
- No promised outcomes in educational lenses (Routine/Fuel describe preferences, never
  treatment or health results).
