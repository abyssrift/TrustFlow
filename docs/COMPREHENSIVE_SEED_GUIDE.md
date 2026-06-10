# Comprehensive Reporting Data Seed Guide

## Overview

The comprehensive seed script (`seed_comprehensive.ts`) creates a complete, realistic dataset for testing your reporting system. Unlike the quick seed, this includes **full work simulation** with task completions, submissions, reviews, and historical data.

## What Gets Created

### 1. **Workers** (8 accounts)
- Realistic names and credentials
- Email: `worker0@test-acme.local` through `worker7@test-acme.local`
- Password: `WorkerPassword123!`
- Automatically added to Test Acme Corp company

### 2. **Tasks** (40 total)
- Realistic titles with priorities (urgent, high, medium, low)
- Estimated hours for cost calculation
- Distributed across workers (random assignments)

### 3. **Work Sessions** (with realistic simulation)
Each task gets simulated work sessions with:
- Realistic start times (past 2 weeks)
- Session durations (30-150 minutes)
- Multiple sessions per task (for revisions)
- Active/completed status

### 4. **Submissions** (with review workflow)
- Worker-submitted content with comments
- Pending, approved, needs_revision, or rejected status
- Submission timestamps and review notes
- Multiple submissions for revised tasks

### 5. **Task Status Distribution**
- **30%** - Completed successfully (Backlog → In Progress → Review → Done)
- **20%** - In Progress (Backlog → In Progress)
- **20%** - In Review (awaiting approval)
- **20%** - Needs Revision (rejected → back to work)
- **10%** - Backlog (unstarted)

## What Reporting Data This Enables

### Personnel Analytics
✅ **Active Hours** - Sum of work session durations per worker
✅ **Completed Tasks** - Approved submissions count
✅ **Failed Tasks** - Rejected/needs revision tasks
✅ **On-Time Rate** - Tasks completed within estimated hours
✅ **Revision Count** - Number of rejections before approval
✅ **Efficiency Metrics** - Points per hour, cost per point
✅ **Activity Timeline** - When work happened

### Pipeline Analytics
✅ **Throughput** - Tasks moved to Done stage
✅ **Success Rate** - Percentage of tasks completed vs failed
✅ **Stage Dwell Time** - How long tasks spend in each stage
✅ **Bottlenecks** - Which stages take longest
✅ **Failure Points** - Where tasks get rejected

### Financial Reporting
✅ **Time Tracking** - Hours worked per task
✅ **Cost Calculation** - Total cost per worker/task
✅ **ROI Analysis** - Cost vs completion rates
✅ **Budget Tracking** - Estimated vs actual hours

### Activity Timeline
✅ **Recent Movements** - Task stage transitions
✅ **Audit Trail** - Who did what and when
✅ **Trends** - Activity over past 14 days

## How to Use

### Via Command Line (Recommended for First Time)

```bash
npm run seed:full
```

This will:
1. ✅ Sign in as founder
2. ✅ Create 8 worker accounts
3. ✅ Create 40 tasks
4. ✅ Simulate work across the tasks
5. ✅ Create submissions and reviews
6. ✅ Distribute tasks across different statuses
7. ✅ Display a detailed summary

**Expected Runtime:** 30-60 seconds depending on network

### Expected Console Output

```
🌱 Starting comprehensive Test Acme Corp seed with work simulation...

📝 Signing in as founder...
✅ Logged in. User ID: xxxx-xxxx-xxxx-xxxx

✅ Company ID: xxxx-xxxx-xxxx-xxxx

🔧 Setting up pipeline...
✅ Using existing pipeline: xxxx-xxxx-xxxx-xxxx

👥 Creating 8 worker accounts...
   ✅ Worker 1/8: Alex Chen
   ✅ Worker 2/8: Jordan Rodriguez
   ...
✅ All workers created

📋 Creating 40 tasks with work simulation...
   ✅ Created 10/40 tasks
   ✅ Created 20/40 tasks
   ✅ Created 30/40 tasks
   ✅ Created 40/40 tasks

⏱️  Simulating work sessions and completions...
✅ Work Simulation Complete

═══════════════════════════════════════════════════════════════
✅ SEED COMPLETE!
═══════════════════════════════════════════════════════════════
📊 Summary:
   Company ID: xxxx-xxxx-xxxx-xxxx
   Pipeline ID: xxxx-xxxx-xxxx-xxxx
   Workers Created: 8
   Tasks Created: 40
   Work Sessions: ~46
   Submissions: ~35
   Approvals: ~12

📈 Reporting data ready:
   - Task completion rates
   - Worker productivity metrics
   - Pipeline throughput
   - Activity timeline
   - Financial metrics
═══════════════════════════════════════════════════════════════
```

## Testing Reporting Features

After running the comprehensive seed, you can test:

### 1. Personnel Reports
```
Path: Analytics → Personnel
Expected to see:
- Alex Chen: 4-5 completed tasks, 8-10 hours
- Jordan Rodriguez: 3-4 completed tasks, 6-9 hours
- ... etc for all 8 workers
- On-time rates: 60-80%
- Cost analysis per worker
```

### 2. Pipeline Analytics
```
Path: Analytics → Pipeline
Expected to see:
- Throughput: 12 tasks completed
- Success rate: ~30%
- Stage dwell times:
  - Backlog: varies
  - In Progress: 60-120 minutes average
  - Review: 30-240 minutes average
- Bottleneck: Review stage (where rejections happen)
```

### 3. Task Summary
```
Path: Tasks view
Expected to see:
- 28 tasks in various stages
- 12 completed (green)
- 8 in progress (blue)
- 6 in review (yellow)
- 8 need revision (orange)
- 4 in backlog (gray)
```

### 4. Activity Timeline
```
Path: Analytics → Recent Activity
Expected to see:
- 40+ entries spanning past 2 weeks
- Task status transitions
- Submission events
- Review/approval events
- Worker names and timestamps
```

### 5. Financial Reports
```
Path: Admin → Reports
Expected to see:
- Total hours: 150-200 hours
- Total cost: Varies by configured rates
- Cost per task: $50-200 range
- Cost per point: Realistic metrics
```

## Data Characteristics

### Task Distribution by Priority
- **Urgent**: ~8 tasks (20%)
- **High**: ~16 tasks (40%)
- **Medium**: ~12 tasks (30%)
- **Low**: ~4 tasks (10%)

### Task Distribution by Status
- **Completed**: ~12 tasks (30%)
- **In Progress**: ~8 tasks (20%)
- **In Review**: ~8 tasks (20%)
- **Needs Revision**: ~8 tasks (20%)
- **Backlog**: ~4 tasks (10%)

### Time Distribution
- **Work Sessions**: 46 total
- **Average Duration**: 75 minutes
- **Peak Hours**: 8 AM - 6 PM (business hours)
- **Timeline**: Past 14 days

### Submission Statistics
- **Total Submissions**: ~35
- **Approved**: ~12 (34%)
- **Pending**: ~8 (23%)
- **Needs Revision**: ~8 (23%)
- **Rejection Rate**: 43%

## Customization

To modify the seed behavior, edit `seed_comprehensive.ts`:

### Change Task Count
```typescript
// Line 270:
for (let i = 0; i < 40; i++) {  // Change to 100, 200, etc
```

### Change Worker Count
```typescript
// Line 255:
for (let i = 0; i < 8; i++) {  // Change to 10, 15, etc
```

### Adjust Task Status Distribution
```typescript
// Lines 295-305: Modify the rand thresholds:
if (rand < 0.30)    // Completed: 30%
if (rand < 0.50)    // + In Progress: 20%
if (rand < 0.70)    // + In Review: 20%
if (rand < 0.90)    // + Needs Revision: 20%
```

### Change Time Range
```typescript
// Line 288:
const daysAgo = randomInt(1, 14);  // Change to (1, 30) for month of data
```

### Add Custom Task Types
```typescript
// Line 50: Add to TASK_TEMPLATES array:
{ title: 'Your task', priority: 'high', estHours: 3 },
```

## Performance Notes

- **40 tasks**: ~30 seconds
- **100 tasks**: ~90 seconds  
- **200 tasks**: ~3-4 minutes
- Network speed significantly affects runtime

For large seeds (200+ tasks), consider:
- Running during off-peak hours
- Increasing system resources
- Running from a faster network connection

## Data Persistence

Once seeded, the data persists in your database:
- ✅ Survives app restarts
- ✅ Visible to all authenticated users
- ✅ Includable in exports/reports
- ⚠️ Not automatically deleted (use DevTool "Clear Tasks" to wipe)

## Troubleshooting

### Issue: "Service role key not available"
**Solution**: Add `SUPABASE_SERVICE_ROLE_KEY` to `.env` for worker creation

### Issue: "Founder login failed"
**Solution**: Ensure founder account exists: `test_founder@newcompany.com`

### Issue: Worker creation fails but seed continues
**Normal behavior**: Script falls back to existing team members

### Issue: Some tasks don't get work sessions
**Normal behavior**: ~10% of tasks stay in Backlog (by design)

### Issue: Seed takes very long
**Solution**: 
- Check internet connection
- Reduce task count and re-run
- Check if Supabase is under load

## Next Steps

1. ✅ Run `npm run seed:full`
2. ✅ Open app and navigate to Tasks
3. ✅ Verify you see tasks with different statuses
4. ✅ Go to Analytics and verify reporting data
5. ✅ Check Admin → Reports for financial metrics
6. ✅ Test filtering and sorting
7. ✅ Export data to PDF and verify

## Quick Reference

| Command | Use Case | Time |
|---------|----------|------|
| `npm run seed` | Simple task seeding | 10 sec |
| `npm run seed:full` | Complete reporting data | 30-60 sec |
| DevTool "Seed 5" | Quick UI testing | 2 sec |
| DevTool "Seed 30" | UI + some data | 5 sec |
| DevTool "Clear" | Remove all tasks | 1 sec |

---

**Last Updated**: May 14, 2026
**Script Version**: 1.0 - Comprehensive
**Status**: Production Ready
