---
trigger: always_on
---

# NewTrustFlow: AI UI & CSS Guidelines (v2)

**CRITICAL INSTRUCTION FOR ALL AI AGENTS:**
When designing, building, or modifying UI components or styling for the NewTrustFlow platform, you **MUST** strictly conform to this design system. **Do NOT use hardcoded colors or raw Tailwind classes like `bg-slate-900` or `text-white`.**

---

## 1. Single Source of Truth

All design tokens must exist in:

* `frontend/global.css` (CSS variables)
* `frontend/tailwind.config.js` (mapped utilities)

**Never invent classes or values inside components.**

---

## 2. Core Color System

### Surfaces

* `bg-surface-background`
* `bg-surface-card`
* `border-surface-border`

### Typography

* `text-typography-main`
* `text-typography-muted`
* `text-typography-label`

### Brand

* `bg-brand-primary`
* `text-brand-primary`

---

## 3. State System (MANDATORY)

All feedback and system states must use explicit tokens:

* `bg-state-success`
* `bg-state-warning`
* `bg-state-danger`
* `bg-state-info`

**Rules:**

* Do NOT reuse brand colors for states
* Do NOT use "accent" as a catch-all

---

## 4. Interaction Tokens (NO OPACITY HACKS)

Every interactive color must have dedicated states:

* `bg-brand-primary`
* `bg-brand-primary-hover`
* `bg-brand-primary-active`

Optional:

* `bg-brand-primary-disabled`

**Rules:**

* Avoid `opacity` as primary feedback mechanism
* Always prefer explicit hover/active tokens

---

## 5. Spacing & Layout System

All layout must follow consistent spacing rules.

### Standard Guidelines

* Screen padding: `p-4` or `p-6`
* Card padding: `p-4`
* Section gaps: `gap-4` or `gap-6`

### Shape System

* Cards: `rounded-2xl`
* Buttons: `rounded-xl`
* Inputs: `rounded-lg`

**Rules:**

* Do NOT mix random spacing values
* Prefer consistency over precision

---

**Modal/sheet patterns are documented in `.agents/rules/ux-consistency.md`. Always read it before creating or modifying popups, sheets, or overlays.**

## 6. Component Rules (STRICT)

### Buttons

* Must use `bg-brand-primary`
* Must include hover + active states
* Must be `rounded-xl`
* Must have consistent padding (`px-4 py-2` minimum)

### Filter controls

Filter UI is standardised across surfaces (issue #208) — never hand-roll a filter
bar, chip wall, or filter modal. Compose from `components/common/FilterPanel.tsx`
(it re-exports `FilterSection`, `FilterChipGroup`, `FilterDropdown`) and the
animation primitive `components/common/SlideDownPanel.tsx`. Full interaction and
placement conventions (auto-apply, Clear Filters, toolbar trigger with the
`9+`-capped badge) live in `.agents/rules/ux-consistency.md` → "Filter Panels".

* Toolbar filter trigger is an icon-only `filter` glyph button matching the
  surrounding square icon buttons (`h-14 w-14` desktop, `p-2.5` adaptive) — no
  text label.
* Active-count badge is absolutely positioned on the trigger's corner, capped
  at `9+`, so the button's width never shifts with the count.
* Filter dimension surfaces are bordered (`border-surface-border`) fields with
  `rounded-xl`; active selections tint `bg-brand-primary/10` /
  `border-brand-primary`.
* Short dimensions (~2-6 options) use `FilterChipGroup`; long / sortable
  dimensions use `FilterDropdown`. Dropdowns lay out side by side with
  `flex-1 min-w-[220px]` — never `grid-cols-*` (CSS grid does not render in
  this RN-web build).

### Cards

* Must use `bg-surface-card`
* Must include `border-surface-border`
* Must be `rounded-2xl`

### Sidebar navigation

The desktop nav rail groups shortcuts into titled sections separated by hairlines
(issue #211). `components/sidebar/constants.ts` keeps `SHORTCUTS` flat (the
single source of truth for icon/label/href/permission) and declares the rail's
order + hierarchy in `SIDEBAR_GROUPS`. Only `NavRail` renders the groups; the
mobile drawer and pinned-shortcut picker still consume the flat list.

* Group titles are section labels (`text-[10px] font-black uppercase tracking-widest
  text-typography-muted`) shown only when the rail is expanded.
* Groups are separated by hairline `h-px bg-surface-border` dividers, not extra
  padding.
* A parent shortcut (e.g. Intelligence ▸ Targets/Archives) renders as a row whose
  label is a `Link` to its own href, with a sibling chevron `Pressable` absolutely
  positioned on the right edge — the chevron toggles the children, never
  navigates, so it must stay a sibling of (not nested inside) the `Link`.
* Children render indented under the parent with a `border-l` guide and `ml-5`;
  a child never outranks its parent in the DOM.
* Collapsed (icon) rail: parents render as plain icon rows (children have no room);
  active-state for a parent is `true` when either it or a child matches the path.
* Permission gating stays on individual `SHORTCUTS` entries; a group with zero
  visible items is dropped, and a parent with zero visible children degrades to a
  plain row.

### Inputs

* Must use surface background
* Must include border token
* Must use `text-typography-main`

### Focus

Focus is handled **once, globally**, at the bottom of `global.css`. A component
never styles or removes it.

* **Never** write `outline: none`, `outline-none`, `outlineWidth: 0`, or
  `outlineStyle: 'none'`. Not in a class, not in a `style` object.
* The global rule already suppresses the ugly ring — the one that appears when
  you *click* a control, or that lands on a container react-native-web or
  recharts marked focusable without it being a control. That is the case
  everybody was reaching for `outline: none` to kill.
* What survives is `:focus-visible`: a `brand-primary` ring on keyboard focus.
  That ring is an accessibility feature, not a bug. A user tabbing through a
  form has to be able to see where they are.
* If an element genuinely is not a control and still takes focus, use
  `className="focus-ring-none"`. It says the same thing as `outline: none` but
  it is greppable and it is a claim you can be held to.

Why this is a rule: 24 inputs across the app shipped with `outline-none`, so
they showed *nothing at all* when tabbed to, and the app still had a stray UA
ring around a chart. Both symptoms had the same cause — no global focus
treatment, so every author invented a local one. Fixing it globally deleted
both without touching a component.

**Do NOT create custom component styles without following these rules.**

---

## 7. Theming (Future-Proofing)

All tokens must support theming.

**Rules:**

* No hardcoded color values anywhere
* All colors must come from CSS variables
* System must support dark/light mode without changing components

---

## 8. Best Practices

1. **No inline styles**
2. **Use className only**
3. **Use semantic tokens only**
4. **Use pseudo-selectors for interactivity**

---

## 9. Enforcement Rules (CRITICAL FOR AI AGENTS)

AI MUST reject or fix code if:

* Raw Tailwind colors are used (`bg-red-500`, etc.)
* Inline styles are used
* Missing interaction states
* Missing state tokens
* Inconsistent spacing or component structure

---

## 10. Adding New Tokens

If a new design need arises:

1. Add variable in `global.css`
2. Map it in `tailwind.config.js`
3. Only then use it in components

**Never skip this process.**

---

## Final Principle

Consistency > Creativity

A consistent system scales. Random styling kills products.
