# Feature Contract: Multi-Channel Notification Engine

## 1. The Context Ledger

*   **Rule-Driven Dispatch**: Notifications are never hardcoded. All triggers are rows in `notification_rules`. Adding, removing, or changing a trigger requires no deployment — only a DB row change. The engine evaluates rules against events at runtime.
*   **Engine-First, Channel-Agnostic**: The core dispatcher (`notify` Edge Function) does not contain channel-specific logic. Channels are pluggable receivers. Adding or removing a channel requires no changes to the engine or rule system.
*   **Event Sourcing**: Every meaningful state change in the system appends an immutable row to `notification_events`. This is the ground truth. The rule engine reads from this table — it never observes DB mutations directly.
*   **Permission-Gated Rule Management**: Creating, editing, and deleting rules requires the `manage_notifications` RBAC permission (held by owners and privileged managers). RLS enforces this at the DB level — no application-layer guard is sufficient on its own.
*   **Watchers as First-Class Recipients**: Any authenticated user can self-subscribe to any task or pipeline they care about via `entity_watchers`. The `watchers` recipient strategy resolves these subscriptions during rule evaluation.
*   **Server-Side Authority**: All notification dispatch is initiated server-side via Supabase Edge Functions. The client never calls channel APIs (email, push) directly. This ensures notifications fire even when the user's device is offline or the app is closed.
*   **Audit Trail**: Every notification is written to the `notifications` table before any fan-out begins. If all channels fail, the record still exists and can be inspected.
*   **User Sovereignty**: Each user controls their channel preferences via `notification_preferences`. The engine respects opt-outs before dispatching — never send to a disabled channel.
*   **Partial Failure Tolerance**: If one channel fails (e.g. email service down), remaining channels still fire. Failures are logged per-channel and do not abort fan-out.
*   **Subscription Deduplication**: Push subscriptions are keyed on `(user_id, device_id)`. Re-registering the same device updates the token rather than creating duplicates.
*   **Realtime In-App Layer**: The `notifications` table is subscribed to via Supabase Realtime on the client. In-app toasts are driven by this subscription, not by polling.
*   **RLS Lockdown**: All mutations to notification tables go through SECURITY DEFINER RPCs or Edge Functions using the service role. No direct INSERT/UPDATE/DELETE from the client API.
*   **Electron Reserved**: The engine reserves a no-op `electron_ipc` hook point. When Electron is added as a platform, it wires in without any engine or schema changes.
*   **PWA-First Desktop**: Desktop (laptop) users are served via Web Push (VAPID) with a service worker. This covers OS-level notification popups for browser tabs and PWA installs.

---

## 2. Feature Matrix

*   **FM-1: DB Schema & RLS** — Five tables (`notifications`, `notification_preferences`, `push_subscriptions`, `notification_events`, `notification_rules`, `entity_watchers`) with full RLS lockdown. All mutations via RPCs or service-role Edge Functions.
*   **FM-2: PostgreSQL Event Triggers** — AFTER INSERT/UPDATE triggers on key tables (`tasks`, `task_comments`) write structured rows into `notification_events` automatically.
*   **FM-3: Rule Evaluator Edge Function** — `process-notification-event` reads unprocessed events, finds matching active rules, evaluates key-value conditions, resolves recipients by strategy, deduplicates, and calls `notify` per recipient.
*   **FM-4: Notify Dispatcher Edge Function** — `notify` reads user preferences, fans out to enabled channels in `Promise.allSettled`, updates `channels_sent` on the notification record.
*   **FM-5: Email Channel** — Resend API integration inside `notify`. HTML email template with title, body, and CTA button deep-linking to the entity.
*   **FM-6: Mobile Push Channel** — `expo-notifications` library. Permission flow, Expo Push Token registration stored in `push_subscriptions`. Expo Push Notification Service (EPN) delivery.
*   **FM-7: Web Push Channel** — VAPID key pair. Service worker (`public/sw.js`) handles `push` events and `notificationclick` routing. Subscription stored in `push_subscriptions`.
*   **FM-8: NotificationContext** — Client-side context. Owns Realtime subscription, unread state, channel registration on mount, mark-as-read mutations.
*   **FM-9: In-App Toast UI** — Path B: fixed banner top-right on web (stacks up to 3, auto-dismisses 4s), bottom modal overlay on mobile (auto-dismisses 4s). Tapping navigates to entity.
*   **FM-10: Notification Bell + Feed UI** — Path B: dropdown panel on web, bottom sheet on mobile. Unread badge, mark-all-read, link to full notification center.
*   **FM-11: Notification Rules UI** — Admin/manager screen to list, create, edit, and toggle rules. Visible only to users with `manage_notifications` permission.
*   **FM-12: Notification Preferences Screen** — Per-user channel toggles (email, mobile push, web push). Persisted via RPC.
*   **FM-13: Watchers UI** — Watch/Unwatch button on task and pipeline screens. Calls `rpc_toggle_watcher`. Watcher count displayed.
*   **FM-14: Electron IPC Stub** — Reserved no-op channel point in `NotificationContext`. Activates automatically when Electron wrapper is added.

---

## 3. Event Types

These are the string keys fired into `notification_events.event_type`. New event types are added by writing a new PostgreSQL trigger — no Edge Function changes needed.

| Event Type | Fired When | Key Payload Fields |
| :--- | :--- | :--- |
| `task.created` | New task inserted | `task_id`, `pipeline_id`, `stage_id`, `created_by` |
| `task.assigned` | Assignee added to task | `task_id`, `pipeline_id`, `assignee_id`, `assigned_by` |
| `task.unassigned` | Assignee removed from task | `task_id`, `pipeline_id`, `removed_user_id` |
| `task.stage_transition` | Task moves to a new pipeline stage | `task_id`, `pipeline_id`, `from_stage_id`, `to_stage_id`, `stage_tag` |
| `task.status_changed` | Task status field updated | `task_id`, `pipeline_id`, `from_status`, `to_status` |
| `task.completed` | Task marked as complete | `task_id`, `pipeline_id`, `completed_by` |
| `task.commented` | Comment added to task | `task_id`, `comment_id`, `commented_by` |
| `task.mentioned` | User @mentioned in a comment | `task_id`, `comment_id`, `mentioned_user_id`, `mentioned_by` |
| `task.due_soon` | 24h before deadline (cron-fired) | `task_id`, `pipeline_id`, `assignee_id`, `due_at` |
| `task.overdue` | Past deadline (cron-fired) | `task_id`, `pipeline_id`, `assignee_id`, `due_at` |
| `pipeline.member_added` | User added to a pipeline | `pipeline_id`, `added_user_id`, `added_by` |
| `pipeline.archived` | Pipeline archived | `pipeline_id`, `archived_by` |

---

## 4. Recipient Strategies

Rules specify one or more strategies. Recipients from all strategies are merged and deduplicated before dispatch — a user matching both `assignee` and `watchers` receives one notification, not two.

| Strategy | Resolves to | Config Required |
| :--- | :--- | :--- |
| `assignee` | Current task assignee(s) | None |
| `task_owner` | Task creator | None |
| `pipeline_members` | All members of the parent pipeline | None |
| `watchers` | Users watching this entity via `entity_watchers` | None |
| `role` | All users holding a specified RBAC role | `{ "role": "manager" }` |
| `specific_users` | Explicit user ID list (escape hatch) | `{ "user_ids": ["uuid", ...] }` |

---

## 5. Global Utilities Mandate

*   `useAuth` / `AuthContext`: All notifications are scoped to the authenticated user. The `manage_notifications` permission check uses the existing RBAC system from `AuthContext`.
*   `supabase` client (`lib/supabase.ts`): Used for Realtime subscriptions and RPC calls on the client.
*   `expo-notifications`: Mobile push token lifecycle (request, get, refresh).
*   `NotificationContext`: Single source of truth for in-app notification state. All UI components read from this context — no component fetches notifications independently.

---

## 6. Database Schema (Supabase)

### Table: `notification_events` (append-only event log)
| Column | Type | Constraint |
| :--- | :--- | :--- |
| `id` | uuid (PK) | `gen_random_uuid()` |
| `event_type` | text | NOT NULL |
| `entity_type` | text | NOT NULL — `'task'`, `'pipeline'`, `'user'` |
| `entity_id` | uuid | NOT NULL |
| `actor_id` | uuid (FK → auth.users) | NULLABLE — null for cron/system events |
| `payload` | jsonb | NOT NULL DEFAULT `'{}'` |
| `processed_at` | timestamptz | NULLABLE — null = pending |
| `created_at` | timestamptz | DEFAULT `now()` |

**RLS:** No client access. Written exclusively by SECURITY DEFINER trigger functions. Read by Edge Functions via service role key.

**Index:** `(event_type, processed_at)` for efficient polling of pending events.

---

### Table: `notification_rules`
| Column | Type | Constraint |
| :--- | :--- | :--- |
| `id` | uuid (PK) | `gen_random_uuid()` |
| `name` | text | NOT NULL |
| `description` | text | NULLABLE |
| `event_type` | text | NOT NULL — must match a known event type |
| `conditions` | jsonb | DEFAULT `'{}'` — empty = match all |
| `recipient_strategies` | text[] | NOT NULL — e.g. `['assignee', 'watchers']` |
| `recipient_config` | jsonb | DEFAULT `'{}'` — config for `role` / `specific_users` strategies |
| `channels_override` | jsonb | NULLABLE — null = use user prefs; or `{"email": false}` |
| `is_active` | boolean | DEFAULT `true` |
| `created_by` | uuid (FK → auth.users) | NOT NULL |
| `created_at` | timestamptz | DEFAULT `now()` |
| `updated_at` | timestamptz | DEFAULT `now()` |

**RLS:**
- SELECT: any authenticated user (transparency)
- INSERT / UPDATE / DELETE: only users where RBAC grants `manage_notifications` permission

---

### Table: `entity_watchers`
| Column | Type | Constraint |
| :--- | :--- | :--- |
| `id` | uuid (PK) | `gen_random_uuid()` |
| `user_id` | uuid (FK → auth.users) | NOT NULL, CASCADE DELETE |
| `entity_type` | text | NOT NULL — `'task'`, `'pipeline'` |
| `entity_id` | uuid | NOT NULL |
| `created_at` | timestamptz | DEFAULT `now()` |
| UNIQUE | `(user_id, entity_type, entity_id)` | Prevents duplicate watches |

**RLS:** Users can SELECT, INSERT, DELETE their own rows only (`auth.uid() = user_id`).

---

### Table: `notifications` (delivery audit log)
| Column | Type | Constraint |
| :--- | :--- | :--- |
| `id` | uuid (PK) | `gen_random_uuid()` |
| `user_id` | uuid (FK → auth.users) | NOT NULL, CASCADE DELETE |
| `type` | text | NOT NULL |
| `title` | text | NOT NULL |
| `body` | text | NOT NULL |
| `data` | jsonb | DEFAULT `'{}'` |
| `read_at` | timestamptz | NULLABLE — null = unread |
| `channels_sent` | text[] | DEFAULT `'{}'` — populated post fan-out |
| `created_at` | timestamptz | DEFAULT `now()` |

**RLS:** SELECT only for `auth.uid() = user_id`. All writes via service-role Edge Functions.

---

### Table: `notification_preferences`
| Column | Type | Constraint |
| :--- | :--- | :--- |
| `user_id` | uuid (PK, FK → auth.users) | CASCADE DELETE |
| `email_enabled` | boolean | DEFAULT `true` |
| `push_mobile_enabled` | boolean | DEFAULT `true` |
| `push_web_enabled` | boolean | DEFAULT `true` |
| `updated_at` | timestamptz | DEFAULT `now()` |

**RLS:** SELECT and UPDATE only for `auth.uid() = user_id`. Row auto-inserted on user signup via trigger.

---

### Table: `push_subscriptions`
| Column | Type | Constraint |
| :--- | :--- | :--- |
| `id` | uuid (PK) | `gen_random_uuid()` |
| `user_id` | uuid (FK → auth.users) | NOT NULL, CASCADE DELETE |
| `type` | text | CHECK: `'expo'` or `'web'` |
| `token` | text | NOT NULL |
| `device_id` | text | NOT NULL |
| `platform` | text | CHECK: `'ios'`, `'android'`, `'web'` |
| `created_at` | timestamptz | DEFAULT `now()` |
| `last_active_at` | timestamptz | DEFAULT `now()` |
| UNIQUE | `(user_id, device_id)` | |

**RLS:** SELECT only for `auth.uid() = user_id`. All writes via SECURITY DEFINER RPCs.

---

## 7. Data Payloads (Strict)

### Fire Event (internal — called by PostgreSQL triggers or cron Edge Functions)
```json
{
  "event_type": "task.stage_transition",
  "entity_type": "task",
  "entity_id": "UUID",
  "actor_id": "UUID",
  "payload": {
    "task_id": "UUID",
    "pipeline_id": "UUID",
    "from_stage_id": "UUID",
    "to_stage_id": "UUID",
    "stage_tag": "requires_approval"
  }
}
```

### Create Rule (RPC: `rpc_create_notification_rule`)
```json
{
  "p_name": "Notify managers on approval stage",
  "p_description": "Fires whenever a task enters any stage tagged requires_approval",
  "p_event_type": "task.stage_transition",
  "p_conditions": { "stage_tag": "requires_approval" },
  "p_recipient_strategies": ["role", "watchers"],
  "p_recipient_config": { "role": "manager" },
  "p_channels_override": null
}
```

### Toggle Rule (RPC: `rpc_toggle_notification_rule`)
```json
{
  "p_rule_id": "UUID",
  "p_is_active": false
}
```

### Toggle Watcher (RPC: `rpc_toggle_watcher`)
```json
{
  "p_entity_type": "task",
  "p_entity_id": "UUID"
}
```

### Dispatch Notification (Edge Function: `notify` — called by rule evaluator)
```json
{
  "user_id": "UUID",
  "type": "task.stage_transition",
  "title": "Task Needs Approval",
  "body": "\"Fix login bug\" has entered the Approval stage.",
  "data": { "task_id": "UUID", "pipeline_id": "UUID" }
}
```

### Register Push Subscription (RPC: `rpc_upsert_push_subscription`)
```json
{
  "p_type": "expo",
  "p_token": "ExponentPushToken[xxxxxx]",
  "p_device_id": "device-fingerprint-string",
  "p_platform": "ios"
}
```

### Mark Read (RPC: `rpc_mark_notification_read`)
```json
{ "p_notification_id": "UUID" }
```

### Mark All Read (RPC: `rpc_mark_all_notifications_read`)
```json
{}
```

### Upsert Preferences (RPC: `rpc_upsert_notification_preferences`)
```json
{
  "p_email_enabled": true,
  "p_push_mobile_enabled": false,
  "p_push_web_enabled": true
}
```

---

## 8. Condition Evaluation (Simple Key-Value)

The rule evaluator checks conditions using exact key-value matching against the event payload. All keys in the condition object must match corresponding fields in the payload for the rule to fire.

| Condition | Example | Meaning |
| :--- | :--- | :--- |
| Empty `{}` | `{}` | Match all events of this type |
| Single key | `{ "stage_tag": "requires_approval" }` | Only events where payload contains this key-value |
| Multiple keys | `{ "pipeline_id": "uuid", "stage_tag": "review" }` | All keys must match (AND logic) |

Conditions reference only fields present in the event payload. See Event Types table (Section 3) for available fields per event type.

---

## 9. Failure Modes & Edge Cases

*   **No Matching Rules**: Event fires, no active rules match → event marked as processed, no notifications sent. This is expected and not an error.
*   **Channel Partial Failure**: Email fails, mobile push succeeds → `channels_sent` records `['push_mobile']`. Other channels are unaffected.
*   **Stale Push Token**: Expo or VAPID subscription returns 400/410 → subscription deleted from `push_subscriptions`. Next app open re-registers a fresh token.
*   **User Has No Push Subscription**: User never opened web version → no web push entry exists. Skipped silently — not an error.
*   **All Channels Disabled**: Preferences show all channels off → notification still written to `notifications` table (Realtime surfaces it in-app), but no external dispatch fires.
*   **Recipient Deduplication**: User matches both `assignee` and `watchers` strategies → receives exactly one notification, not two.
*   **Realtime Missed Event**: Client reconnects after disconnect → context re-fetches recent unread notifications to catch any Realtime events missed during downtime.
*   **Duplicate Registration**: Same device registers twice (token refresh) → `UPSERT ON CONFLICT (user_id, device_id)` updates token in place.
*   **Unauthorized Rule Mutation**: User without `manage_notifications` attempts INSERT on `notification_rules` → RLS returns 403 before reaching application code.
*   **Condition Field Not in Payload**: Rule condition references a field the event doesn't include → condition fails to match (safe default: no notification). Rule author must verify field names against Section 3.
*   **Service Worker Not Ready**: Web push subscription attempted before SW registers → deferred via `navigator.serviceWorker.ready` promise, retried on resolution.
*   **Electron (Future)**: When Electron wrapper ships, it exposes `window.__ELECTRON_NOTIFY__` via `contextBridge`. `NotificationContext` checks for its presence and routes to it. Zero engine or schema changes required.
