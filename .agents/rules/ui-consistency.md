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

## 6. Component Rules (STRICT)

### Buttons

* Must use `bg-brand-primary`
* Must include hover + active states
* Must be `rounded-xl`
* Must have consistent padding (`px-4 py-2` minimum)

### Cards

* Must use `bg-surface-card`
* Must include `border-surface-border`
* Must be `rounded-2xl`

### Inputs

* Must use surface background
* Must include border token
* Must use `text-typography-main`

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
