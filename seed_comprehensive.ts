import { createClient, SupabaseClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing supabase env vars");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// ─────────────────────────────────────────────────────────────────────────────
// Configuration & Data
// ─────────────────────────────────────────────────────────────────────────────

interface Task {
  id: string;
  assignee_id: string;
}

const TASK_TEMPLATES = [
  { title: 'Review client proposal', priority: 'high', estHours: 2 },
  { title: 'Update API documentation', priority: 'medium', estHours: 3 },
  { title: 'Fix critical authentication bug', priority: 'urgent', estHours: 4 },
  { title: 'Prepare Q2 financial report', priority: 'high', estHours: 5 },
  { title: 'Team coordination meeting', priority: 'medium', estHours: 1 },
  { title: 'Code review - auth module', priority: 'medium', estHours: 2 },
  { title: 'Customer support ticket resolution', priority: 'high', estHours: 1.5 },
  { title: 'Database query optimization', priority: 'medium', estHours: 3 },
  { title: 'New team member onboarding', priority: 'low', estHours: 4 },
  { title: 'Security vulnerability scan', priority: 'high', estHours: 2 },
  { title: 'Implement new caching layer', priority: 'medium', estHours: 6 },
  { title: 'Write integration tests', priority: 'medium', estHours: 3 },
];

const WORKER_NAMES = [
  'Alex Chen', 'Jordan Rodriguez', 'Sam Taylor', 'Morgan Lee', 'Casey Johnson',
  'Riley Martinez', 'Jamie Garcia', 'Quinn Thompson', 'River Anderson', 'Skylar White',
];

const SUBMISSION_COMMENTS = [
  'Work completed. Ready for review.',
  'All requirements met. Tested and validated.',
  'Implementation complete. Please review.',
  'Task finished. Let me know if changes needed.',
  'Done. Added inline documentation.',
  'Completed as requested. Ready for QA.',
  'Finished. All acceptance criteria met.',
  'Work submitted for review.',
];

const REVIEW_COMMENTS = [
  'Looks good! Approved.',
  'Great work. One small improvement suggested.',
  'Excellent. Ready to ship.',
  'Minor issues - please revise.',
  'Needs more work. Please address feedback.',
  'Outstanding work.',
  'Good effort. A few tweaks needed.',
];

// ─────────────────────────────────────────────────────────────────────────────
// Utility Functions
// ─────────────────────────────────────────────────────────────────────────────

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getPastDate(daysAgo: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function getISOString(date: Date): string {
  return date.toISOString();
}

// Get a random time on a specific day
function getTimeOnDay(daysAgo: number, hour?: number): Date {
  const d = getPastDate(daysAgo);
  if (hour !== undefined) {
    d.setHours(hour, randomInt(0, 59), randomInt(0, 59));
  } else {
    d.setHours(randomInt(8, 18), randomInt(0, 59), randomInt(0, 59));
  }
  return d;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Seeding Function
// ─────────────────────────────────────────────────────────────────────────────

async function seedComprehensive() {
  console.log('🌱 Starting comprehensive Test Acme Corp seed with work simulation...\n');

  try {
    // Step 1: Sign in as founder
    console.log(`📝 Signing in as founder...`);
    const { data: founderAuth, error: founderErr } = await supabase.auth.signInWithPassword({
      email: 'test_founder@newcompany.com',
      password: 'SuperSecretPassword123!',
    });

    if (founderErr) {
      console.error('❌ Founder login failed:', founderErr.message);
      return;
    }

    const founderId = founderAuth.user?.id;
    console.log(`✅ Logged in. User ID: ${founderId}\n`);

    // Step 2: Get company
    const { data: founderProfile } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', founderId)
      .single();

    if (!founderProfile?.company_id) {
      console.error('❌ Could not find company');
      return;
    }

    const companyId = founderProfile.company_id;
    console.log(`✅ Company ID: ${companyId}\n`);

    // Step 3: Get or create pipeline
    console.log('🔧 Setting up pipeline...');
    let { data: pipelines } = await supabase
      .from('pipelines')
      .select('id')
      .eq('company_id', companyId)
      .limit(1);

    let pipelineId: string;

    if (!pipelines || pipelines.length === 0) {
      const { data: newPipelineId, error: createPipelineErr } = await supabase.rpc('rpc_create_pipeline', {
        p_name: 'Standard Workflow',
        p_description: 'Default pipeline for task management',
        p_stages: [
          { name: 'Backlog', color: '#6b7280', position: 1, is_initial: true, is_terminal: false, requires_submission: false },
          { name: 'In Progress', color: '#3b82f6', position: 2, is_initial: false, is_terminal: false, requires_submission: true },
          { name: 'Review', color: '#f59e0b', position: 3, is_initial: false, is_terminal: false, requires_submission: true },
          { name: 'Done', color: '#10b981', position: 4, is_initial: false, is_terminal: true, terminal_type: 'success', requires_submission: false },
        ],
        p_transitions: [
          { from_position: 1, to_position: 2, label: 'Start' },
          { from_position: 2, to_position: 3, label: 'Ready for Review' },
          { from_position: 3, to_position: 4, label: 'Approve' },
          { from_position: 3, to_position: 2, label: 'Request Changes' },
        ],
      });

      if (createPipelineErr) {
        console.error('❌ Pipeline creation failed:', createPipelineErr.message);
        return;
      }

      pipelineId = newPipelineId;
      console.log(`✅ Created pipeline: ${pipelineId}\n`);
    } else {
      pipelineId = pipelines[0].id;
      console.log(`✅ Using existing pipeline: ${pipelineId}\n`);
    }

    // Step 4: Create worker users
    const workerIds: string[] = [];
    console.log(`👥 Creating 8 worker accounts...\n`);

    for (let i = 0; i < 8; i++) {
      const workerName = WORKER_NAMES[i];
      const workerEmail = `worker${i}@test-acme.local`;

      try {
        const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
          email: workerEmail,
          password: 'WorkerPassword123!',
          user_metadata: { full_name: workerName },
        });

        if (authErr) {
          console.warn(`   ⚠️  Worker ${i + 1} skipped (may exist): ${authErr.message}`);
          continue;
        }

        const workerId = authData.user.id;
        await supabaseAdmin.from('users').update({ company_id: companyId }).eq('id', workerId);
        workerIds.push(workerId);
        console.log(`   ✅ Worker ${i + 1}/8: ${workerName}`);
      } catch (err: any) {
        console.warn(`   ⚠️  Worker creation error: ${err.message}`);
      }
    }

    console.log();

    if (workerIds.length === 0) {
      console.warn('⚠️  No workers created. Fetching existing team members...');
      const { data: existingUsers } = await supabase
        .from('users')
        .select('id')
        .eq('company_id', companyId)
        .neq('id', founderId);

      if (existingUsers && existingUsers.length > 0) {
        workerIds.push(...existingUsers.map(u => u.id));
        console.log(`✅ Found ${workerIds.length} existing team members\n`);
      } else {
        console.error('❌ No team members available');
        return;
      }
    }

    // Step 5: Create tasks with comprehensive work simulation
    console.log(`📋 Creating 40 tasks with work simulation...\n`);

    const createdTasks: Task[] = [];
    let taskCount = 0;

    for (let i = 0; i < 40; i++) {
      const template = TASK_TEMPLATES[i % TASK_TEMPLATES.length];
      const assignee = randomElement(workerIds);
      const taskTitle = `${template.title} #${i + 1}`;

      const { data: taskId, error: taskErr } = await supabase.rpc('rpc_create_task', {
        p_title: taskTitle,
        p_description: `${template.title} - estimated ${template.estHours} hours`,
        p_priority: template.priority,
        p_pipeline_id: pipelineId,
        p_estimated_hours: template.estHours,
      });

      if (taskErr) {
        console.warn(`   ⚠️  Task creation failed: ${taskErr.message}`);
        continue;
      }

      // Assign to worker
      await supabase.rpc('rpc_assign_task', {
        p_task_id: taskId,
        p_target_user_id: assignee,
      });

      createdTasks.push({ id: taskId, assignee_id: assignee });
      taskCount++;

      if (taskCount % 10 === 0) {
        console.log(`   ✅ Created ${taskCount}/40 tasks`);
      }
    }

    console.log(`✅ Created ${createdTasks.length} tasks\n`);

    // Step 6: Simulate work on tasks
    console.log('⏱️  Simulating work sessions and completions...\n');

    let workSessionCount = 0;
    let submissionCount = 0;
    let approvalCount = 0;

    // Task lifecycle distribution:
    // - 30% completed successfully (Backlog -> In Progress -> Review -> Done)
    // - 20% in progress (Backlog -> In Progress)
    // - 20% in review (In Progress -> Review)
    // - 20% needs revision (In Progress -> Review -> In Progress)
    // - 10% backlog (stays in Backlog)

    for (const task of createdTasks) {
      const rand = Math.random();
      const daysAgo = randomInt(1, 14); // Tasks from past 2 weeks
      const startTime = getTimeOnDay(daysAgo, randomInt(8, 12));

      try {
        if (rand < 0.30) {
          // ✅ Completed successfully
          await simulateCompleteTask(supabase, supabaseAdmin, task, startTime, founderId);
          workSessionCount++;
          submissionCount++;
          approvalCount++;
        } else if (rand < 0.50) {
          // 🔵 In progress
          await simulateInProgressTask(supabase, task, startTime);
          workSessionCount++;
        } else if (rand < 0.70) {
          // 🟡 In review
          await simulateInReviewTask(supabase, task, startTime);
          workSessionCount++;
          submissionCount++;
        } else if (rand < 0.90) {
          // 🔄 Needs revision
          await simulateNeedsRevisionTask(supabase, supabaseAdmin, task, startTime, founderId);
          workSessionCount += 2;
          submissionCount += 2;
        }
        // else: stays in backlog
      } catch (err: any) {
        console.warn(`   ⚠️  Work simulation error for task: ${err.message}`);
      }
    }

    console.log(`✅ Work Simulation Complete\n`);

    // Summary
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ SEED COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`📊 Summary:`);
    console.log(`   Company ID: ${companyId}`);
    console.log(`   Pipeline ID: ${pipelineId}`);
    console.log(`   Workers Created: ${workerIds.length}`);
    console.log(`   Tasks Created: ${createdTasks.length}`);
    console.log(`   Work Sessions: ~${workSessionCount}`);
    console.log(`   Submissions: ~${submissionCount}`);
    console.log(`   Approvals: ~${approvalCount}`);
    console.log('\n📈 Reporting data ready:');
    console.log('   - Task completion rates');
    console.log('   - Worker productivity metrics');
    console.log('   - Pipeline throughput');
    console.log('   - Activity timeline');
    console.log('   - Financial metrics');
    console.log('═══════════════════════════════════════════════════════════════\n');
  } catch (err: any) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Task Simulation Scenarios
// ─────────────────────────────────────────────────────────────────────────────

async function simulateCompleteTask(
  supabase: SupabaseClient,
  supabaseAdmin: SupabaseClient,
  task: Task,
  startTime: Date,
  founderId: string
) {
  // Create work session
  const sessionDuration = randomInt(60, 120);
  const { data: workSessionId } = await supabaseAdmin.from('task_work_sessions').insert({
    task_id: task.id,
    user_id: task.assignee_id,
    started_at: getISOString(startTime),
    last_heartbeat_at: getISOString(new Date(startTime.getTime() + sessionDuration * 60000)),
    status: 'completed',
  }).select('id').single();

  // Create submission
  const submissionTime = new Date(startTime.getTime() + randomInt(30, 120) * 60000);
  const { data: submission } = await supabaseAdmin.from('task_submissions').insert({
    task_id: task.id,
    submitted_by: task.assignee_id,
    content: randomElement(SUBMISSION_COMMENTS),
    status: 'pending',
    submitted_at: getISOString(submissionTime),
  }).select('id').single();

  // Approve submission
  const approvalTime = new Date(submissionTime.getTime() + randomInt(30, 240) * 60000);
  if (submission?.id) {
    await supabaseAdmin.from('task_submissions').update({
      status: 'approved',
      reviewed_by: founderId,
      reviewed_at: getISOString(approvalTime),
      review_notes: randomElement(REVIEW_COMMENTS),
    }).eq('id', submission.id);
  }
}

async function simulateInProgressTask(
  supabase: SupabaseClient,
  task: Task,
  startTime: Date
) {
  // Create work session (ongoing)
  const sessionDuration = randomInt(30, 90);
  await supabase.from('task_work_sessions').insert({
    task_id: task.id,
    user_id: task.assignee_id,
    started_at: getISOString(startTime),
    last_heartbeat_at: getISOString(new Date(startTime.getTime() + sessionDuration * 60000)),
    status: 'active',
  });
}

async function simulateInReviewTask(
  supabase: SupabaseClient,
  task: Task,
  startTime: Date
) {
  // Create work session
  const sessionDuration = randomInt(60, 150);
  await supabase.from('task_work_sessions').insert({
    task_id: task.id,
    user_id: task.assignee_id,
    started_at: getISOString(startTime),
    last_heartbeat_at: getISOString(new Date(startTime.getTime() + sessionDuration * 60000)),
    status: 'completed',
  });

  // Create submission (pending review)
  const submissionTime = new Date(startTime.getTime() + randomInt(30, 120) * 60000);
  await supabase.from('task_submissions').insert({
    task_id: task.id,
    submitted_by: task.assignee_id,
    content: randomElement(SUBMISSION_COMMENTS),
    status: 'pending',
    submitted_at: getISOString(submissionTime),
  });
}

async function simulateNeedsRevisionTask(
  supabase: SupabaseClient,
  supabaseAdmin: SupabaseClient,
  task: Task,
  startTime: Date,
  founderId: string
) {
  // First submission - rejected
  const sessionDuration1 = randomInt(60, 120);
  await supabase.from('task_work_sessions').insert({
    task_id: task.id,
    user_id: task.assignee_id,
    started_at: getISOString(startTime),
    last_heartbeat_at: getISOString(new Date(startTime.getTime() + sessionDuration1 * 60000)),
    status: 'completed',
  });

  const submissionTime1 = new Date(startTime.getTime() + randomInt(30, 120) * 60000);
  const { data: submission1 } = await supabase.from('task_submissions').insert({
    task_id: task.id,
    submitted_by: task.assignee_id,
    content: randomElement(SUBMISSION_COMMENTS),
    status: 'pending',
    submitted_at: getISOString(submissionTime1),
  }).select('id').single();

  // Reject submission
  const rejectionTime = new Date(submissionTime1.getTime() + randomInt(30, 240) * 60000);
  if (submission1?.id) {
    await supabaseAdmin.from('task_submissions').update({
      status: 'needs_revision',
      reviewed_by: founderId,
      reviewed_at: getISOString(rejectionTime),
      review_notes: 'Please revise and resubmit.',
    }).eq('id', submission1.id);
  }

  // Second attempt - back to work
  const sessionStart2 = new Date(rejectionTime.getTime() + randomInt(60, 300) * 60000);
  const sessionDuration2 = randomInt(30, 90);
  await supabase.from('task_work_sessions').insert({
    task_id: task.id,
    user_id: task.assignee_id,
    started_at: getISOString(sessionStart2),
    last_heartbeat_at: getISOString(new Date(sessionStart2.getTime() + sessionDuration2 * 60000)),
    status: 'completed',
  });

  // Second submission - pending again
  const submissionTime2 = new Date(sessionStart2.getTime() + randomInt(30, 90) * 60000);
  await supabase.from('task_submissions').insert({
    task_id: task.id,
    submitted_by: task.assignee_id,
    content: 'Revised. Please review again.',
    status: 'pending',
    submitted_at: getISOString(submissionTime2),
  });
}

// Run the seed
seedComprehensive();
