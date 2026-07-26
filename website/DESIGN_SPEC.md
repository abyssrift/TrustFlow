> **Superseded 2026-07-24.** The indigo/navy palette below was replaced by a
> finalized, higher-fidelity design handoff — see
> `TrustFlow website design/design_handoff_trustflow_website/README.md` for
> the current locked tokens (monochrome black `#0a0a0a`, Inter + Inter Tight,
> white/black buttons). `src/styles/tokens.css` and `tailwind.config.mjs` now
> follow that handoff, not this file. Kept for the still-relevant principles
> in §1 and copy/structure notes elsewhere in this doc.

# TrustFlow Marketing Site — Design Spec ("the script")

**Purpose:** a locked design system the build step follows so it invents nothing. Every color, type, and spacing value here is decided. Deviating is a decision, not a default. Read this *before* writing any section.

**Subject (ground all copy and imagery in this — never generic SaaS):**
TrustFlow is a multi-tenant platform where agencies and back-offices run client work through pipelines, stages, submissions/review, effort timers, a File Hub, and reports — with roles/permissions. Audience: ops leads and teams managing client deliverables. The page's single job: get a qualified visitor to sign up / request access.

---

## 1. Why Linear works (the principles to copy — not the pixels)

1. **Ruthless restraint.** One accent color, one type family, huge negative space. Nothing decorative survives — every element earns its place. Minimalism here is *subtraction*, not emptiness.
2. **The product is the hero.** The "powerful imagery" is just the real, polished UI shot cleanly (hairline frame, soft glow) — not stock art, not illustration. High-fidelity screenshots do the selling.
3. **One standardized system, applied everywhere.** A tiny token set (one dark bg, one accent, one font, consistent radius/spacing) repeated across every section. That sameness *is* the craft signal — it reads as a product built by people who care, which reads as trust.
4. **Subtle, purposeful motion.** Gentle reveals and hover micro-interactions that feel alive but never flashy. Motion directs attention; it never competes for it.
5. **Confident, concrete copy.** Short benefit headlines, plain language, no jargon, no fluff. One idea per section.
6. **Rhythm through repetition.** A single repeated section pattern (headline → one-line subhead → one focused visual) gives a predictable, scannable cadence.
7. **Depth from light, not ornament.** Near-black base + barely-raised bands + hairline borders + soft ambient glows create depth. No heavy drop shadows, no decorative gradients.

**How TrustFlow avoids the clone trap:** navy-tinted black (`#080d18`), not Linear's pure gray-black; indigo pulled from the *actual live app*; and real TrustFlow screenshots. Those three make it ours, not a template.

---

## 2. Color — locked palette (exactly one accent hue)

| Token | Value | Use |
|---|---|---|
| `--bg-base` | `#080d18` | Page background — near-black navy |
| `--bg-raised` | `#0d1424` | Alternating section bands / subtle elevation |
| `--surface-card` | `#0f172a` | Cards, panels, code blocks |
| `--border-hairline` | `rgba(255,255,255,0.08)` | Default 1px borders (the Linear hairline) |
| `--border-strong` | `rgba(255,255,255,0.14)` | Hover/active border brighten |
| `--text-main` | `#f8fafc` | Headlines, primary text |
| `--text-muted` | `#94a3b8` | Body copy, subheads |
| `--text-dim` | `#64748b` | Eyebrows, captions, footer |
| `--accent` | `#4f46e5` | The one accent: primary CTA, links, active states |
| `--accent-hover` | `#6366f1` | Hover on accent |
| `--accent-glow` | `rgba(79,70,229,0.35)` → transparent | Ambient radial glow — **hero only** |

- **One accent hue.** A single secondary (violet `#7c3aed`) is allowed **only** inside the hero aurora gradient, nowhere else.
- Token-driven only — **no raw Tailwind palette classes** (mirrors the app's rule).
- Body text on `--bg-base` must hit WCAG AA.

## 3. Typography — two faces

| Role | Face | Weights | Notes |
|---|---|---|---|
| Display + UI | **Inter** (self-host via `@fontsource`, latin subset, `swap`, preload one weight) | 400 / 450 / 560 / 620 | Headlines: tracking `-0.02em`→`-0.03em`, line-height 1.05–1.1 |
| Mono (optional) | `ui-monospace`/JetBrains Mono | 400/500 | Eyebrows, data, code snippets **only** — used sparingly |

**Type scale (desktop):** eyebrow 13px uppercase, tracking `+0.08em`, `--text-dim` · h1 56–64px · h2 32–40px · h3 20px · body 16–18px · caption 14px. Body line-height 1.5–1.6, color `--text-muted`, max-width ~65ch.

## 4. Layout & spacing

- **Single narrative column** (not the app's two-column). Content max-width `1120px`; text blocks max ~`640px`.
- Section vertical padding: `96–160px` desktop, `64–80px` mobile.
- 8px base spacing unit.
- Alternate `--bg-base` / `--bg-raised` bands for section rhythm.

## 5. Radius

- Cards & screenshot frames: `16px` + 1px hairline.
- Buttons: `10–12px`. Inputs: `8px`.

## 6. Product imagery — the rule that makes it "powerful"

- Real TrustFlow UI, **dark mode**, captured at **2×**, **seed/demo data only** (never a live tenant).
- Framing: 1px `--border-hairline`, `16px` radius, sits flat on the section. No heavy drop shadow. No browser chrome unless deliberate.
- **Hero** = one wide, impressive board shot. **Feature sections** = tight focused crops of a single feature each.
- Optional slight tilt is a *hero-only* signature move — keep it under ~4°; never tilt feature crops.

## 7. Motion (respect `prefers-reduced-motion` — disable all of this under it)

- **Scroll reveal:** opacity 0→1 + `translateY(12px→0)`, 400–500ms, `cubic-bezier(0.16,1,0.3,1)`, once, ~60ms stagger.
- **Hover:** `--border-hairline` → `--border-strong`, ≤2px lift or subtle bg shift, 200–300ms ease.
- **Banned:** parallax, spring/bounce, autoplay carousels, marquees, looping animated gradients.

## 8. Repeated section pattern

```
[eyebrow — dim, uppercase, tracked]
[headline — 1 line, tight tracking]
[subhead — 1–2 lines, muted, ≤100 chars]
[one focused product screenshot — hairline frame]
```
Alternate text-left/visual-right ↔ reversed, and `--bg-base` ↔ `--bg-raised`, down the page.

## 9. Signature element (the one bold thing)

The hero product board floating over a soft indigo→violet **aurora glow** (`--accent-glow` radial, bleeding up behind the frame), hairline frame, a subtle on-load fade-up. This is the single memorable moment — **everything else stays quiet**. Spend boldness only here.

## 10. Copy rules

Short benefit headlines · plain language · active voice · true-today claims only (no "AI-powered" unless it is) · name features by what users *do* · no jargon, no exclamation marks, consistent case. Draft as plain text and review before it goes into markup.

## 11. Anti-slop guardrails — never do these

- ❌ Purple-gradient-on-white, or any second accent hue outside the hero aurora
- ❌ Stock illustrations, undraw/Blush, generic 3D blobs, or AI-art imagery
- ❌ Emoji as feature icons
- ❌ Fabricated logos / testimonials / quotes (also a #60 non-goal)
- ❌ Numbered markers (01/02/03) on non-sequential sections — allowed **only** on the "How it works" 3-step flow, which is a real sequence
- ❌ Heavy drop shadows — depth comes from hairlines + glow
- ❌ Any font other than Inter (+ optional mono)
- ❌ Raw Tailwind palette colors — tokens only
- ❌ Carousels, marquees, parallax
