# TrustFlow Marketing Site — Build Plan

Scaffold status: **environment is live and verified** (`npm install && npm run build` succeeds, 0 errors). No real page content has been designed yet — this doc is the plan for that next phase. Nothing below should be built until the open decisions are resolved with Adam.

Tracking issue: see GitHub issue for this project (linked from the repo) — this file is the living, detailed version; the issue is the summary/checklist.

## 0. Why this exists / scope

TrustFlow (the app) has no public-facing page that explains the product, builds trust, and converts a visitor into a signup — today `portal.trustedgellc.com` *is* the product, gated behind auth. This project is a fast, static marketing + content site, in the spirit of linear.app, going all-out on production quality (real premium visuals/mockups, not stock-template filler). Design is expected to take a long time and that's accepted — this is not a quick placeholder job.

**Pages:**
1. **Home** — 7-8 components/sections showing the app's best aspects (mockups, illustrative photography, premium brand visuals — see §2)
2. **Product** — deeper detail on TrustFlow than the home page allows (full feature tour)
3. **Plans** — pricing page
4. **Content hub** — Tutorials, FAQ, and product videos (see §2b)

This is bigger than a "1-2 page site" — it's a small marketing site *plus* a lightweight help/content center. §9 phases the build so Home/Product/Plans (the conversion path) ship before the content hub (which has real production dependencies — see §2b).

## 1. Open decisions (need Adam's input before real design starts)

| # | Decision | Options | Current placeholder |
|---|---|---|---|
| 1 | **Primary brand color** | Logo blue `#144ed5` vs. the app's live indigo `#4f46e5` (`global.css` `data-theme='light'` block) — they've drifted apart since the 2026-07-17 icon rebrand | Defaulted to logo blue `#144ed5` in `src/styles/tokens.css` |
| 2 | **Typeface** | System font stack (matches app, zero load cost) vs. a webfont like Inter (more distinctive, what Linear/most SaaS landing pages use) | System stack placeholder in `tokens.css` |
| 3 | **Hero visual** | Real product screenshot/recording vs. abstract illustration built from the brand mark | Not started |
| 4 | **Pages** | Resolved — Home + Product + Plans + content hub, see §0 | N/A |
| 5 | **Domain** | Netlify subdomain now, `trustflow.com` later, or an interim free subdomain of `trustedgellc.com` | See §7 |
| 6 | **Analytics** | None / cookieless (Plausible, Fathom) / GA4 | Not wired up |
| 7 | **Visual asset sourcing** | "Going all out" implies real photography/mockups/illustration, not free stock (Undraw/Blush) or generic AI-generated art — needs either a designer/photographer engaged or a premium asset budget (mockup tools like Rotato/Screely/Mockuuups, licensed photography) | Not started |
| 8 | **Video production & hosting** | Who shoots/edits the product videos; host self-hosted (Cloudflare Stream/Mux, costs money, best perf control) vs. YouTube/Vimeo embed (free, easy, adds 3rd-party JS/cookies unless facade-loaded) | Not started |
| 9 | **Tutorials/FAQ format** | Astro content collections (Markdown/MDX, versioned in this repo) vs. a dedicated docs tool (e.g. Astro Starlight) if the tutorial library grows beyond a handful of pages | Not started |

## 2. Home page — content structure (7-8 sections)

1. **Nav** — logo, anchor/page links (Product / Plans / Resources), primary CTA ("Sign in" + "Get started")
2. **Hero** — one sentence of what TrustFlow is, one sentence of who it's for, primary + secondary CTA, hero visual (real mockup/product shot, per decision #3)
3. **Social proof strip** (optional, only if real customer logos/quotes exist — do not fabricate placeholders)
4. **Feature sections** (3–5, pick the strongest) — pipelines/stages, submissions & review, timers/effort tracking, file hub, reports/intelligence. One per section: short claim, 1-2 supporting lines, a real premium visual (product screenshot in a device mockup, or illustrative photography), not a full-app screenshot dump
5. **How it works** — 3-step flow, plain language (per house style: no "Vault"/"Nexus"-style theming, name things what they are)
6. **Plans teaser** — short pricing summary card(s) linking to the full `/plans` page
7. **Final CTA band**
8. **Footer** — product, resources (tutorials/FAQ/videos), legal, contact

That's 8 sections total, matching the "7-8 component" target — trim the social proof strip if there's nothing real to put in it yet.

## 2a. Product page — content structure

Goes deeper than Home's feature sections: full tour of the pipeline engine (stages/transitions/actions), submissions & review flow, timers/effort tracking, File Hub, reports/analytics, and how permissions/roles work. Structure as one long-form page with a sticky in-page nav (jump links), each section pairing a real screenshot/mockup with copy — this is where the detail that Home intentionally leaves out belongs.

## 2b. Content hub — Tutorials, FAQ, Videos

- **FAQ**: a single page, grouped by topic (billing, getting started, security, etc.) — cheapest of the three to produce, do this first.
- **Tutorials**: short how-to guides (e.g. "Setting up your first pipeline"), likely Markdown/MDX content collections per decision #9. Scope an initial list of maybe 5-8 tutorials rather than trying to cover everything at launch.
- **Videos**: product walkthroughs/demos. Biggest lift — needs decision #8 (hosting) resolved and someone to actually shoot/edit them. Do not block Home/Product/Plans launch on having videos ready; they can be added to the content hub after.

## 3. Visual & interaction direction

- Reuse the app's shape language already documented in `.agents/rules/ui-consistency.md`: `rounded-2xl` cards, `rounded-xl` buttons, `rounded-lg` inputs, token-driven color (no raw Tailwind palette classes) — `tailwind.config.mjs` here already mirrors that structure.
- Landing pages read best as a single narrative column (unlike the app's two-column desktop preference, which is for dense internal tools, not a scroll-driven pitch) — don't force two-column here.
- Motion: subtle on-scroll reveals (fade/slide-up, ~200-300ms, `prefers-reduced-motion` respected) rather than anything flashy. Hover states on buttons/cards should follow the existing hover-reveal + `transition-all duration-300 ease-in-out` language already used in `components/sidebar/NavRail.web.tsx`, for visual continuity with the app.
- Astro View Transitions (`<ViewTransitions />`) are worth turning on once there's a second page (pricing), for a Linear-like instant nav feel.

## 4. Copy

- Plain, concrete language over marketing fluff — matches the existing house preference for descriptive naming over themed branding.
- Every claim on the page should be true today, not aspirational (no "AI-powered" unless it demonstrably is).
- Draft copy in a doc/notes first and review it as text before it goes into components — much faster to iterate on words before they're wrapped in markup.

## 5. Technical & performance budget

- Target: Lighthouse 100/100/100/100 on the home page. Static HTML via Astro's `output: 'static'` (already set) means near-zero JS by default — keep it that way; only hydrate an island (`client:visible`) if something is genuinely interactive.
- Images: use `astro:assets` (`<Image />`) for anything in `src/assets/` so Astro handles responsive sizes/formats (avif/webp) automatically. Only hand-place truly static files (favicons, logo) in `public/`.
- Fonts (if a webfont is chosen per decision #2): self-host via `@fontsource`, subset to latin, `font-display: swap`, preload the primary weight only.
- No client-side framework runtime (React/Vue islands) unless a specific interactive widget needs it — plain Astro components cover nav/hero/footer/etc.

## 6. SEO & sharing

- `astro.config.mjs` already has `@astrojs/sitemap` wired up; update the `site:` URL once a real domain is picked (§7).
- Per-page `<title>`/description already flow through `BaseLayout.astro`'s `Props`.
- **TODO before launch:** design a real 1200×630 `public/og-default.png` (the layout already references `/og-default.png`, it just doesn't exist yet).
- Add `Organization` + `SoftwareApplication` JSON-LD once the final copy/URLs are locked.
- `public/robots.txt` already points at the sitemap.

## 7. Domain & deployment

Budget doesn't cover `trustflow.com` right now, and `trustedgellc.com` is already the company's own separate corporate site — so this does **not** reuse that domain's root or app subdomain. Path:

1. **Now:** deploy as its own Netlify site with **Base directory = `website`**, publish dir `dist` (its `netlify.toml` is already scoped for this). It'll get a free `*.netlify.app` URL to develop and share against.
2. **Optional interim:** point a free subdomain like `trustflow.trustedgellc.com` at it (one DNS record on a domain already owned) if a "real" URL is wanted before buying anything.
3. **Later:** buy `trustflow.com` (or a fallback like `.io`/`.app`) when budget allows (~$10-20/yr at-cost via Cloudflare Registrar or Porkbun) and repoint DNS — no rebuild required, just update `site:` in `astro.config.mjs` and the sitemap/robots URLs.

This is a genuinely separate deploy from the main app's root `netlify.toml` — the app keeps deploying itself unaffected.

## 8. Accessibility

- Body text on the light surface tokens must hit WCAG AA contrast (verify once decision #1 is final — `#144ed5` on white passes AA for large text/UI; check body-size text specifically).
- All interactive elements keyboard-reachable with visible focus states (don't rely on hover-only affordances for anything essential, per motion note in §3 — hover can enhance, but must have a non-hover path).
- Respect `prefers-reduced-motion` for all scroll/hover animation.

## 9. Suggested build order (phased)

**Phase 1 — Home, Product, Plans (the conversion path):**
1. Lock decisions #1, #2, #7 with Adam (brand color, typeface, visual asset sourcing/budget — this last one gates everything since "going all out" means real assets, not placeholders).
2. Write and review all copy as plain text first, for all three pages.
3. Build `Nav` + `Footer` (shared across all pages) → Home `Hero` → Home feature sections → `/plans` → `/product`, checking Lighthouse after each page.
4. Wire real screenshots/mockups/photography last, once layout is proven with placeholders.
5. Design the OG image (one per page), add JSON-LD, do a final SEO pass.
6. Cross-browser/device pass + `prefers-reduced-motion` check.
7. Deploy to Netlify, attach domain per §7.

**Phase 2 — Content hub:**
8. Ship FAQ first (cheapest, no production dependency).
9. Lock decision #9 (tutorials format) and write the initial 5-8 tutorials.
10. Lock decision #8 (video hosting), produce and publish videos as they're ready — not a launch blocker for Phase 1.

## Current scaffold (what already exists)

```
website/
  src/
    layouts/BaseLayout.astro   # SEO/OG head, canonical URL, favicons wired
    pages/index.astro          # placeholder only — not the real homepage
    pages/product.astro        # not created yet — Phase 1
    pages/plans.astro          # not created yet — Phase 1
    pages/faq.astro, tutorials/, videos/  # not created yet — Phase 2
    styles/tokens.css          # ported design tokens, brand color flagged as open decision
    styles/global.css          # tailwind + tokens entrypoint
    components/sections/       # empty — real sections go here
    assets/                    # empty — put anything needing astro:assets optimization here
  public/                      # favicons + logo marks copied from ../assets/images
  astro.config.mjs             # static output, sitemap integration, placeholder `site` URL
  tailwind.config.mjs          # mirrors app's token-based color/radius approach
  netlify.toml                 # scoped for a separate Netlify site (base dir = website)
```
