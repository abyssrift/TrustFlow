# Analytics Engine — UI Connection Document

Everything the frontend needs to wire up, in order of priority.
Every RPC, every form field, every edge case that requires a UI decision.

---

## 1. New Permissions (must be assignable via Role Manager)

Two new permission keys exist in the `permissions` table. The Role Manager UI
already supports assigning arbitrary permissions to roles — these just need to
appear in the list automatically since they are in the DB:

| Key                 | Label                             | Who should have it          |
|---------------------|-----------------------------------|-----------------------------|
| `analytics.view`    | View Analytics Dashboard          | Managers, Leads, Admins     |
| `analytics.compare` | Compare Personnel Performance     | Admins, Company Leads only  |

**No UI change needed** — the Role Manager fetches all permissions from the DB.
These will appear automatically. Just verify they show up under a new
"Analytics" category group.

---

## 2. Personal Analytics Screen (`app/(tabs)/analytics.tsx`)

### Route & Tab
- Add a new tab entry to `app/(tabs)/_layout.tsx` (and `.web.tsx`)
- Icon suggestion: `BarChart2` or `TrendingUp` from lucide
- Visible to all authenticated users (everyone can see their own metrics)

### AnalyticsContext call
```ts
const series = await analytics.getUserPerformanceSeries(userId, period, 12);
// → rpc_get_user_performance_series(p_user_id, p_period_type, p_n_periods)
// Returns 12 rows, oldest → newest (reverse the array for charting newest-first)
```

### UI Components Required

#### A. Period Toggle
- Three buttons: **Week** / **Month** / **Year**
- Controls `p_period_type` passed to `getUserPerformanceSeries`
- Default: `month`
- When toggled: invalidate cache for this user's series and re-fetch

#### B. Weight Points Chart (bar chart, primary metric)
- X axis: `period_label` (e.g. "Apr 2026", "W18 2026")
- Y axis: `weight_points`
- Highlight the bar where `is_current_period = true` with a different color
- Show a tooltip on bar tap/hover: "340 pts · 12 tasks completed"

#### C. Active Hours Chart (bar chart)
- Same X axis as above
- Y axis: `active_seconds / 3600` → display as hours with 1 decimal
- Tooltip: "23.4 hrs logged"

#### D. Timer Efficiency Indicator
- Compute: `(active_seconds / estimated_seconds) * 100`
- Only show if `estimated_seconds > 0` (some tasks may have no estimate)
- Display as a percentage with a color band:
  - `< 80%`: green (finishing faster than estimated)
  - `80–120%`: yellow (on track)
  - `> 120%`: red (over budget)
- Label: "Timer Efficiency — you used X% of your estimated time"

#### E. Stats Row (4 cards)
Derived from the current/selected period's row:
| Card               | Value                                                |
|--------------------|------------------------------------------------------|
| Tasks Completed    | `completed_tasks`                                    |
| On-Time Rate       | `(on_time_tasks / (completed_tasks + failed_tasks)) * 100` % |
| Revision Rate      | `revision_count / completed_tasks` (avg revisions per task) |
| Tasks Failed       | `failed_tasks`                                       |

#### F. Summary Card (optional, for the selected range)
- A secondary "Custom Range" picker (date range input)
- Calls `rpc_get_user_performance_summary(userId, from, to)`
- Shows all the same stats but for the custom window
- Useful for "how did I do this quarter?"

---

## 3. Admin Analytics Screen (`app/admin/analytics.tsx`)

Gated by `analytics.view` permission. Split into two tabs:

### Tab 1 — Pipeline Analytics

#### Pipeline Selector
- Dropdown / list of all pipelines in the company
- On select: fetch stage dwell + throughput for that pipeline
- Default: first pipeline alphabetically

#### Date Range Picker
- From / To date inputs (default: last 30 days)
- Controls both `rpc_get_pipeline_stage_dwell` and `rpc_get_pipeline_throughput`

#### Stage Dwell Heatmap / Bar Chart
```ts
const dwell = await analytics.getPipelineStageDwell(pipelineId, from, to);
// → rpc_get_pipeline_stage_dwell(p_pipeline_id, p_from, p_to)
```
- Horizontal bar chart, one bar per stage, ordered by `stage_position`
- Bar length = `avg_seconds`
- Color coding:
  - `is_bottleneck = true` → red/amber bar
  - Terminal success stages → green tint
  - Terminal failure stages → red tint
- Tooltip: "Avg: 4h 20m · Median: 3h 15m · P75: 6h · N=38 samples"
- Show `reversal_count` as a small badge on each stage bar: "↩ 5 reversals"

#### Throughput Trend Chart
```ts
const throughput = await analytics.getPipelineThroughput(pipelineId, period, 12);
// → rpc_get_pipeline_throughput(p_pipeline_id, p_period_type, p_n_periods)
```
- Stacked or grouped bar chart per period:
  - Green segment: `tasks_succeeded`
  - Red segment: `tasks_failed`
- Line overlay: `success_rate` (right Y axis, 0–100%)

---

### Tab 2 — Personnel Comparison

Gated by `analytics.compare` permission (checked in addition to `analytics.view`).

#### User Multi-Select
- Searchable multi-select list of all company users
- Min 2, max ~20 users (reasonable comparison set)
- Shows user avatar + name

#### Date Range Picker
- From / To date inputs
- Same controls as pipeline tab, or independent

#### Salary Input (per-user, optional)
This is the most important form field for the benchmark feature.

```
For each selected user, show an optional input:
  [User Avatar] [Name]    Daily rate: [$] [______] /day    [Clear]
```

- Field type: numeric, positive only, up to 4 decimal places
- Label: "Daily Rate (USD)" — admin enters the employee's daily cost
- This value is passed as `p_salaries: { "<user_id>": <daily_rate> }`
- If left empty for a user, `daily_rate_usd`, `total_cost_usd`, and
  `cost_per_point` will be `null` in the response (handle gracefully)
- **Do not persist these values to the DB** — salary is sensitive and
  should only live in the component's local state for this session.
  If the admin navigates away and comes back, they re-enter the salaries.

#### Comparison Table
```ts
const comparison = await analytics.comparePersonnel(userIds, from, to, salaries);
// → rpc_compare_personnel(p_user_ids, p_from, p_to, p_salaries)
```

Columns:
| Column              | Source field           | Format                     |
|---------------------|------------------------|----------------------------|
| Name                | `full_name`            | Text + avatar              |
| Weight Points       | `weight_points`        | Number, bold               |
| Active Hours        | `active_hours`         | "23.4 hrs"                 |
| Timer Efficiency    | `timer_efficiency`     | "94.2%" or "—" if null     |
| Tasks Completed     | `completed_tasks`      | Number                     |
| On-Time Rate        | `on_time_rate`         | "83.3%" or "—" if null     |
| Revision Rate       | derived                | `revision_count / completed_tasks` |
| Daily Rate          | `daily_rate_usd`       | "$120.00" or "—" if null   |
| Total Cost          | `total_cost_usd`       | "$2,640.00" or "—" if null |
| Cost per Point      | `cost_per_point`       | "$7.76/pt" or "—" if null  |
| Points per Hour     | `points_per_hour`      | "14.5 pts/hr" or "—"       |

- Sortable by any column
- Highlight the best performer per metric (green badge) and worst (amber)
- "Export" button → triggers `rpc_queue_analytics_report` (see §6)

---

## 4. AnalyticsContext (`contexts/AnalyticsContext.tsx`)

### Cache Strategy
```ts
type CacheEntry = { data: unknown; fetchedAt: number; permanent: boolean };
const cache    = useRef<Map<string, CacheEntry>>(new Map());
const inFlight = useRef<Map<string, Promise<unknown>>>(new Map());

const CURRENT_TTL_MS = 5 * 60 * 1000;  // 5 min for current period

function cacheKey(type: string, ...parts: unknown[]) {
  return `${type}:${parts.join(':')}`;
}

async function fetchWithDedup<T>(
  key: string,
  fetcher: () => Promise<T>,
  permanent = false
): Promise<T> {
  const hit = cache.current.get(key);
  if (hit && (hit.permanent || Date.now() - hit.fetchedAt < CURRENT_TTL_MS)) {
    return hit.data as T;
  }
  if (inFlight.current.has(key)) return inFlight.current.get(key) as Promise<T>;

  const promise = fetcher().then(data => {
    cache.current.set(key, { data, fetchedAt: Date.now(), permanent });
    inFlight.current.delete(key);
    return data;
  }).catch(err => {
    inFlight.current.delete(key);
    throw err;
  });

  inFlight.current.set(key, promise);
  return promise;
}
```

### Exposed Methods
```ts
getUserPerformanceSeries(userId, periodType, nPeriods)
  // permanent=false (current period changes); past periods are DB-cached anyway

getUserPerformanceSummary(userId, from, to)
  // permanent=true if both from+to are in the past (closed window)

getPipelineStageDwell(pipelineId, from, to)
  // permanent=true if to < today

getPipelineThroughput(pipelineId, periodType, nPeriods)
  // same TTL strategy as user series

comparePersonnel(userIds, from, to, salaries)
  // never cache — salaries are session-local, always fresh

invalidate(keyPrefix?)
  // clears all cache entries matching prefix, or all if no prefix
  // call after archive event or period toggle
```

### Provider placement
Wrap only the analytics screens, not the entire app:
- `app/(tabs)/analytics.tsx` → wrap content in `<AnalyticsProvider>`
- `app/admin/analytics.tsx` → same

---

## 5. `rpc_get_personal_pulse` Bug (existing screen)

The existing `rpc_get_personal_pulse` function (used on the home dashboard) still
uses `created_by = v_user_id` instead of joining `task_assignments`. This gives
wrong weight point counts on the home screen.

**Fix needed**: update `rpc_get_personal_pulse` to use the same assignee-based
join as the new analytics RPCs. The fix is a one-line change in the function
body — replace the `created_by = v_user_id` filter with a JOIN on
`task_assignments`.

This is a separate task but should be done before the analytics screen ships,
otherwise users will see different numbers between the dashboard and analytics.

---

## 6. Reports Integration

The "Export" button on the comparison table and potentially on chart views should:

```ts
// In AnalyticsContext:
async function queueAnalyticsReport(type: string, parameters: object) {
  const { data, error } = await supabase.rpc('rpc_request_report', {
    p_report_type: type,
    p_parameters:  parameters
  });
  // rpc_request_report already exists and inserts into reporting_jobs
  return data;
}
```

Report types to support (new `report_type` values for `reporting_jobs`):
| Type                         | Parameters                                      |
|------------------------------|-------------------------------------------------|
| `analytics_user_performance` | `{ user_id, period_type, n_periods }`           |
| `analytics_pipeline_dwell`   | `{ pipeline_id, from, to }`                     |
| `analytics_personnel_compare`| `{ user_ids[], from, to, salaries? }`           |

The existing `fn_trigger_report_generation` trigger on `reporting_jobs` will
need handlers for these new types. That is Phase 6 work.

---

## 7. Customizable Fields Summary (for implementation checklist)

| Field                    | Screen          | Input Type        | Persisted? | Notes                          |
|--------------------------|-----------------|-------------------|------------|--------------------------------|
| Period type              | Personal        | Toggle (3 opts)   | No         | Session state                  |
| Custom date range        | Personal        | Date range picker | No         | For summary card only          |
| Pipeline selector        | Admin – Pipe    | Dropdown          | No         | Session state                  |
| Date range               | Admin – Pipe    | Date range picker | No         | Session state                  |
| Period type              | Admin – Pipe    | Toggle (3 opts)   | No         | For throughput chart           |
| User multi-select        | Admin – Compare | Multi-select      | No         | Session state                  |
| Date range               | Admin – Compare | Date range picker | No         | Session state                  |
| Daily rate per user      | Admin – Compare | Numeric input     | **NO**     | Salary — session only, no DB   |
| Export format preference | Both            | Dropdown (future) | Maybe      | PDF/CSV — deferred to Phase 6  |

---

## 8. Edge Cases to Handle in UI

1. **No data for a period** — series returns the row with all zeros. Show an
   empty state bar (grayed out) rather than hiding the bar entirely. This
   preserves the time axis context.

2. **estimated_seconds = 0** — `timer_efficiency` will be `null`. Show "—"
   or "No estimate set" rather than 0% or infinity.

3. **New user with no history** — all series rows will be zero. Show an
   onboarding-style empty state: "Complete your first task to see analytics."

4. **Pipeline with no transitions in range** — `rpc_get_pipeline_stage_dwell`
   returns all stages with `sample_count = 0` and `avg_seconds = 0`. Show
   "No activity in this period" overlay on the chart.

5. **Salary entered then cleared** — treat empty salary input as `null`,
   not `0`. Passing `0` would make `cost_per_point` = 0 which is misleading.

6. **User has analytics.view but not analytics.compare** — the Personnel
   Comparison tab should either not appear or show a locked state. Check
   `has_permission('analytics.compare')` on mount.

7. **Large n_periods with slow connection** — the series RPC lazy-flushes
   missing periods synchronously. For a first-time load with 12 missing months,
   this could take a few seconds. Show a skeleton loader, not a spinner, so
   the layout doesn't jump.
