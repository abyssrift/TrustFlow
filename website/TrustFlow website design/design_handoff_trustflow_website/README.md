# Handoff: TrustFlow Marketing Website

## Overview
A 5-page marketing site for TrustFlow, a B2B operations/task-management SaaS: Home, Product (deep feature tour), Plans (pricing), Content Hub (blog), and Docs & Help (documentation + FAQ center). Dark, minimal, black theme.

## About the Design Files
The `.dc.html` files in this bundle are **design references** built in an HTML prototyping tool — they show intended look, copy, layout, and interaction behavior, not production code to copy directly. The task is to **recreate these designs in the target codebase's existing environment** (React, Vue, etc.) using its established components/patterns — or, if no environment exists yet, choose the most appropriate framework and implement fresh. Do not attempt to run the `.dc.html` files as-is in production; they depend on a proprietary preview runtime (`support.js`, not included) and a placeholder `<image-slot>` custom element standing in for real images.

## Fidelity
**High-fidelity.** Colors, type, spacing, and copy below are final; recreate pixel-perfectly with the target codebase's component library.

## Design Tokens

**Colors**
- Page background: `#0a0a0a` (matches the product app's own background)
- Card/panel background: `#141414`; elevated/highlighted card: `#161616`
- Primary heading text: `#f7f8f9` / `#f4f6f7`
- Secondary body text: `#9aa4ae`
- Muted/tertiary text: `#8a94a0`, `#6f7982`, `#5b636b`
- Link default: `#cfe3f5`; link hover: `#eaf3fb`
- Success/accent green (used once, "Save 18%" badge): `#7fd9a3`
- Borders: `rgba(255,255,255,0.08)` default; `rgba(255,255,255,0.12–0.28)` for emphasis/active states
- Primary button: white `#ffffff` bg / `#0a0a0a` text; hover bg `#dfe3e6`
- Secondary button: transparent bg, `1px solid rgba(255,255,255,0.18)` border, `#f4f6f7` text

**Typography**
- Body font: Inter (400/500/600/700)
- Headings: Inter Tight (600/700/800)
- H1: `clamp(28–44px)`, weight 800, line-height ~1.16, letter-spacing -0.02em
- H2/section titles: 26–30px, weight 700
- H3 (card/feature titles): 18–28px, weight 700
- Body copy: 14–16.5px, color `#9aa4ae`, line-height 1.65
- Eyebrow labels (small caps tags above headings): 11.5–12px, weight 700, letter-spacing 0.06–0.08em, uppercase, color `#6f7982`

**Spacing / Layout**
- Page content max-width: 1200px (narrower reading columns use 620–900px)
- Section horizontal padding: 48px
- Standard content gaps: 20–72px depending on density
- Border radius: buttons 7–8px; cards/panels 14–20px; pill badges/tags 20px

**Effects**
- Image mockups sit on a 3-layer shadow: (1) a wide soft ambient glow above/behind (`radial-gradient`, ~35–40px blur, low opacity, cool white-blue tint `rgba(180,195,215,…)`), (2) a tighter mid glow closer to the object (`rgba(215,228,242,…)`, ~20px blur), (3) a dark contact-shadow ellipse at the base (`rgba(0,0,0,0.6–0.72)`, ~14–16px blur). All layers render behind the (transparent-background) product screenshot, never on top of it.
- A very subtle full-page film-grain/noise overlay sits at 5% opacity in overlay blend mode across every page — a fixed, full-viewport SVG turbulence filter.
- Nav bar is sticky and fades in a translucent dark background + hairline border only after the user scrolls past ~8px (starts fully transparent over the hero).

## Assets
All product screenshots are placeholders (transparent-background "MacBook/iPhone mockup" and cropped UI images) — the user will supply real product screenshots/photography to drop into these slots. No other external assets used besides Google Fonts (Inter, Inter Tight).

## Screens / Views

### 1. Home (`Home.dc.html`)
**Purpose:** Primary landing page — pitch, feature overview, social proof, CTA.
**Layout:** Sticky nav (logo left, Product/Plans/Content Hub/Docs & Help center, Log in + Start free trial right) → two-column hero (text left ~0.9fr, large screenshot right ~1.1fr, 480px mockup) → logo/trust strip (5 plain text labels) → centered "idea" statement band → 3 alternating-side feature sections (Task Boards, Reporting, File Hub — each ~1fr/1fr grid, image flips side each time, 400px mockup) → "Whoever you run your team with" audience list (4 rows, label + description, divider lines) → testimonial (quote + avatar left, screenshot right, 350px mockup) → typographic final CTA (headline, two buttons, reassurance line) → footer (4-column: logo, Product links, Resources links, Company links + copyright bar).
**Components/copy:** Nav logo "TrustFlow"; hero H1 "Run your team's work from one calm screen."; hero body and CTA "Start free trial" / "See how it works →"; feature headlines "Every task, one board" / "See the whole pipeline" / "Files and conversations, together"; final CTA "Give your team a clearer way to work."

### 2. Product (`Product.dc.html`)
**Purpose:** Deep feature tour across 7 capabilities.
**Layout:** Same global nav → centered text-only intro (H1 "One workspace. Every part of the work.") → **sticky sub-nav** (7 jump links: Task boards, Reporting, File hub, Automations, Integrations, Mobile app, Permissions; sticky at `top:72px` right under the main nav; active link underlines/brightens via scroll-spy) → 7 sections with **deliberately varied layouts** (not repeated 1-image/1-paragraph): Task Boards is a large centered hero-style image (580px) with 2 lines of copy only; Reporting is the standard rich pattern (image + heading + paragraph + 3 stacked feature callouts); File Hub is standard pattern but callouts render as rounded tag/chip pills instead of a stacked list; Automations is quiet/minimal (2 lines of copy, small 220px close-up crop, no callout list); Integrations is a full-width layout (centered heading, full-width 220px banner image, then a 3-column callout grid below); Mobile is image-dominant (1.5fr image / 0.5fr text column, minimal 2-line copy, large 520px mockup); Permissions is asymmetric (text column with a 2-column compact callout grid + a small 260px inset image on the right) → card-style closing CTA (bordered rounded panel with a subtle radial glow, headline "See it work with your own data.", two buttons, trust-line row) → shared footer.
**Interaction:** IntersectionObserver drives the active sub-nav highlight as the user scrolls through sections.

### 3. Plans (`Plans.dc.html`)
**Purpose:** Pricing.
**Layout:** Nav → centered intro (H1 "Straightforward pricing, built to grow with you.") → **Monthly/Annual billing toggle** (pill switch, "Save 18%" badge on Annual) → 4-column pricing card grid (Free / Pro "Most popular" / Business / Enterprise) → feature comparison table (8 rows × 4 tier columns) → FAQ accordion (5 questions, single-open behavior, +/− icon) → shared footer.
**Pricing (placeholder):** Free $0 forever; Pro $12/user/mo (or $10 billed yearly); Business $24/user/mo (or $20 billed yearly); Enterprise "Custom, quoted per organization." Pro card is visually elevated: border `rgba(255,255,255,0.28)`, bg `#161616`, drop shadow, and a "Most popular" pill badge.
**Interaction:** Billing toggle recalculates Pro/Business prices live. Comparison rows: Members, Task boards, Reporting, Automations, File hub, Permissions & roles, SSO/SCIM, Support.

### 4. Content Hub (`ContentHub.dc.html`)
**Purpose:** Blog/resources listing.
**Layout:** Nav → centered intro (H1 "Notes on running work well.") → category filter pills (All / Product updates / Guides / Customer stories) → featured post card (large, only shown when filter = All; image + heading + excerpt + date/read-time, "Featured" eyebrow) → 3-column post grid (thumbnail 190px cover image, category tag, title, excerpt, date · read time) → shared footer.
**Interaction:** Clicking a category pill filters the grid client-side; "All" also reveals the featured card; empty state message if a category has no matches.
**Sample copy:** 7 placeholder posts spanning the 3 categories (see file for exact titles/excerpts).

### 5. Docs & Help (`Docs.dc.html`)
**Purpose:** Documentation, tutorials, and FAQ center.
**Layout:** Nav → two-column layout: **left sidebar** (280px, sticky, own scroll, search input at top, then 4 grouped link lists — Getting Started (4), Tutorials (5), Guides (4), FAQs (4) — 17 entries total) + **right content pane** (flexible width: eyebrow group label, H1 article/question title, summary paragraph, then either a numbered step list (tutorials/getting started items) or a boxed answer panel (FAQ items), plus a "Was this helpful? Yes/No" row at the bottom).
**Interaction:** Typing in the sidebar search filters all groups live (case-insensitive substring match on titles); groups with no matches hide their header. Clicking a sidebar item swaps the content pane (no page navigation) and highlights the active item with a subtle background tint (no left-border accent — intentionally avoided as a stylistic choice).
**Sample copy:** All 17 entries have final placeholder titles/summaries/steps or FAQ answers — see file for exact text.

## Shared Navigation
Every page shares one sticky top nav: `TrustFlow` logo (links Home) · Product · Plans · Content Hub · Docs & Help · Log in · Start free trial (white pill button). The current page's own nav link is bold/white; others are `#9aa4ae` with hover to `#f4f6f7`. Footer is identical across all 5 pages: 4-column grid (logo / Product links / Resources links / Company links) + copyright bar.

## Files
- `Home.dc.html` — Home page
- `Product.dc.html` — Product / feature tour page
- `Plans.dc.html` — Pricing page
- `ContentHub.dc.html` — Blog/resources listing
- `Docs.dc.html` — Docs & Help center
- `image-slot.js` — placeholder drag-and-drop image component used for all mockup/screenshot slots (reference only — replace with real `<img>`/asset pipeline in production)
