# Quick Seed Reference

## 🚀 TL;DR - Get Started in 2 Minutes

### Option A: In-App (Fastest)
1. Open the app and go to Tasks screen
2. Look for the blue **Dev Tools** box at the top
3. Click **"Seed 30 Tasks"** to populate with realistic data
4. Done! Data appears immediately

### Option B: Command Line (Most Complete)
```bash
npm run seed
```

This creates:
- 8 new worker accounts
- 50 diverse tasks
- Realistic assignments
- Submission data for reporting

---

## 📊 What Gets Created

### Quick Seed (5 Tasks)
```
⏱️  ~2 seconds
📝 5 random tasks with varied priorities
```

### Comprehensive Seed (30 Tasks - In App)
```
⏱️  ~5-10 seconds
📝 30 realistic tasks
👥 70% assigned to team members
📈 Various priorities (urgent, high, medium, low)
```

### Full Seed (50 Tasks - CLI)
```
⏱️  ~10-20 seconds
👤 8 new worker accounts (if service key available)
📝 50 diverse tasks
👥 70% assigned to workers
🔄 5+ work submissions
📊 Complete reporting data
```

---

## 🎯 Use Cases

### Testing Reporting Features
```bash
npm run seed
# Generates workers, tasks, assignments for full reporting analysis
```

### Quick UI Testing
```
Click "Seed 30 Tasks" in DevTool
# Fast population without creating new accounts
```

### Starting Fresh
```
Click "Clear Tasks" in DevTool
npm run seed
# Wipe and re-populate
```

---

## 📋 Task Templates Used

- Review client proposal
- Update documentation  
- Fix critical bug
- Prepare financial report
- Coordinate with marketing
- Code review
- Client support ticket
- Infrastructure optimization
- Team onboarding
- Security audit

Each gets 5 variations in the full seed (50 tasks total).

---

## 👥 Worker Accounts Created

Default credentials (when using `npm run seed`):
- **Email**: `worker0@test-acme.local` through `worker7@test-acme.local`
- **Password**: `WorkerPassword123!`
- **Company**: Automatically added to Test Acme Corp

---

## 🔧 Configuration

Edit `seed_acme_corp.ts` to customize:

```typescript
// Line 188-191:
const config: SeedConfig = {
  founderEmail: 'test_founder@newcompany.com',
  numWorkers: 8,    // ← Change to 15, 20, etc
  numTasks: 50,     // ← Change to 100, 200, etc
};
```

---

## ✅ Verification Checklist

After seeding:
- [ ] Tasks appear in Tasks screen
- [ ] Team members show in assignee lists
- [ ] Analytics dashboard has data
- [ ] Reports show activity
- [ ] Can filter by priority/status
- [ ] Can view work sessions

---

## 🆘 Quick Troubleshooting

| Problem | Solution |
|---------|----------|
| DevTool not appearing | Check: `process.env.EXPO_PUBLIC_SUPABASE_URL` must be set |
| "Service role key not available" | Add `SUPABASE_SERVICE_ROLE_KEY` to `.env` for worker creation |
| Tasks not appearing | Refresh app or restart dev server |
| Workers not created | Ensure `.env` has service key; check founder account exists |
| "Seed failed" | Check internet connection and Supabase status |

---

## 📚 Learn More

- Full guide: See [SEED_GUIDE.md](./SEED_GUIDE.md)
- Analytics docs: See [docs/analytics-ui-connections.md](./docs/analytics-ui-connections.md)
- Task filtering: See [TASK_FILTERING_ANALYSIS.md](./TASK_FILTERING_ANALYSIS.md)

---

## 🔑 Key Files

- **In-app seeding**: [components/DevTool.tsx](./components/DevTool.tsx)
- **CLI seeding**: [seed_acme_corp.ts](./seed_acme_corp.ts)
- **Full documentation**: [SEED_GUIDE.md](./SEED_GUIDE.md)

---

## 💡 Pro Tips

1. **Use comprehensive seed for reporting tests** - more tasks = better analytics data
2. **Quick seed for UI testing** - faster iteration
3. **Combine methods** - seed 30 in-app, then run CLI seed for workers
4. **Test in phases** - seed → verify → adjust → seed again
5. **Check reports immediately** - analytics may need a few seconds to process

---

**Last Updated**: May 14, 2026
**Script Version**: 1.0
**Status**: ✅ Production Ready
