# TrustFlow Marketing Site — Build Plan

> **This plan predates the final design and is partially stale.** It was
> drafted before the high-fidelity design handoff landed at
> `TrustFlow website design/design_handoff_trustflow_website/` (commit
> `d45abc1`, 2026-07-22) — that handoff + its `README.md` are now the source
> of truth for copy, layout, and design tokens, superseding §1/§1a below and
> `DESIGN_SPEC.md`. This file is still accurate for page inventory (§0, §2,
> §2a, §2b), technical/perf budget (§5), SEO (§6), domain/deploy (§7), and
> accessibility (§8) — those weren't design-token-dependent. See "Build
> progress" at the bottom for what's actually shipped vs. still open.

Scaffold status: **live build, Home page shipped.** `npm install && npm run build` succeeds, 0 errors. Home is built and matches the design handoff. Plans and Docs & Help are in progress (see "Build progress").

Tracking issue: see GitHub issue for this project (linked from the repo) — this file is the living, detailed version; the issue is the summary/checklist.

## 0. Why this exists / scope

TrustFlow (the app) has no public-facing page that explains the product, builds trust, and converts a visitor into a signup — today `portal.trustedgellc.com` *is* the product, gated behind auth. This project is a fast, static marketing + content site, in the spirit of linear.app, going all-out on production quality (real premium visuals/mockups, not stock-template filler). Design is expected to take a long time and that's accepted — this is not a quick placeholder job.

**Pages:**
1. **Home** — 7-8 components/sections showing the app's best aspects (mockups, illustrative photography, premium brand visuals — see §2)
2. **Product** — deeper detail on TrustFlow than the home page allows (full feature tour)
3. **Plans** — pricing page
4. **Content hub** — Tutorials, FAQ, and product videos (see §2b)

This is bigger than a "1-2 page site" — it's a small marketing site *plus* a lightweight help/content center. §9 phases the build so Home/Product/Plans (the conversion path) ship before the content hub (which has real production dependencies — see §2b).

## 1. Open decisions — SUPERSEDED, see design handoff

Everything in this section and §1a was resolved by the 2026-07-22 design
handoff, at higher fidelity than the answers below. Kept for history only —
do not use these as current truth. Current tokens live in
`src/styles/tokens.css` / `tailwind.config.mjs`, both ported from the
handoff's `README.md`, not from this table.

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

## 1a. Resolved decisions (2026-07-19, with Adam)

- **#1 Brand color / visual direction → RESOLVED.** Dark-first site in the spirit of `linear.app`, matching the app's own dark mode (Adam's preferred theme). Background = the app's dark `--surface-background` **#080d18** (near-black navy), accent = the app's live indigo **#4f46e5** (`--brand-primary`), text/borders = the app's dark slate tokens. This settles the #144ed5-vs-#4f46e5 drift *for the site* toward indigo; the logo mark can keep its blue. `tokens.css` (currently ported from the app's *light* theme, defaulting to logo blue) gets rewritten dark-first as step 1 of the build.
- **#2 Typeface → leaning Inter.** The Linear look is largely Inter; self-host via `@fontsource`, latin subset, `font-display: swap`. Confirm before build.
- **#5 Domain → deferred.** Build against the host's preview URL for now; pick the real subdomain (candidate: `trustflow.trustedgellc.com`, one DNS record) right before launch, `trustflow.com` later. See §7.

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

**Host = Hostinger, next to `portal.` (RESOLVED 2026-07-19).** The app was moved off Netlify to Hostinger because of an ISP-level block on Netlify's edge in the target region (Egypt). A marketing site's whole job is being reachable by clients, and a custom subdomain CNAME'd to Netlify still resolves to the same blocked IPs — renaming the door doesn't move the house. So this site ships to Hostinger, the same static-file way the Expo web export does. The scaffold's `netlify.toml` is now vestigial; it can stay as a fallback/preview config but is not the launch target. (Cloudflare Pages is a fine free preview host — not ISP-blocked — if a hosted preview URL is wanted during dev.)

1. **Now:** build locally / on a Cloudflare Pages preview; deploy `dist/` to Hostinger when ready.
2. **Interim URL:** point `trustflow.trustedgellc.com` (one DNS record on a domain already owned) at the Hostinger deploy when a "real" URL is wanted. Subdomain name still open (see §1a #5).
3. **Later:** buy `trustflow.com` (or a fallback like `.io`/`.app`) when budget allows (~$10-20/yr at-cost via Cloudflare Registrar or Porkbun) and repoint DNS — no rebuild required, just update `site:` in `astro.config.mjs` and the sitemap/robots URLs.

This is a genuinely separate deploy from the main app — the app keeps deploying itself unaffected.

**Subdomain map (for coherence with future plans):** `trustedgellc.com` = corporate site (not this) · `portal.trustedgellc.com` = the app · `trustflow.trustedgellc.com` = this marketing site · `client.trustedgellc.com` = future client-request intake (a separate authenticated app feature, **out of scope for this issue** — reserve the name, don't build it here).

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

## Current scaffold (what already exists, 2026-07-25)

```
website/
  src/
    layouts/BaseLayout.astro   # SEO/OG head, canonical URL, favicons, Inter + Inter Tight self-hosted
    components/Nav.astro       # shared nav — DONE, matches handoff (active-page state, scroll-solid)
    components/Footer.astro    # shared footer — DONE, matches handoff
    components/ImageSlot.astro # placeholder mockup box + 3-layer glow, swap for real <Image> later
    pages/index.astro          # Home — DONE, matches Home.dc.html
    pages/waitlist.astro       # DONE, live, predates this rebuild (own inline styles, already monochrome)
    pages/product.astro        # not built yet
    pages/plans.astro          # in progress — wiring to rpc_public_plans (see Build progress)
    pages/docs.astro           # in progress — sidebar search/filter island (see Build progress)
    pages/content-hub.astro    # not built yet — Phase 2
    styles/tokens.css          # DONE — monochrome tokens ported from the design handoff README
    styles/global.css          # tailwind + tokens entrypoint, btn system matches handoff
  public/                      # favicons + logo marks copied from ../assets/images
  astro.config.mjs             # static output, sitemap integration, placeholder `site` URL
  tailwind.config.mjs          # DONE — token-driven, matches handoff type scale/radius/color
  netlify.toml                 # scoped for a separate Netlify site (base dir = website) — not the launch target, see §7
```

## Build progress (living log, most recent first)

- **2026-07-25 — done:** Content Hub populated with real posts (3 "Product updates" grounded in actual shipped commits — SLA risk scoring, Jira/Odoo/Trello import, File Hub upload rebuild — dates pulled from `git log`, not invented; 4 original "Guides"), category filter now wired since there's content to filter. "Customer stories" stays genuinely empty — no real customers yet at the waitlist stage. Post detail pages (individual article routes) not built yet — this pass is the listing/grid only. Docs & Help extended to support optional `image`/`video` fields per item — `image` renders via the existing `ImageSlot` placeholder pattern, `video` renders a real click-to-load YouTube facade if a `youtubeId` is supplied (zero iframe/tracking JS until clicked) or an honest "video coming soon" placeholder if not. Wired into 3 real items (mobile app screenshot, SLA risk screenshot, timers video) plus one new item (Jira/Odoo/Trello import tutorial, same real feature as the new Content Hub post). Fixed 3 real bugs found right after the motion-pass shipped (nav pill position tracking, marquee empty-space-on-right, missing nav logo) — see memory for detail, worth reading before touching `Nav.astro`'s pill logic or the marquee again.
- **2026-07-25 — done:** Full motion pass across the site. Global foundation: one spring easing token (`--ease-spring`) used everywhere instead of default browser easing, a site-wide custom cursor (fine-pointer + motion-allowed only, skips text inputs), staggered page-load reveals. Component-level: liquid sliding pill on the main nav + a sliding underline on Product's sub-nav (replacing instant swaps), magnetic pull on every primary CTA, a cursor-tracing gradient border on the 4 Plans cards, a cursor-following spotlight on Home's audience rows and the Docs sidebar, a diagonal shine-sweep on outline buttons, a pausable marquee replacing Home's static trust strip, per-word staggered reveal on the Home/Plans/Product H1s, a real height-animated FAQ accordion on Plans (replacing native `<details>`), an odometer-style roll-up on the waitlist page's real signup count (rolls from last-shown to new value — real data only, no fabricated numbers), a cursor-reactive ambient glow on the Home hero, and one card-tilt moment (Home testimonial mockup only, by design — not stacked with other pages). All reusable behaviors (`.magnetic`, `.spotlight`/`.gradient-border`, `.tilt-card`, custom cursor) live once in `BaseLayout.astro`'s script and `global.css`, so any future element just needs the class, no per-page JS. Verified with a full cold dev-server restart (the class of bug that bit Docs/Plans earlier only shows on cold start) — clean, all 6 pages 200.
- **2026-07-25 — done:** Product page (`product.astro`) and Content Hub page (`content-hub.astro`). Product drops the mock's "Integrations" section (not a real feature) and fixes its Permissions copy (no "client-guest" role exists). Content Hub ships with an honest empty state — the mock's sample posts were fabricated case studies, not shipped. Plus: site-wide scroll-reveal animation utility (`.reveal` + IntersectionObserver in BaseLayout), applied to Home/Plans, Docs left static on purpose. Fixed a real bug: a literal `<script>` substring inside a code comment in `docs.astro` was crashing Vite's dev-mode dependency scanner on cold start (production builds were never affected) — see memory for the full explanation, don't reintroduce it.
- **2026-07-25 — done:** Plans page (`plans.astro`) — real pricing pulled at build time from a new `rpc_public_plans()` RPC (migration `20260725_public_plans_rpc.sql`, applied to prod) reading the live `billing_plans` table; monthly-only, no annual toggle (app has no annual tier); comparison table + FAQ derived from real `limits`/`features` data, not the design mock's copy (which had two inaccuracies — see memory). Docs & Help page (`docs.astro`) — sidebar search/filter + content-pane-swap island (vanilla JS, all content pre-rendered for SEO/no-JS), real TrustFlow-grounded copy across Getting Started/Tutorials/Guides/FAQs, not the handoff's generic placeholder text. Both build clean, both live on the dev server.
- **2026-07-24 — done:** Design system migrated from the old indigo/navy `DESIGN_SPEC.md` direction to the finalized monochrome handoff (tokens, Tailwind config, Nav, Footer, ImageSlot, full Home page rebuild). Old `Hero.astro`/`HeroVisual.astro` deleted.
