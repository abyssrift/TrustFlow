# Dev Tools - Dedicated Admin Page

## Overview

Dev Tools is now a **dedicated admin page** separate from the main dashboard, giving you a dedicated space for all seeding and data management operations.

## Accessing Dev Tools

### From the Tasks Screen
1. Open the app and go to **Tasks**
2. Look for the blue **Dev Tools** widget at the top
3. Click **"Seeding & Data Management"**
4. Redirects to the dedicated Dev Tools page

### Direct URL
```
/admin/dev-tools
```

### From Admin Sidebar (Desktop)
In the platform admin panel, look for Dev Tools option in the sidebar (if configured).

## What You Get

### Quick Seed (5 Tasks)
- **Time**: ~2 seconds
- **Use Case**: Rapid UI testing
- **Data**: 5 random tasks with medium priority
- **Ideal for**: Quick iterations, testing filters

### Comprehensive Seed (30 Tasks)
- **Time**: ~5-10 seconds  
- **Use Case**: UI testing + basic analytics
- **Data**: 30 diverse tasks with assignments
- **Ideal for**: Team assignment testing, task filtering, dashboard widgets

### Full Reporting Seed (40 Tasks + Work)
- **Time**: ~30-60 seconds
- **Use Case**: Complete reporting system testing
- **Data**: Full work simulation with submissions and reviews
- **Method**: Terminal command `npm run seed:full`
- **Ideal for**: Personnel analytics, pipeline throughput, financial reports

### Clear All Tasks
- **Time**: <1 second
- **Use Case**: Starting fresh
- **Ideal for**: Cleaning up before a new test run

## Features

### Current Status Display
Shows:
- ✅ Pipeline status (Ready/Not Found)
- 👥 Available team members count

### Real-time Progress Log
- Live updates as seeding progresses
- Shows task creation status
- Displays assignments and any errors
- Scrollable history of operations

### Responsive Design
- **Mobile**: Full-screen dedicated page
- **Desktop/Web**: Integrated into admin dashboard
- **Tablet**: Optimized layout

## Workflow

### 1. Quick Testing
```
1. Open Dev Tools
2. Click "Comprehensive Seed (30 Tasks)"
3. Watch progress in real-time
4. Go to Tasks and verify data
```

### 2. Complete Testing
```
1. Open terminal
2. Run: npm run seed:full
3. Wait 30-60 seconds
4. Check analytics and reports
```

### 3. Start Fresh
```
1. Open Dev Tools
2. Click "Clear All Tasks"
3. Confirm deletion
4. Page updates instantly
```

## Tips & Tricks

### Combine Multiple Seeds
- Run Comprehensive Seed first (30 tasks)
- Then run Full Seed (40 more tasks)
- Total: 70 tasks with mixed data types

### Check Progress
- Watch the live progress log
- Scroll to see all operations
- Monitor for any warnings

### Test at Scale
- Quick Seed: Test UI quickly
- Comprehensive: Test with realistic volume
- Full: Test reporting with complete history

### Troubleshooting

**Issue**: No team members available
- **Solution**: Comprehensive seed will skip assignments
- **Workaround**: Run Full Seed first to create workers

**Issue**: Seeding is slow
- **Solution**: Check internet connection
- **Workaround**: Reduce task count in source code

**Issue**: Tasks don't appear immediately
- **Solution**: Refresh the app (iOS/Android) or browser (web)

## Component Files

```
Mobile/Hybrid: /app/admin/dev-tools.tsx
Web: /app/admin/dev-tools.web.tsx
Widget: /components/DevTool.tsx (links to admin page)
CLI Scripts: /seed_acme_corp.ts, /seed_comprehensive.ts
```

## Environment Variables

Requires in `.env`:
```env
EXPO_PUBLIC_SUPABASE_URL=your_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_key
SUPABASE_SERVICE_ROLE_KEY=your_key  # For worker creation
```

## Related Documentation

- [Comprehensive Seed Guide](./COMPREHENSIVE_SEED_GUIDE.md)
- [Quick Reference](./SEED_QUICK_REFERENCE.md)
- [Seeding Setup](./SEEDING_SETUP_COMPLETE.md)

---

**Key Features**:
✅ Dedicated admin page  
✅ Real-time progress monitoring  
✅ Multiple seeding strategies  
✅ Current status display  
✅ Responsive across devices  
✅ Full data management capabilities  
