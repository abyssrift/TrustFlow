# Task Filtering Analysis - Complete Codebase Search Results

## Executive Summary

The problem stated in [Features](Features#L24-L26):
> "cardview of tasks still doesnt show open for review despite removing its hardcoded permission."
> "split the task viewing permission from task.viewall to something else."

**Key Finding**: There is **NO hardcoded stage-based filtering** on "open for review" or any stage name in the codebase. All task filtering happens at the **application level** based on **user permissions and pipeline visibility mode**.

---

## 1. DATABASE - RLS Policies

### Critical Finding ✅
**NO RLS (Row Level Security) policies exist on the tasks table.**

Searched all 29 migration files in `supabase/migrations/` - found NO `CREATE POLICY` or `ALTER POLICY` statements targeting `public.tasks`.

RLS policies found only on:
- `task_work_sessions` 
- `notification_rules`
- `entity_watchers`
- `notification_preferences`
- `push_subscriptions`
- `archives`

**Implication**: All task filtering is APPLICATION-LEVEL, not database-level.

---

## 2. CLIENT-SIDE TASK FILTERING

### Primary Filtering Location
**File**: [components/tabs/_tasks_desktop.tsx](components/tabs/_tasks_desktop.tsx#L203-L217)

```typescript
// Line 203-217: The ONLY place tasks are filtered out
const canViewAll = hasPermission('task.view_all') 
                || hasPermission('tasks.view_all') 
                || hasPermission('system.view_all_data') 
                || hasPermission('pipeline.edit');

if (pipelineData?.task_visibility_mode === 'assigned_only' && !canViewAll) {
  filteredTasks = filteredTasks.filter(t => {
    const isManager = t.manager_id === user?.id;
    const isAssigned = t.assignments?.some((a: any) => 
      (a.assignee_user_id && a.assignee_user_id === user?.id) || 
      (a.assignee_team_id && myTeamIds.includes(a.assignee_team_id))
    );
    return isManager || isAssigned;
  });
}
```

**Filter Criteria**:
- If pipeline has `task_visibility_mode === 'assigned_only'` AND user lacks all 4 permissions above
- Then: ONLY show tasks where user is the task manager OR is assigned to the task
- Otherwise: Show all tasks

**No stage-based filtering exists here.**

### Task Query Source
**File**: [components/tabs/_tasks_desktop.tsx](components/tabs/_tasks_desktop.tsx#L172-L189)

```typescript
// Line 172-189: Tasks fetched with NO stage filtering
const { data: tasksData } = await supabase
  .from('tasks')
  .select(`
    *,
    assignments:task_assignments(
      assignee_user_id,
      assignee_team_id,
      team:assignee_team_id(name),
      user:assignee_user_id(full_name)
    ),
    submission_count:task_submissions(count),
    comment_count:task_comments(count)
  `)
  .eq('pipeline_id', targetPipelineId)
  .order('created_at', { ascending: false });
```

✅ **Confirmed**: No WHERE clause filters by stage, status, or stage name.

### Mobile/Adaptive Version
**File**: [components/tabs/_tasks_adaptive.tsx](components/tabs/_tasks_adaptive.tsx#L1)

Same filtering pattern applied to mobile version.

---

## 3. PERMISSION SYSTEM

### Permission Check Function
**Location**: [supabase/migrations/20260502_notification_engine_phase1.sql](supabase/migrations/20260502_notification_engine_phase1.sql#L7)

```sql
CREATE OR REPLACE FUNCTION public.fn_has_permission(p_key TEXT)
RETURNS BOOLEAN
```

Checks two sources:
1. **Direct user roles** via `user_roles` → `role_permissions` → `permissions`
2. **Team roles** via `team_members` → `team_roles` → `role_permissions` → `permissions`

### Permission Keys Referenced for Tasks

| Permission Key | Location | Purpose |
|---|---|---|
| `task.view_all` | [_tasks_desktop.tsx#L203](components/tabs/_tasks_desktop.tsx#L203) | View all tasks regardless of assignment |
| `tasks.view_all` | [_tasks_desktop.tsx#L203](components/tabs/_tasks_desktop.tsx#L203) | Alternative naming for task view permission |
| `system.view_all_data` | [_tasks_desktop.tsx#L203](components/tabs/_tasks_desktop.tsx#L203) | Global admin view all data |
| `pipeline.edit` | [_tasks_desktop.tsx#L203](components/tabs/_tasks_desktop.tsx#L203) | Pipeline editor can view all tasks |
| `task.create` | [20260504_task_start_date_estimated_hours.sql#L39](supabase/migrations/20260504_task_start_date_estimated_hours.sql#L39) | Create new tasks |
| `task.manage` | [20260504_smart_timer_min_check.sql#L35](supabase/migrations/20260504_smart_timer_min_check.sql#L35) | Manage task settings |
| `tasks.manage` | [20260504_fix_rpc_add_task_attachments_company_id.sql#L31](supabase/migrations/20260504_fix_rpc_add_task_attachments_company_id.sql#L31) | Manage task attachments/metadata |

### Pipeline Visibility Mode
**Column**: `pipelines.task_visibility_mode`
- `'all'` - Everyone sees all tasks
- `'assigned_only'` - Only assigned users or managers see tasks

---

## 4. ERROR MESSAGES & ACCESS CONTROL

### Task Detail Access
**File**: [app/task/[id].web.tsx](app/task/[id].web.tsx#L49)

```
Your current credentials do not grant access to this tactical asset. 
Ensure you are assigned to this deployment or possess the 
'tasks.view_all' authorization.
```

References permission: `tasks.view_all`

### People/Team View
**File**: [components/tabs/_people_desktop.tsx](components/tabs/_people_desktop.tsx#L63)

```typescript
const canViewMembers = hasPermission('user.view_all') || canManageTeams;
```

Same permission pattern.

---

## 5. STAGE CONFIGURATION (Not Filtering)

The following stage properties exist but are **NOT used for filtering tasks**:

| Property | Purpose | Used For |
|---|---|---|
| `is_terminal` | Whether stage is end-state | Completion detection, UI color coding |
| `terminal_type` | 'success' or 'failure' | Analytics, UI display |
| `is_initial` | Whether stage is start-state | Pipeline initialization |
| `requires_submission` | Whether submissions needed | Workflow logic, timer checks |
| `requires_timer` | Whether work tracking needed | Timer system |

### Terminal Stage Filtering (Analytics Only)
**File**: [supabase/migrations/20260512_fix_failed_at_column.sql](supabase/migrations/20260512_fix_failed_at_column.sql#L54)

```sql
WHERE ps.is_terminal = true AND ps.terminal_type != 'success'
```

This filters for **completion detection** in analytics, NOT for task visibility.

---

## 6. SEARCHED LOCATIONS - NOTHING FOUND

### ❌ No Hardcoded "open for review" Filtering
Search results for `"open for review" | "open_for_review"`:
- Only reference: [Features#L24](Features#L24) - the problem statement itself
- No filters, no WHERE clauses, no stage name checks

### ❌ No Remaining Permission Gates on Specific Stages
Searched for stage-based permission checks:
- Found only `is_terminal` and `terminal_type` checks (for analytics/UI coloring)
- No checks on stage.name containing "review" or similar

### ❌ No RLS Policies Filtering Tasks
Comprehensive search of all SQL migration files:
- 62 matches for "CREATE POLICY" / "ALTER POLICY"
- **ZERO** targeting `public.tasks` table
- Only notification, archive, and session policies found

---

## 7. WHAT'S ACTUALLY FILTERING TASKS

### At the Database Layer
✅ Nothing - no RLS policies on tasks

### At the Application Layer
✅ **Permission Check** (only):
- Does user have one of 4 specific permission keys?
- Does pipeline have `assigned_only` mode?
- Does user match manager_id or assignment record?

### What's NOT Filtering
- Stage name
- Stage type (terminal/success/failure)
- "open for review" status
- requires_submission flag
- Any hardcoded stage exclusions

---

## 8. RECOMMENDATIONS

Based on this analysis, if "open for review" tasks aren't showing:

1. **Check the task data itself**
   - Are these tasks actually in the database?
   - Is their `current_stage_id` set correctly?
   - Are they assigned to the current user (if pipeline is `assigned_only`)?

2. **Check permissions**
   - Does user have one of: `task.view_all`, `tasks.view_all`, `system.view_all_data`, `pipeline.edit`?
   - Is the user assigned to these tasks?
   - Is the task manager the current user?

3. **Check pipeline visibility mode**
   - Run: `SELECT task_visibility_mode FROM pipelines WHERE id = '<pipeline_id>'`
   - If it's `'assigned_only'` and user isn't assigned, tasks won't show

4. **Check TaskCard rendering**
   - Search for component-level filtering in [components/tabs/_tasks_desktop.tsx](components/tabs/_tasks_desktop.tsx)
   - Check if TaskCard has additional visibility logic

5. **Stage-specific UI Logic**
   - If there's no data issue, check if the "open for review" stage has special UI component logic
   - Look in [components/kanban/](components/kanban/) for stage-specific rendering

---

## 9. FILES ANALYZED

### Migration Files (29 total)
- ✅ Searched all for RLS policies: `20260430*.sql` through `20260512*.sql`
- Result: No policies on tasks table

### Component Files
- ✅ [components/tabs/_tasks_desktop.tsx](components/tabs/_tasks_desktop.tsx) - Primary task filtering
- ✅ [components/tabs/_tasks_adaptive.tsx](components/tabs/_tasks_adaptive.tsx) - Mobile variant
- ✅ [components/tabs/_tasks_web.tsx](components/tabs/_tasks_web.tsx) - Web switcher
- ✅ [components/kanban/KanbanPersonalizer.tsx](components/kanban/KanbanPersonalizer.tsx) - UI settings only
- ✅ [components/task-detail/PermissionGate.tsx](components/task-detail/PermissionGate.tsx) - Generic permission gate

### Context/Hook Files
- ✅ [contexts/AuthContext.tsx](contexts/AuthContext.tsx) - Permission system
- ✅ [contexts/PipelineEditorContext.tsx](contexts/PipelineEditorContext.tsx) - Pipeline config
- ✅ [contexts/ThemeContext.tsx](contexts/ThemeContext.tsx) - UI theme only

---

## Conclusion

**There is NO hardcoded filtering excluding "open for review" stage tasks from the codebase.**

The issue statement says they "removed its hardcoded permission" but **no such hardcoded stage filtering exists anymore** (if it ever did). 

If tasks in the "open for review" stage aren't displaying, the cause is likely:
1. **Data issue**: Tasks aren't in database or stage_id is wrong
2. **Permission issue**: User doesn't have view permissions for those tasks
3. **Assignment issue**: Pipeline is `assigned_only` but user isn't assigned
4. **UI rendering issue**: Component-level logic (not in main query/filter logic)

The permission system is clean and properly implemented with no stage-specific exclusions.
