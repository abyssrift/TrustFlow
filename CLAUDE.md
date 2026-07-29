**Before working on any UI-visible change, always read `.agents/rules/ui-consistency.md`, `.agents/rules/ux-consistency.md`, and `.agents/rules/ui-style-guide.md` first and follow their conventions.**

**Before adding or touching any animation, always read `.agents/rules/animation-consistency.md` first — it has a decision tree for which of the app's four animation systems to use and documents a couple of confirmed platform gotchas (`LayoutAnimation` no-ops on web, reanimated's declarative `entering`/`exiting`/`layout` props don't paint on this app's web build).**

## Popups, modals, sheets

**Never use raw RN `Modal` directly.** Every popup/modal/sheet goes through
`components/common/Popup.tsx` (or `DraggableSheet.tsx` for sheet-only cases).
This is an ongoing standardization (issue #88) — code review will bounce a
raw `<Modal>` in a screen component.

- `<Popup presentation="sheet" | "centered" | "auto">` — `auto` picks
  `centered` at/above `desktopBreakpoint` (default 768px) and `sheet` below
  it, **on web only**. Native always renders `sheet` regardless of the prop.
- `<DraggableSheet>` — bottom sheet only, no centered mode. Use directly when
  you never want a centered variant (e.g. always a drawer).
- **A fix must handle both desktop and mobile web, not just desktop.**
  `.web.tsx` files render at every web width, not just wide viewports — check
  `useWindowDimensions()` and branch, or use `Popup`'s own `auto`/`desktopBreakpoint`.
  Shipping a desktop-only fix and calling it done is the #1 way this pattern
  gets violated (see commit 2c08cc9 for an example that had to be redone).
- Extra props exist for one-off needs — check `Popup.tsx`'s prop list before
  reinventing: `sideMenu` (two-pane composers), `backdropBlur` (frosted
  backdrop instead of the default solid dim), `overlays` (viewport-fixed
  dropdowns/date-pickers that must escape the card's `overflow: hidden`),
  `containerStyle`/`containerClassName` (one-off sizing/theme-color styling).
- If a file has separate `.tsx` (native) and `.web.tsx` variants, both must
  be checked — a native-only Modal fix rarely also fixes web, and vice versa.

- `<SidebarLayout>` — pre-built scrollable sidebar for desktop two-pane Popups.
  Props: `width` (default 288), `header` (sticky header above scroll body),
  `style` (outer container). Check the file for details — use this instead
  of inline `View + ScrollView` in sidebars. Must fall back to DraggableSheet
  on mobile web (< 768px) — see RoleEditorSheet.web.tsx for the pattern.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- graphify is a Python tool installed via uv — do NOT use `npx graphify`. Run it directly as `graphify` (Git Bash: PATH includes `/c/Users/PC/AppData/Roaming/uv/tools/graphifyy/Scripts`). If `graphify` is not found, use the full path: `/c/Users/PC/AppData/Roaming/uv/tools/graphifyy/Scripts/graphify`.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
