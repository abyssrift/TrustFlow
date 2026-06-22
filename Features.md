# Project Backlog & Prioritization Matrix

## ⚡ Tier 2: Priority High (UX Friction & Core Polish)
*Functional issues that do not crash the app but introduce severe user friction or degrade the baseline experience.*

- [ ] **Mobile Safari / iOS Web Layout Scaling**
  - **Issue:** Web view on iPhone/Safari is highly unoptimized. The Inbox/Sent navigation elements scale improperly and render with broken, exaggerated heights.
  - **Fix:** Fix responsive layouts by cleaning up absolute CSS heights or flexible element definitions that fail to calculate correctly on iOS Webkit.

- [ ] **Word Document Preview Support (`.docx`)**
  - **Issue:** Users cannot preview standard Microsoft Word documents inline.
  - **Architectural Check:** Ensure the rendering module correctly links with the file version engine so that selecting older document versions updates the document viewer canvas dynamically.

- [ ] **Directional Task Action Buttons (`task.tsx`)**
  - **Issue:** Current buttons look generic and don't indicate action paths intuitively.
  - **Fix:** Dynamically render contextual arrows depending on target logic. For example, if a user is on Stage 2, a button routing back to Stage 1 faces left, while an action leaping ahead to Stage 5 faces right.

- [ ] **Mobile File Download Optimization**
  - **Issue:** Files download as compressed `.zip` assets on mobile devices by default.
  - **Fix:** Detect mobile operating systems and stream direct media extensions (images, videos, PDFs) so they open seamlessly in the device's native previewer or camera roll.

- [ ] **Lightbox Fast-Track Interaction**
  - **Fix:** Add a shortcut where a standard click opens file metadata, while `Shift + Click` fast-tracks the interaction directly to the fullscreen image/file lightbox overlay.

---

## 📈 Tier 3: Priority Medium (Product Enhancements)
*New features, optimizations, and metrics that expand product capability once platform stability is achieved.*

- [ ] **Task Creation Quick-Upload & Copy-Paste**
  - **Feature:** Implement streamlined upload systems for bulk task creation, along with native clipboard support for pasting text/assets directly into task sub-forms and validation steps.

- [ ] **FileHub Analytics Dashboard**
  - **Feature:** Build a clean, lightweight overview pane aggregating usage metrics: total volume of files sent, top 5 active senders/receivers categorized by company, and an activity ranking of communication channels.

- [ ] **Desktop Project Details Screen Expansion**
  - **Feature:** Leverage wide desktop/web screen layouts by introducing a highly descriptive, multi-column dashboard for comprehensive project metrics.

- [ ] **Corporate Screen User Connection**
  - **Feature:** Unify isolated profile instances by directly nesting user metrics into the main company administrative panel.

---

## 🏗️ Tier 4: Priority Low / Long-Term (Architectural & Strategy)
*Heavy technical changes, data life cycle definitions, and core system changes that require extensive planning and deep structural updates.*



- [ ] **First-Time User Onboarding & Permission Templates**
  - **Feature:** Implement an automated introductory sequence detailing profile setup, task management features, and specialized screen guides. Bundle this with preset administrative rule templates when a new company workspace is registered.

- [ ] **Automated Data Retention & Inactivity Policy**
  - **Feature:** Design a data-purging engine that leaves no database orphans when companies or profiles are dropped.
  - **Policy:** Enforce an automated 90-day inactive company deletion policy that executes recurring warnings to all workspace contacts every 10 days leading up to data removal.

- [ ] **Fluid Task Animations**
  - **Feature:** Eradicate sudden item snapping. Implement sleek structural micro-animations when generating cards or transitioning tasks fluidly between pipeline columns.

- [ ] **Task Data Mobility (CSV/XLSX Import/Export)**
  - **Feature:** Code comprehensive ingestion and data backup mechanisms allowing project configurations to be updated via spreadsheet sheets.

- [ ] **Billing Integration Foundation**
  - **Feature:** Set up data entities, pricing tracking properties, and hooks required to interface with third-party payment gateways.