# Feature Contract: Bunker-Grade Unified Timer System

## 1. The Context Ledger
*   **Performance Isolation**: The timer must NOT trigger app-wide re-renders. High-frequency (1s) updates must be contained within atomic components using a singleton event emitter.
*   **NTP Clock Sync**: Client-side durations must be calculated using a server-side offset to prevent local system clock manipulation from affecting work logs.
*   **Crash Resiliency**: "Pending" sessions (intents to start work) must be mirrored to `AsyncStorage` immediately to ensure they can be recovered if the app crashes before the network commit completes.
*   **Multi-Device Synchronization**: The system must handle users having the app open on multiple devices simultaneously. Heartbeats from one device must not corrupt the state of another.
*   **Atomic Session Finalization**: If a user closes the app/tab immediately after starting work, the `rpc_stop_work` call must be able to "create-on-demand" the session record to ensure work is logged even if the `start` RPC was still in the commit buffer.
*   **UI/UX States**: The system must explicitly expose `isCommitting` to show "Saving..." or "Syncing..." indicators in the UI.
*   **Ghost Heartbeat Prevention**: Heartbeats must be rejected if the user is no longer a member of the task or if the session ID has been superseded.
*   **Singleton Tick Event**: The context will emit a `timer:tick` event every 1s. UI components will subscribe to this to update their display labels locally.

## 2. Feature Matrix
*   **FM-1: Calibration Engine**: Implement 4-point NTP handshake on app initialization.
*   **FM-2: Intent Mirroring**: Real-time persistence of `pendingSession` to local storage.
*   **FM-3: Recovery Daemon**: On-boot logic to flush orphaned local intents to the database.
*   **FM-4: Singleton Tick Emitter**: `DeviceEventEmitter` pulse (1s) to drive all `TimerDisplay` instances.
*   **FM-5: Multi-Device Guard**: Mandatory `session_id` validation on all heartbeat pulses.
*   **FM-6: Idempotent Stop**: Server-side logic for "Stop-and-Create" session records.
*   **FM-7: Atomic UI Components**: Creation of `<TimerDisplay />` and refactor of `<TimerIsland />`.

## 3. Global Utilities Mandate
*   `useAuth`: Scoping all sessions to `auth.uid()`.
*   `AsyncStorage`: Local persistence layer for intent mirroring.
*   `DeviceEventEmitter`: Cross-component signal for the singleton tick.

## 4. Database Schema (Supabase)

### Table: `task_work_sessions`
| Column | Type | RLS / Constraint |
| :--- | :--- | :--- |
| `id` | uuid (PK) | Default: `gen_random_uuid()` |
| `user_id` | uuid (FK) | `user_id == auth.uid()` |
| `task_id` | uuid (FK) | Must exist in `task_participants` |
| `started_at` | timestamptz | Not Null |
| `last_heartbeat_at` | timestamptz | Default: `now()` |
| `status` | text | Check: `status IN ('active', 'completed')` |

## 5. Data Payloads (Strict)

### Start Work Payload (RPC: `rpc_start_work`)
```json
{
  "p_task_id": "UUID",
  "p_start_time": "ISO8601_TIMESTAMP"
}
```

### Heartbeat Payload (RPC: `rpc_heartbeat_work`)
```json
{
  "p_session_id": "UUID"
}
```

### Stop Work Payload (RPC: `rpc_stop_work`)
```json
{
  "p_session_id": "UUID",
  "p_task_id": "UUID",
  "p_stopped_at": "ISO8601_TIMESTAMP"
}
```

### Server Time Handshake (RPC: `get_server_time`)
```json
{
  "return_value": "ISO8601_TIMESTAMP"
}
```

## 6. Failure Modes & Edge Cases
*   **Offline During Start**: Intent is saved to `AsyncStorage`. Recovery Daemon handles sync on reconnect.
*   **Clock Tampering**: If `Date.now()` jumps, the pre-calculated `serverTimeOffset` remains stable, preventing duration jitter.
*   **Heartbeat Conflict**: If `p_session_id` is inactive/replaced, RPC returns 409 Conflict. Frontend immediately clears its local `activeSession`.
*   **Missing Task Permissions**: Heartbeat returns 403. Frontend force-stops the timer.
*   **Tab Close (15s Buffer)**: `beforeunload` event (web) triggers `rpc_stop_work` via beacon. Server creates record if missing.
*   **Mobile Backgrounding**: AppState listener records `lastActivityTime`. Auto-stop triggers after idle threshold if no further foreground activity occurs.
