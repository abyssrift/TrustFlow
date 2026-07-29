---
trigger: always_on
---

# NewTrustFlow: Animation Consistency Guidelines

**CRITICAL INSTRUCTION FOR ALL AI AGENTS:**
Before adding or modifying any animation, pick the tool using the decision
tree in §1 — do not default to whatever animation API you reach for first.
This app runs **four** animation systems side by side on purpose (not
accidentally); using the wrong one for the job is how the codebase ends up
with a fifth.

---

## 1. Decision tree — which system to use

Ask in this order:

1. **Is it a hover/press/simple-loop CSS effect (opacity, color, a single
   `animate-pulse`)?** → Tailwind/NativeWind utility classes
   (`active:opacity-*`, `hover:*`, `transition-colors`, `animate-pulse`).
   Free, no JS, works because NativeWind maps these to real CSS on web and
   static states on native. Don't reach for reanimated for this.

2. **Is it a value-driven animation (spring/timing on scale, opacity,
   translate, a numeric readout) that needs to run identically on native and
   web?** → **`react-native-reanimated`, driven manually**: `useSharedValue`
   + `useAnimatedStyle` + `withSpring`/`withTiming`. This is the default for
   new work. Confirmed working on this app's web build — see `ReviewStatusBadge`
   (`components/task-detail/StageActions.tsx`) and `StageCountOdometer.tsx`.
   Always gate with **`useReducedMotion()`** from reanimated (mirrors OS
   "Reduce Motion" / `prefers-reduced-motion`) — every animation on this app
   uses this one mechanism, never a bespoke reduced-motion flag.

3. **Is it reanimated's *declarative* layout API — `entering`/`exiting`/
   `layout` props on `<Animated.View>` (`FadeIn`, `FadeOut`,
   `LinearTransition`, etc.)?** → **Do not rely on it painting on web in
   this app.** Verified during #124/#129: these props silently no-op on
   this project's web build (babel/worklets config drift never fully
   isolated) while working on native. If you need an enter/exit/reflow
   animation that must also work on web, use case 4 below instead. It is
   fine to leave harmless `entering`/`layout` props in place on native-only
   code paths, but never make new web functionality depend on them without
   testing in an actual browser first.

4. **Is it a web-only effect that reanimated can't or won't reliably drive**
   (FLIP between different parents, a fire-and-forget exit that must outlive
   a list-item's removal from state, anything needing a synchronous
   `getBoundingClientRect()` before/after measurement)? → **Web Animations
   API directly on the DOM node** (`element.animate()`), gated
   `Platform.OS === 'web'`. See `StageTransitionFX.tsx` and
   `AnimatedTaskCard.tsx` for the pattern: resolve the real DOM node from
   react-native-web's ref (`resolveDomNode`), call `.animate()`, use
   `anim.onfinish`/`anim.oncancel` for cleanup. This is not a workaround to
   "graduate" out of once reanimated's web bug is fixed — a cross-parent
   FLIP is not expressible through reanimated's `layout` prop even when
   reanimated is working correctly, since it only animates a component's
   own reflow within a stable parent. Treat this as a permanent, legitimate
   tool for this class of problem, not tech debt.

5. **Is it a pure expand/collapse of a block on native only, or is a
   platform-conditional split (case 2 on web) already in place?** →
   `LayoutAnimation.configureNext(...)` from `react-native`. Cheap, correct,
   and this is what it's for. **It is a confirmed no-op on web**
   (`react-native-web`'s `UIManager.configureNextLayoutAnimation` just fires
   the completion callback and animates nothing — checked directly in
   `node_modules/react-native-web/dist/exports/UIManager/index.js`). Never
   ship a `LayoutAnimation`-only expand/collapse on a component that also
   renders on web — pair it with the reanimated height-driven approach from
   case 2, gated by `Platform.OS`. `CollapsibleCard.tsx` is the reference
   implementation.

---

## 2. Verification standard (do this every time, not just for big changes)

1. `npx tsc --noEmit` → expect exactly the pre-existing baseline error count
   (10 as of 2026-07-25: `DraggableSheet.web.tsx`, `StageBuilder.web.tsx`,
   `_tasks_desktop.tsx` ×5, `useMemberLimit.ts`, `usePipelineLimit.ts`).
   Anything beyond that is new and yours to fix.
2. `node _babelcheck.js <files>` (untracked scratch helper at repo root —
   deliberately kept, do not delete) — runs the real Metro/Babel caller
   config. `tsc` does not catch bundle-fatal parse errors, and this app
   ships as a single web bundle, so one bad file can 500 the entire app.
3. For anything gated on `Platform.OS === 'web'` or a width breakpoint:
   **actually load it in a browser at both a desktop width and a mobile-web
   width (<768px)**, per the popup/modal rule in `ui-consistency.md` — a
   desktop-only verification is the single most common way a "fixed"
   animation turns out broken on mobile web.

---

## 3. Rules (STRICT)

* Never introduce a 5th animation system (no `moti`, `lottie-react-native`,
  `framer-motion`, `react-spring` — none are dependencies, keep it that way
  unless there's a concrete gap none of the four existing tools cover).
* Never assume reanimated's `entering`/`exiting`/`layout` props work on web
  in this app without testing them yourself in a browser — the silent-failure
  history here means "it compiles" and "it TypeChecks" prove nothing about
  whether it paints.
* Every reanimated-driven animation must respect `useReducedMotion()`.
* Every animation that behaves differently on web vs. native must say so in
  a comment at the point of divergence (see `StageTransitionFX.tsx` for the
  expected level of detail) — a future reader should never have to
  rediscover *why* a `Platform.OS === 'web'` branch exists.
* Don't add a second loop/pulse implementation where one already exists for
  the same visual effect — grep for `useDropPulse`-style helpers before
  writing a new `Animated.loop`.

---

## Final Principle

Four tools, one decision tree. The moment an animation gets built without
consulting §1 is the moment this list grows to five.
