import { createClient } from '@supabase/supabase-js';
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

interface SeedConfig {
  founderEmail: string;
  numWorkers: number;
  numTasks: number;
  numTasksPerWorker?: number;
}

const TASK_TEMPLATES = [
  {
    title: 'Review client proposal',
    description: 'Review and provide feedback on Q2 client deliverables proposal',
    priority: 'high' as const,
  },
  {
    title: 'Update documentation',
    description: 'Update API documentation with latest endpoints and examples',
    priority: 'medium' as const,
  },
  {
    title: 'Fix critical bug',
    description: 'Address issue #1234 in production affecting 5% of users',
    priority: 'urgent' as const,
  },
  {
    title: 'Prepare financial report',
    description: 'Compile Q1 financial metrics and prepare presentation',
    priority: 'high' as const,
  },
  {
    title: 'Coordinate with marketing',
    description: 'Schedule meeting to align on campaign messaging',
    priority: 'medium' as const,
  },
  {
    title: 'Code review for backend',
    description: 'Review pull requests in auth module',
    priority: 'medium' as const,
  },
  {
    title: 'Client support ticket',
    description: 'Respond to customer inquiry about integration',
    priority: 'high' as const,
  },
  {
    title: 'Infrastructure optimization',
    description: 'Analyze database query performance and optimize slow queries',
    priority: 'medium' as const,
  },
  {
    title: 'Team onboarding',
    description: 'Prepare onboarding materials for new team members',
    priority: 'low' as const,
  },
  {
    title: 'Security audit',
    description: 'Run security vulnerability scan on dependencies',
    priority: 'high' as const,
  },
];

const WORKER_NAMES = [
  'Alex Chen',
  'Jordan Rodriguez',
  'Sam Taylor',
  'Morgan Lee',
  'Casey Johnson',
  'Riley Martinez',
  'Jamie Garcia',
  'Quinn Thompson',
  'River Anderson',
  'Skylar White',
];

async function seedTestAcmeCorp(config: SeedConfig) {
  console.log('🌱 Starting Test Acme Corp seed...\n');

  try {
    // Step 1: Sign in as founder
    console.log(`📝 Signing in as founder: ${config.founderEmail}`);
    const { data: founderAuth, error: founderErr } = await supabase.auth.signInWithPassword({
      email: config.founderEmail,
      password: 'SuperSecretPassword123!',
    });

    if (founderErr) {
      console.error('❌ Founder login failed:', founderErr.message);
      return;
    }

    const founderId = founderAuth.user?.id;
    console.log(`✅ Logged in as founder. ID: ${founderId}\n`);

    // Step 2: Get founder's company
    console.log('🏢 Fetching company information...');
    const { data: founderProfile, error: profileErr } = await supabase
      .from('users')
      .select('company_id')
      .eq('id', founderId)
      .single();

    if (profileErr || !founderProfile?.company_id) {
      console.error('❌ Could not fetch company:', profileErr?.message);
      return;
    }

    const companyId = founderProfile.company_id;
    console.log(`✅ Company ID: ${companyId}\n`);

    // Step 3: Get or create default pipeline
    console.log('🔧 Setting up pipeline...');
    let { data: pipelines, error: pipelineErr } = await supabase
      .from('pipelines')
      .select('id')
      .eq('company_id', companyId)
      .limit(1);

    let pipelineId: string;

    if (!pipelines || pipelines.length === 0) {
      console.log('📋 Creating default pipeline...');
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

    // Step 4: Create worker users if using admin key
    const workerIds: string[] = [];
    if (supabaseServiceKey) {
      console.log(`👥 Creating ${config.numWorkers} worker accounts...\n`);

      for (let i = 0; i < config.numWorkers; i++) {
        const workerName = WORKER_NAMES[i % WORKER_NAMES.length] + (i >= WORKER_NAMES.length ? ` ${i}` : '');
        const workerEmail = `worker${i}@test-acme.local`;

        try {
          const { data: authData, error: authErr } = await supabaseAdmin.auth.admin.createUser({
            email: workerEmail,
            password: 'WorkerPassword123!',
            user_metadata: {
              full_name: workerName,
            },
          });

          if (authErr) {
            console.warn(`   ⚠️  Worker ${i + 1} creation skipped (may already exist): ${authErr.message}`);
            continue;
          }

          const workerId = authData.user.id;

          // Add user to company
          const { error: insertErr } = await supabaseAdmin.from('users').update({ company_id: companyId }).eq('id', workerId);

          if (insertErr) {
            console.warn(`   ⚠️  Could not add worker to company: ${insertErr.message}`);
          } else {
            workerIds.push(workerId);
            console.log(`   ✅ Created worker ${i + 1}/${config.numWorkers}: ${workerName} (${workerEmail})`);
          }
        } catch (err: any) {
          console.warn(`   ⚠️  Worker creation error: ${err.message}`);
        }
      }

      console.log();
    } else {
      console.warn('⚠️  Service role key not available. Skipping worker creation.\n');
      console.log('   To create workers, set SUPABASE_SERVICE_ROLE_KEY in your .env\n');
    }

    // Step 5: Get existing team members if no workers were created
    let teamMembers = workerIds;
    if (teamMembers.length === 0) {
      console.log('👥 Fetching existing team members...');
      const { data: existingUsers } = await supabase
        .from('users')
        .select('id')
        .eq('company_id', companyId)
        .neq('id', founderId);

      if (existingUsers && existingUsers.length > 0) {
        teamMembers = existingUsers.map(u => u.id);
        console.log(`✅ Found ${teamMembers.length} existing team members\n`);
      } else {
        console.warn('⚠️  No team members found. Will create tasks without assignments.\n');
      }
    }

    // Step 6: Create tasks
    console.log(`📋 Creating ${config.numTasks} tasks...\n`);
    const createdTasks: string[] = [];

    for (let i = 0; i < config.numTasks; i++) {
      const template = TASK_TEMPLATES[i % TASK_TEMPLATES.length];
      const taskTitle = `${template.title} #${i + 1}`;

      const { data: taskId, error: taskErr } = await supabase.rpc('rpc_create_task', {
        p_title: taskTitle,
        p_description: template.description,
        p_priority: template.priority,
        p_pipeline_id: pipelineId,
      });

      if (taskErr) {
        console.warn(`   ⚠️  Task creation failed: ${taskErr.message}`);
        continue;
      }

      createdTasks.push(taskId);

      // Optionally assign to a team member
      if (teamMembers.length > 0 && Math.random() > 0.3) {
        const assigneeIdx = Math.floor(Math.random() * teamMembers.length);
        await supabase.rpc('rpc_assign_task', {
          p_task_id: taskId,
          p_target_user_id: teamMembers[assigneeIdx],
        });
      }

      if ((i + 1) % 10 === 0) {
        console.log(`   ✅ Created ${i + 1}/${config.numTasks} tasks`);
      }
    }

    console.log(`✅ Created ${createdTasks.length} tasks\n`);

    // Step 7: Create some work sessions and submissions for reporting data
    console.log('⏱️  Creating work sessions and submissions for reporting...\n');

    const tasksToWorkOn = createdTasks.slice(0, Math.min(5, createdTasks.length));
    let submissionCount = 0;

    for (const taskId of tasksToWorkOn) {
      // Get task assignee to simulate work
      const { data: taskData } = await supabase
        .from('tasks')
        .select('id, assignee_ids')
        .eq('id', taskId)
        .single();

      if (!taskData?.assignee_ids || taskData.assignee_ids.length === 0) continue;

      const assigneeId = taskData.assignee_ids[0];

      // Simulate work session - create one via RPC (if available)
      // For now, we'll just create a submission to generate reporting data

      const { error: submitErr } = await supabase.rpc('rpc_submit_work', {
        p_task_id: taskId,
        p_content: 'Work completed. Ready for review.',
      });

      if (!submitErr) {
        submissionCount++;
        console.log(`   ✅ Submission created for task`);
      }
    }

    console.log(`✅ Created ${submissionCount} submissions\n`);

    // Summary
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ SEED COMPLETE!');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`📊 Summary:`);
    console.log(`   Company ID: ${companyId}`);
    console.log(`   Pipeline ID: ${pipelineId}`);
    console.log(`   Workers Created: ${workerIds.length}`);
    console.log(`   Tasks Created: ${createdTasks.length}`);
    console.log(`   Team Members Available: ${teamMembers.length}`);
    console.log(`   Submissions Created: ${submissionCount}`);
    console.log('\n💡 Next steps:');
    console.log('   - Log in as a team member to create more work sessions');
    console.log('   - Use the Tasks view to see assignments and reporting data');
    console.log('   - Check Analytics for personalized and organizational insights');
    console.log('═══════════════════════════════════════════════════════════════\n');
  } catch (err: any) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
}

// Run seed with configuration
const config: SeedConfig = {
  founderEmail: 'test_founder@newcompany.com',
  numWorkers: 8,
  numTasks: 50,
};

seedTestAcmeCorp(config);
