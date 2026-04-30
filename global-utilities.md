# Global Utilities & Shared Logic Registry
Before writing new utility functions, hooks, or database RPCs, check this registry. If a tool exists here, you MUST use it in your implementation to prevent code duplication.

## Frontend Hooks (`/hooks`, `/contexts`, `/components`)
* **useAuth**: Returns current session, user profile, permissions, and role IDs. Provides `hasPermission`, `hasRole`, `signOut`, and `refreshProfile`. (Context: `contexts/AuthContext.tsx`)
* **useTheme**: Manages global UI theme (colors), density, roundness, and Kanban-specific settings. (Context: `contexts/ThemeContext.tsx`)
* **useTimer**: Controls work sessions (`startWork`, `stopWork`, `passiveStart`). Manages the active session state. (Context: `contexts/TimerContext.tsx`)
* **useAlert**: Provides `showAlert` and `showConfirm` for consistent premium dialogs. (Context: `contexts/AlertContext.tsx`)
* **useRoleManager**: Management interface for users, teams, roles, and permissions CRUD. (Context: `contexts/RoleManagerContext.tsx`)
* **useElapsedTime**: Returns a live-updating string (HH:MM:SS) for a given start timestamp. (Hook: `hooks/useElapsedTime.ts`)
* **useSmartTimer**: Logic for idle detection, max session cutoffs, and server heartbeats. (Hook: `hooks/useSmartTimer.ts`)
* **useColorScheme**: Current color scheme (dark/light) from React Native. (Hook: `components/useColorScheme.ts`)
* **useClientOnlyValue**: Returns a value only on the client side, useful for web/native compatibility. (Hook: `components/useClientOnlyValue.ts`)

## Frontend Utilities (`/lib`)
* **getErrorMessage**: Maps Supabase Auth errors to user-friendly messages. (File: `lib/auth-errors.ts`)
* **isValidEmail**: Validates basic email format using regex. (File: `lib/auth-errors.ts`)
* **isStrongPassword**: Validates password strength (minimum 8 characters). (File: `lib/auth-errors.ts`)
* **getThemeColor**: Returns a semantic color string based on the active theme. (File: `lib/themeColors.ts`)
* **getPrimaryColor, getSecondaryColor, getAccentColor, getMutedColor, getSuccessColor, getWarningColor, getDangerColor, getInfoColor, getBorderColor, getOverlayColor**: Specific semantic color retrievers for the active theme. (File: `lib/themeColors.ts`)
* **supabase**: The shared Supabase client instance for all database interactions. (File: `lib/supabase.ts`)

## Global UI Components (`/components/common`, `/components`)
* **GlobalAlertOverlay**: The underlying modal component for the Alert system.
* **HorizontalScroll**: ScrollView wrapper with mouse-wheel support for horizontal boards on web.
* **PremiumCalendarPicker**: A themed, interactive calendar picker.
* **ExternalLink**: A component that opens links in an in-app browser on native or a new tab on web. (File: `components/ExternalLink.tsx`)
* **Text / View**: Theme-aware base components that automatically resolve colors. (File: `components/Themed.tsx`)
* **MonoText**: Themed text component pre-configured with a monospace font. (File: `components/StyledText.tsx`)

## Supabase Database (RPCs & Edge Functions)
* **get_my_permissions**: Fetches the current user's permission keys.
* **get_my_roles**: Fetches the current user's assigned role UUIDs.
* **rpc_repair_profile**: Ensures a user has a valid profile record.
* **get_server_time**: Returns the current server timestamp for NTP synchronization.
* **rpc_start_work(p_task_id, p_start_time)**: Initiates an active work session for a task (includes backdating protection).
* **rpc_heartbeat_work(p_session_id)**: Pulses the server (includes mandatory membership check).
* **rpc_stop_work(p_session_id, p_task_id, p_stopped_at, [optional] p_started_at)**: Completes a session (with participant validation and crash recovery).
* **rpc_create_role(p_name, p_description, p_color, p_permissions)**: Creates a new role.
* **rpc_update_role(p_role_id, ...)**: Updates role metadata and permissions.
* **rpc_assign_user_roles(p_user_id, p_role_ids)**: Syncs role assignments for a user.
* **rpc_assign_user_teams(p_user_id, p_team_ids)**: Syncs team memberships for a user.
* **rpc_assign_team_roles(p_team_id, p_role_ids)**: Syncs role assignments for a team.
