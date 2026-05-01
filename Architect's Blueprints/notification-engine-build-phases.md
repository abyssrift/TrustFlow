# Notification Engine: Phased Build Plan

> Companion to `feature-contract-notification-engine.md`.
> Each phase is a shippable unit. Do not begin a phase until the prior phase passes its acceptance criteria.

---

## Phase 1 — DB Foundation
**Goal:** All six tables exist with correct RLS, indexes, RPCs, and auto-triggers. No client or Edge Function code yet.

### Steps
1. Write Supabase migration: create all six tables in order
   - `notification_events` (with index on `event_type, processed_at`)
   - `notification_rules`
   - `entity_watchers`
   - `notifications`
   - `notification_preferences`
   - `push_subscriptions`
2. Apply RLS policies per the schema spec in the feature contract
3. Write SECURITY DEFINER RPCs:
   - `rpc_upsert_push_subscription`
   - `rpc_remove_push_subscription`
   - `rpc_mark_notification_read`
   - `rpc_mark_all_notifications_read`
   - `rpc_upsert_notification_preferences`
   - `rpc_create_notification_rule`
   - `rpc_update_notification_rule`
   - `rpc_toggle_notification_rule`
   - `rpc_toggle_watcher`
4. Write trigger: auto-insert default `notification_preferences` row on new user signup
5. Seed two default active rules for common cases:
   - `task.assigned` → strategies: `['assignee']` → conditions: `{}`
   - `task.mentioned` → strategies: `['specific_users']` (resolved to `mentioned_user_id`) → conditions: `{}`

### Acceptance Criteria
- [ ] All six tables exist in Supabase
- [ ] Direct `INSERT INTO notifications` via anon key returns 403
- [ ] Direct `INSERT INTO notification_rules` by a user without `manage_notifications` returns 403
- [ ] `rpc_mark_notification_read` with another user's `notification_id` affects 0 rows (RLS)
- [ ] `rpc_toggle_watcher` on a task creates and removes the `entity_watchers` row on alternate calls
- [ ] New user signup auto-creates a `notification_preferences` row with all defaults true

---

## Phase 2 — PostgreSQL Event Triggers
**Goal:** Key table mutations automatically write structured rows into `notification_events`. The engine has ears.

### Steps
1. Write SECURITY DEFINER trigger function `fn_emit_notification_event()` — generic function that formats and inserts into `notification_events`
2. Attach triggers to:
   - `tasks` table — AFTER INSERT → `task.created`; AFTER UPDATE OF `assignee_id` → `task.assigned`; AFTER UPDATE OF `stage_id` → `task.stage_transition` (join stage to get `stage_tag`); AFTER UPDATE OF `status` → `task.status_changed`
   - `task_comments` table — AFTER INSERT → `task.commented`; inspect comment body for `@mentions` → also emit `task.mentioned` per mentioned user
3. Write cron Edge Function `check-overdue-tasks`:
   - Runs daily (Supabase cron or pg_cron)
   - Selects tasks where `due_at BETWEEN now() AND now() + interval '24 hours'` → emits `task.due_soon`
   - Selects tasks where `due_at < now()` AND not yet notified today → emits `task.overdue`

### Acceptance Criteria
- [ ] Updating a task's `assignee_id` inserts a `task.assigned` row in `notification_events`
- [ ] Moving a task to a new stage inserts `task.stage_transition` with correct `stage_tag` in payload
- [ ] Adding a comment with `@username` inserts both `task.commented` and `task.mentioned` rows
- [ ] `notification_events` rows are append-only — no UPDATE or DELETE policies exist
- [ ] Cron function inserts `task.due_soon` events for qualifying tasks when run manually

---

## Phase 3 — Rule Evaluator Edge Function
**Goal:** Unprocessed events are matched against active rules, recipients resolved, and `notify` called per recipient.

### Steps
1. Create Edge Function `process-notification-event`:
   - Accepts a single event payload (called by Supabase DB Webhook on `notification_events` INSERT)
   - Queries `notification_rules` where `event_type = event.event_type AND is_active = true`
   - For each rule: evaluate conditions (all key-value pairs must match `event.payload`)
   - For matching rules: resolve recipients per each strategy in `recipient_strategies`
     - `assignee` → query task's current assignee(s)
     - `task_owner` → query task's `created_by`
     - `pipeline_members` → query pipeline membership table
     - `watchers` → query `entity_watchers` for `entity_type/entity_id`
     - `role` → query users holding `recipient_config.role`
     - `specific_users` → use `recipient_config.user_ids` directly
   - Deduplicate merged recipient list (Set by user_id)
   - Exclude `actor_id` from recipients (don't notify the person who caused the event)
   - For each unique recipient: call `notify` Edge Function with resolved title, body, data
   - Mark `notification_events.processed_at = now()`
2. Configure Supabase DB Webhook: `notification_events` AFTER INSERT → `process-notification-event`

### Acceptance Criteria
- [ ] Inserting a `task.assigned` event with a matching active rule triggers `notify` for the assignee
- [ ] Actor (who caused the event) is excluded from recipients even if they match a strategy
- [ ] A rule with `conditions: {}` matches all events of that type
- [ ] A rule with `conditions: { "stage_tag": "requires_approval" }` only fires on matching events
- [ ] A user matching both `assignee` and `watchers` strategies receives exactly one `notify` call
- [ ] Event with no matching rules is marked `processed_at` without calling `notify`
- [ ] Rule with `is_active: false` is ignored by the evaluator

---

## Phase 4 — Notify Dispatcher + Email Channel
**Goal:** Calling `notify` writes a notification record and sends an email to enabled users.

### Steps
1. Create Edge Function `notify`:
   - Accepts `{ user_id, type, title, body, data }`
   - Reads `notification_preferences` for target user (default all-enabled if no row)
   - Inserts row into `notifications` table
   - Calls enabled channel handlers in `Promise.allSettled` (fail-safe fan-out)
   - Updates `notifications.channels_sent` with successful channel names
2. Implement email channel handler inside `notify`:
   - Uses Resend API (`RESEND_API_KEY` stored in Supabase vault)
   - HTML template: TrustFlow branding, notification title, body, CTA button linking to `data.task_id` or `data.pipeline_id`
3. Store required secrets in Supabase vault: `RESEND_API_KEY`, `NOTIFY_INTERNAL_SECRET`

### Acceptance Criteria
- [ ] Calling `notify` directly inserts a row in `notifications`
- [ ] Email arrives in target mailbox within 10 seconds
- [ ] `email_enabled: false` in preferences → no email sent, row still inserted
- [ ] Resend API error → `channels_sent` omits `'email'`, no exception thrown to caller
- [ ] Full flow test: update task assignee → trigger → rule match → `notify` → email received

---

## Phase 5 — Mobile Push Channel
**Goal:** Authenticated mobile users receive OS push notifications.

### Steps
1. Install `expo-notifications`, configure `app.json` (iOS permission string, Android notification channel)
2. Create `usePushRegistration` hook:
   - Requests permission on first mount (mobile only, guard with `Platform.OS !== 'web'`)
   - Calls `Notifications.getExpoPushTokenAsync()`
   - Generates stable `device_id` (stored in `AsyncStorage`, created once per install)
   - Calls `rpc_upsert_push_subscription` with type `expo`, token, device_id, platform
   - Listens for token refresh events and re-registers
3. Wire `usePushRegistration` into `NotificationContext` (mobile branch)
4. Implement mobile push channel handler inside `notify` Edge Function:
   - Queries `push_subscriptions` for user's `expo` type rows
   - Batches tokens into Expo Push API POST (`https://exp.host/--/api/v2/push/send`)
   - On `DeviceNotRegistered` response: deletes that row from `push_subscriptions`

### Acceptance Criteria
- [ ] First app open on physical iOS/Android shows system permission dialog
- [ ] Token is stored in `push_subscriptions` after permission granted
- [ ] Re-opening app does not create a duplicate row (UPSERT confirms)
- [ ] End-to-end: task assignment triggers OS push notification on device
- [ ] Permission denied → no token stored, `push_mobile` channel skipped silently
- [ ] Stale token response removes the subscription row from DB

---

## Phase 6 — Web Push Channel (VAPID + Service Worker)
**Goal:** Browser and PWA users receive OS-level desktop notification popups.

### Steps
1. Generate VAPID key pair:
   ```
   npx web-push generate-vapid-keys
   ```
   Store in Supabase vault: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
   Expose `VAPID_PUBLIC_KEY` as `EXPO_PUBLIC_VAPID_PUBLIC_KEY` in `.env`
2. Create `public/sw.js` service worker:
   - Handles `push` event → parses JSON payload → calls `self.registration.showNotification(title, { body, data, icon })`
   - Handles `notificationclick` → `clients.openWindow(data.url)` deep link to entity
3. In web entry point (`app/_layout.web.tsx`):
   - Register service worker on mount: `navigator.serviceWorker.register('/sw.js')`
   - After registration resolves: `pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: VAPID_PUBLIC_KEY })`
   - Serialize `PushSubscription` to JSON string
   - Generate stable browser `device_id` (stored in `localStorage`)
   - Call `rpc_upsert_push_subscription` with type `web`, serialized token, device_id, platform `web`
4. Implement web push channel handler inside `notify` Edge Function:
   - Queries `push_subscriptions` for user's `web` type rows
   - Sends VAPID push via `web-push` npm package, JSON payload `{ title, body, url }`
   - On 410 Gone response: deletes that subscription row

### Acceptance Criteria
- [ ] Browser prompts for notification permission on first web load
- [ ] VAPID subscription stored in `push_subscriptions` after permission granted
- [ ] OS notification popup appears when `notify` fires for a web user (tab can be in background)
- [ ] Clicking popup navigates to correct task/pipeline route in the app
- [ ] Works when Expo web tab is fully closed (service worker handles the push event)
- [ ] 410 response from VAPID send removes the stale subscription from DB
- [ ] PWA install: OS notification works identically to browser tab

---

## Phase 7 — NotificationContext + In-App Toasts
**Goal:** All in-app notification state is centralized. Incoming notifications show as toasts in real time.

### Steps
1. Create `contexts/NotificationContext.tsx`:
   - Supabase Realtime subscription on `notifications` table filtered by `user_id = auth.uid()`
   - On INSERT event → append to local state, trigger toast
   - State: `notifications: Notification[]`, `unreadCount: number`, `isLoading: boolean`
   - Actions: `markRead(id)`, `markAllRead()`, `refresh()`
   - On mount: fetch latest 50 notifications for initial load
   - On Realtime reconnect: re-fetch to catch any missed events
   - Calls `usePushRegistration` (mobile) and web SW registration logic (web) — registration centralized here
2. Create `<InAppToast />` component — Path B:
   - **Web**: Fixed position, top-right corner, max 3 stacked, each auto-dismisses after 4s, slide-in animation
   - **Mobile**: Bottom modal overlay, single toast, auto-dismisses after 4s, slide-up animation
   - Both: show title + truncated body, tap/click calls `markRead` and navigates to entity
3. Register `NotificationContext` in root `_layout.tsx` inside `AuthProvider`
4. Add Electron IPC stub:
   ```ts
   // Electron channel — no-op until Electron wrapper ships
   if (typeof window !== 'undefined' && (window as any).__ELECTRON_NOTIFY__) {
     (window as any).__ELECTRON_NOTIFY__(notification);
   }
   ```

### Acceptance Criteria
- [ ] `notify` called while app is open → in-app toast appears within 1s (Realtime)
- [ ] Tapping toast navigates to the correct task or pipeline screen
- [ ] `unreadCount` increments on new notification
- [ ] `markAllRead()` sets `unreadCount` to 0
- [ ] Re-connecting after brief offline → missed notifications appear (re-fetch on reconnect)
- [ ] Toast renders correctly on web (top-right) and mobile (bottom)
- [ ] Electron stub present in code, does not throw in browser environment

---

## Phase 8 — Bell UI + Notification Center + Rules UI + Preferences + Watchers
**Goal:** Users can view history and manage preferences. Privileged users can manage rules. Any user can watch entities.

### Steps
1. **`<NotificationBell />`** — Path B:
   - **Web**: Icon button in app header, unread count badge, opens dropdown panel (last 20 notifications, mark-all-read, link to full center)
   - **Mobile**: Bell in tab bar or header, opens bottom sheet with same content
2. **Notification Center** (`app/notifications.tsx` / `app/notifications.web.tsx`):
   - Paginated full list, grouped by date
   - Unread items visually distinct
   - Tap navigates to entity + marks read
3. **Preferences section** (add to existing Profile/Settings screen):
   - Toggle: Email Notifications
   - Toggle: Mobile Push Notifications
   - Toggle: Web (Desktop) Notifications
   - Saved via `rpc_upsert_notification_preferences`
4. **Notification Rules screen** (admin/manager only — hidden from users without `manage_notifications`):
   - List all rules with active/inactive toggle
   - Create rule form: name, event type (dropdown of known types), conditions (key-value builder), recipient strategies (multi-select), channels override
   - Edit and delete existing rules
   - Calls `rpc_create_notification_rule`, `rpc_update_notification_rule`, `rpc_toggle_notification_rule`
5. **Watch/Unwatch button** on task detail screen and pipeline screen:
   - Calls `rpc_toggle_watcher`
   - Shows watcher count
   - Visual filled/outline state

### Acceptance Criteria
- [ ] Bell badge reflects correct unread count at all times
- [ ] Opening bell panel and reading notifications updates unread count
- [ ] Notification center paginates correctly and marks items read on tap
- [ ] Preferences persist correctly after page refresh
- [ ] Rules screen hidden from users without `manage_notifications` permission
- [ ] Creating a rule and triggering its event type results in a notification
- [ ] Toggling a rule inactive stops notifications for that rule immediately
- [ ] Watch button toggles state correctly; watcher count updates

---

## Deferred: Electron Wrapper
**When to start:** After Phase 8 ships and desktop adoption data confirms Electron value.

### Rough scope (~2–3 days)
1. Add `electron/` directory with `main.js` (main process) and `preload.js` (context bridge)
2. Configure `electron-builder` to load Expo web export output as `BrowserWindow` source
3. Implement `Notification` API calls in Electron main process
4. Expose `window.__ELECTRON_NOTIFY__` via `contextBridge` in preload — this activates the Phase 7 stub automatically
5. Add system tray icon with unread count badge
6. Configure code signing (Apple Developer account for macOS, EV cert for Windows SmartScreen)
7. Set up `electron-updater` pointing at GitHub Releases for auto-update

> **Zero engine changes. Zero schema changes.** The Phase 7 IPC stub activates the moment `window.__ELECTRON_NOTIFY__` is present.

---

## Environment Variables & Secrets Required

| Secret / Env Var | Location | Used By |
| :--- | :--- | :--- |
| `RESEND_API_KEY` | Supabase vault | `notify` Edge Function — email channel |
| `VAPID_PUBLIC_KEY` | Supabase vault + `.env` as `EXPO_PUBLIC_VAPID_PUBLIC_KEY` | `notify` EF + client SW registration |
| `VAPID_PRIVATE_KEY` | Supabase vault | `notify` Edge Function — web push signing |
| `VAPID_SUBJECT` | Supabase vault | `notify` Edge Function (`mailto:` contact) |
| `NOTIFY_INTERNAL_SECRET` | Supabase vault | Auth token for internal EF-to-EF calls |
