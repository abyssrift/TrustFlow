# Mobile Non-Conformance Audit Report

This document identifies web-specific components and pages that do not conform to mobile design principles (responsiveness, touch-friendliness, and platform-specific UI). These findings are based on an automated audit of `.web.tsx` files and manual code review.

## 1. High-Level Summary of Issues

| Issue Category | Description | Impact |
| :--- | :--- | :--- |
| **Fixed Sidebars** | Sidebars with hardcoded widths (`w-80`, `w-64`) that don't collapse. | Breaks layout on screens < 768px. |
| **Desktop-First Containers** | Use of `max-w-[1400px+]` and `p-10` paddings. | Content feels "shrunk" or overflows on mobile. |
| **Fixed Overlays** | Overlays (Calendars, Dropdowns) with hardcoded `width: 820px` and `position: fixed`. | Completely unusable on mobile screens (375px-420px). |
| **Hover-Only Actions** | Critical UI elements (buttons, labels) only visible on `hover:`. | Users on mobile cannot see or trigger these actions. |
| **Wide Data Tables** | Horizontal scrolling tables with fixed-width columns. | Difficult to read and interact with on small screens. |

---

## 2. Specific Non-Conforming Pages

### 2.1 Analytics Hub (`analytics.web.tsx`)
- **Issue**: The "Strategic Benchmarking Results" table uses fixed widths (`200px`, `110px`) for columns.
- **Issue**: `PremiumCalendarPicker` uses `width: 820` and `position: 'fixed'`.
- **Issue**: 3-column "Cockpit Header" uses `xl:flex-nowrap` but columns are `min-w-[350px]`, which will wrap poorly on tablets/large phones.
- **Mobile Conformance**: The native version (`analytics.tsx`) uses a card-based layout, but the web version is missing these adaptive patterns for mobile browsers.

### 2.2 Pipeline Editor (`pipelines.web.tsx`)
- **Issue**: Hardcoded sidebar `w-80`.
- **Issue**: Tab switcher in header (6 items) will overflow horizontally without a scroll container.
- **Issue**: `StageBuilder.web.tsx` uses complex drag-and-drop or graph views that are not touch-optimized.

### 2.3 Task Detail (`[id].web.tsx`)
- **Issue**: `max-w-[1000px]` with `p-10` padding. On mobile, this leaves almost no room for content.
- **Issue**: Large titles (`text-5xl`) and absolute positioned floating elements.

### 2.4 Report Generator (`ReportGenerator.web.tsx`)
- **Issue**: Main layout uses `flex-row gap-12` (line 222) which forces side-by-side columns on all screens, breaking on mobile.
- **Issue**: Header uses `text-6xl` (line 200) for the title, which will overflow viewports smaller than 600px.
- **Issue**: Rigid dual-column structure (`flex-[1.5]` and `flex-1`) with `sticky top-12` parameters card.
- **Recommendation**: Transition to `flex-col` on mobile and reduce font sizes.

### 2.5 Create Task Modal (`CreateTaskModal.web.tsx`)
- **Issue**: `max-w-[1200px]` and `h-[800px]` (fixed height!).
- **Issue**: `position: 'fixed'` for calendar overlays with `width: 820`.
- **Issue**: "Clone →" text only visible on `group-hover`.

---

## 3. Web-Specific Components Audit

### 3.1 `Sidebar.web.tsx`
- **Issue**: Uses `transition-[width]` between `w-64` and `w-20`. No "hidden" or "hamburger" mode for mobile.
- **Recommendation**: Implement a slide-over drawer for screens < 1024px.

### 3.2 `StageBuilder.web.tsx`
- **Issue**: Complex graph/list views with `hover:` states for stage actions.
- **Recommendation**: Switch to a simplified card list for mobile, matching the native `StageBuilder`.

### 3.3 `Projects.web.tsx`
- **Issue**: Grid layout `w-[calc(33.33%-20px)]` assumes a 3-column desktop grid.
- **Recommendation**: Use `w-full` for mobile and `lg:w-[calc(33.33%-20px)]` for desktop.

---

## 4. Suggested Fixes (Roadmap)

### Short-Term (Critical)
1.  **Calendar Overlays**: Refactor `PremiumCalendarPicker` to be responsive (use `w-full` or a modal on mobile).
2.  **Sidebars**: Add a media query to hide the sidebar and show a hamburger menu on mobile.
3.  **Container Padding**: Change `p-10` to `p-4 md:p-10`.

### Long-Term (Adaptive Refactor)
1.  **Path B Adoption**: For complex pages (Analytics, Pipelines), implement conditional rendering that uses the "Card Summary" pattern when `useWindowDimensions().width < 768`.
2.  **Shared Hooks**: Extract logic from `.web.tsx` and `.tsx` into shared hooks to ensure feature parity while maintaining divergent UIs.

---
**Audit performed by Antigravity AI on 2026-05-08.**
