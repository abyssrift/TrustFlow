---
trigger: always_on
---

# CROSS-PLATFORM UI/UX DIRECTIVE

## 1. Core Objective
Whenever you are tasked with designing, suggesting, or implementing a User Interface (UI) feature, you MUST natively consider both Desktop Web and Mobile environments. Your goal is to ensure the feature achieves the exact same functional outcome on both platforms, even if it requires completely different UI components to do so.

## 2. Mandatory Evaluation Phase
Before generating code or finalizing a UI design, evaluate the component against the following constraints:
*   **Interaction:** Desktop relies on clicks and hover states. Mobile relies on touch, swipes, and has NO hover capability.
*   **Space:** Desktop has wide, expansive real estate. Mobile is vertically constrained and narrow.
*   **Ergonomics:** Mobile UIs must account for thumb reachability (e.g., placing critical actions near the bottom) and avoid tiny, densely packed tap targets.

## 3. Implementation Strategy Strategy
Based on your evaluation, choose one of the following implementation paths and explicitly state your choice in your response:

### Path A: Unified Responsive Component
Use this when the UI translates cleanly between mobile and desktop using standard responsive CSS (media queries, flex-wrap, grid changes).
*   **Examples:** Text blocks, simple cards, standard forms, hero sections.
*   **Action:** Write a single component that adjusts gracefully across breakpoints.

### Path B: Adaptive / Divergent Components
Use this when a Desktop UI paradigm provides a terrible Mobile experience (or vice versa). You must implement distinct components or significantly alter the render tree based on the viewport/device.
*   **Examples:** 
    *   *Desktop:* Complex data table with horizontal scrolling. -> *Mobile:* A vertical list of summary cards.
    *   *Desktop:* Multi-column mega menu (hover-activated). -> *Mobile:* Full-screen hamburger menu or bottom navigation sheet (touch-activated).
    *   *Desktop:* Floating popover/tooltip. -> *Mobile:* Modal or bottom sheet.
*   **Action:** Implement conditional rendering or distinct sub-components (e.g., `<DesktopNav />` and `<MobileNav />`) that share the same underlying state and business logic but diverge in presentation.

## 4. Output Requirements
When delivering the code, you must:
1. Briefly explain *why* you chose Path A or Path B for the requested feature.
2. Provide the implementation for BOTH Desktop and Mobile.
3. Ensure that all interactive elements have appropriately sized tap targets for mobile (minimum 44x44px).
4. Extract shared business logic (hooks, state management) outside of the UI components so it can be easily shared if you use Path B.