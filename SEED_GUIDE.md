# Test Acme Corp Seeding Guide

This guide explains how to seed Test Acme Corp with more data for testing reporting features.

## Overview

The seeding system provides multiple ways to populate Test Acme Corp with realistic data:

1. **DevTool Component** (In-app UI buttons)
   - Quick seed: 5 tasks
   - Comprehensive seed: 30 tasks with assignments

2. **Command Line Script** (Full automated seeding)
   - Creates workers
   - Creates 50+ tasks
   - Creates assignments and submissions

## Method 1: Using DevTool Component (Easiest)

The DevTool component appears at the top of the Tasks screen when running in development mode.

### Quick Seed (5 Tasks)
Click **"Seed 5 Tasks"** button to quickly add 5 random tasks to the current pipeline.

### Comprehensive Seed (30 Tasks)
Click **"Seed 30 Tasks"** button to:
- Create 30 diverse tasks with realistic titles and descriptions
- Randomly assign tasks to existing team members (70% assignment rate)
- Vary task priorities (urgent, high, medium, low)

### Clear All Tasks
Click **"Clear Tasks"** to remove all tasks from the current pipeline (careful - this is destructive).

## Method 2: Using Command Line Script (Most Complete)

For comprehensive seeding including worker creation, use the dedicated seed script.

### Prerequisites

1. Ensure your `.env` file has these variables:
```env
EXPO_PUBLIC_SUPABASE_URL=your_project_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_key  # Optional but recommended
```

2. Install `tsx` if not already available:
```bash
npm install -D tsx
```

### Run the Seed Script

```bash
npm run seed
```

Or directly:
```bash
tsx seed_acme_corp.ts
```

### What Gets Created

The script will:

1. ✅ **Sign in as founder**
   - Uses: `test_founder@newcompany.com`
   - Password: `SuperSecretPassword123!`

2. ✅ **Set up pipeline** (if not already created)
   - 4 stages: Backlog → In Progress → Review → Done
   - 4 transitions with sensible workflows

3. ✅ **Create 8 worker accounts** (if service key available)
   - Automatically adds them to the company
   - Default password: `WorkerPassword123!`
   - Email pattern: `worker0@test-acme.local`, `worker1@test-acme.local`, etc.

4. ✅ **Create 50 diverse tasks**
   - Realistic titles and descriptions
   - Varied priorities (urgent, high, medium, low)
   - 70% assignment rate to random workers

5. ✅ **Create work submissions**
   - Simulates completed work for reporting data
   - Generates submission records for review workflows

### Example Output

```
🌱 Starting Test Acme Corp seed...

📝 Signing in as founder: test_founder@newcompany.com
✅ Logged in as founder. ID: xxxx-xxxx-xxxx-xxxx

🏢 Fetching company information...
✅ Company ID: xxxx-xxxx-xxxx-xxxx

🔧 Setting up pipeline...
📋 Creating default pipeline...
✅ Created pipeline: xxxx-xxxx-xxxx-xxxx

👥 Creating 8 worker accounts...
   ✅ Created worker 1/8: Alex Chen (worker0@test-acme.local)
   ✅ Created worker 2/8: Jordan Rodriguez (worker1@test-acme.local)
   ...

📋 Creating 50 tasks...
   ✅ Created 10/50 tasks
   ✅ Created 20/50 tasks
   ...
✅ Created 50 tasks

⏱️  Creating work sessions and submissions for reporting...
   ✅ Submission created for task
   ...
✅ Created 5 submissions

═══════════════════════════════════════════════════════════════
✅ SEED COMPLETE!
═══════════════════════════════════════════════════════════════
📊 Summary:
   Company ID: xxxx-xxxx-xxxx-xxxx
   Pipeline ID: xxxx-xxxx-xxxx-xxxx
   Workers Created: 8
   Tasks Created: 50
   Team Members Available: 9
   Submissions Created: 5
```

## Testing Reporting with Seeded Data

After seeding, you can test various reporting features:

### 1. **Task Analytics**
- View task distribution by priority
- See completion rates and throughput
- Analyze stage dwell times

### 2. **Personnel Reports**
- Compare worker productivity metrics
- View active hours per worker
- Analyze on-time task completion rates
- Calculate cost per point and efficiency metrics

### 3. **Pipeline Analytics**
- Monitor bottlenecks in the workflow
- Track success/failure rates
- Analyze transition patterns

### 4. **Activity Timeline**
- View recent task movements
- Track who made changes and when
- Verify audit trail

## Customizing the Seed Script

To modify the seeding behavior, edit `seed_acme_corp.ts`:

### Change Number of Tasks
```typescript
const config: SeedConfig = {
  founderEmail: 'test_founder@newcompany.com',
  numWorkers: 8,      // Change this to 15, 20, etc.
  numTasks: 50,       // Change this to 100, 200, etc.
};
```

### Change Task Templates
Edit the `TASK_TEMPLATES` array to add custom task titles and descriptions:

```typescript
const TASK_TEMPLATES = [
  {
    title: 'Your custom task title',
    description: 'Your custom description',
    priority: 'high',
  },
  // ... more templates
];
```

### Change Worker Names
Edit the `WORKER_NAMES` array:

```typescript
const WORKER_NAMES = [
  'Custom Name 1',
  'Custom Name 2',
  // ... more names
];
```

## Troubleshooting

### Error: "Service role key not available"
- This means `SUPABASE_SERVICE_ROLE_KEY` is not set in your `.env`
- Worker creation will be skipped, but existing team members will still get tasks
- To create workers, add the service key to your `.env` and re-run

### Error: "Founder login failed"
- Verify the founder account exists: `test_founder@newcompany.com`
- Run `npm run start-seed` to create a founder account first (if this script exists)
- Or manually sign up through the app

### Error: "Could not fetch company"
- Ensure the founder account exists and has an associated company
- Check that the founder is properly set up in the auth system

### Tasks are created but not showing
- Refresh the Tasks view or restart the app
- Check that tasks are assigned to your current user's company
- Verify the pipeline_id matches the current context

## Cleanup

To start fresh and remove all seeded data:

1. **Using DevTool**: Click the **"Clear Tasks"** button
2. **Using CLI**: Clear tasks manually via Supabase dashboard or write a cleanup script
3. **Full reset**: Sign out, clear app data, and seed again

## Advanced: Creating Custom Seed Scripts

You can create custom seed scripts by copying `seed_acme_corp.ts`:

```bash
cp seed_acme_corp.ts seed_custom.ts
```

Then modify the config and add to package.json:

```json
"scripts": {
  "seed": "tsx seed_acme_corp.ts",
  "seed:custom": "tsx seed_custom.ts"
}
```

## Performance Notes

- **5 tasks**: ~2 seconds
- **30 tasks** (with assignments): ~5-10 seconds  
- **50 tasks** (full seed): ~10-20 seconds
- **100+ tasks**: ~30+ seconds depending on network

For large seeds (100+ tasks), consider:
- Running in batches
- Using parallel processing
- Adjusting timeout settings

## Next Steps

After seeding, you can:

1. Log in as different workers to simulate activity
2. Create work sessions to generate timer data
3. Submit work and create review cycles
4. Generate reports with realistic data
5. Test alert systems and notifications

For more details, see:
- [Analytics Guide](./docs/analytics-ui-connections.md)
- [Task Filtering Analysis](./TASK_FILTERING_ANALYSIS.md)
