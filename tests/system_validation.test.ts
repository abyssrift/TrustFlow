import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

const createTestClient = () => createClient(supabaseUrl, supabaseAnonKey);

describe('TrustFlow Full System E2E Validation', () => {
  let founderClient: SupabaseClient;
  let managerClient: SupabaseClient;
  let workerClient: SupabaseClient;

  const founderEmail = 'e2e-founder@example.com';
  const managerEmail = 'e2e-manager@example.com';
  const workerEmail = 'e2e-worker@example.com';
  const password = 'Password123!';

  let companyId: string;
  let pipelineId: string;
  let taskId: string;
  let workerId: string;

  beforeAll(async () => {
    founderClient = createTestClient();
    managerClient = createTestClient();
    workerClient = createTestClient();

    // 1. Sign in all clients
    const { data: fAuth, error: fErr } = await founderClient.auth.signInWithPassword({ email: founderEmail, password });
    if (fErr) throw new Error(`Founder login failed: ${fErr.message}`);

    const { data: mAuth, error: mErr } = await managerClient.auth.signInWithPassword({ email: managerEmail, password });
    if (mErr) throw new Error(`Manager login failed: ${mErr.message}`);

    const { data: wAuth, error: wErr } = await workerClient.auth.signInWithPassword({ email: workerEmail, password });
    if (wErr) throw new Error(`Worker login failed: ${wErr.message}`);

    workerId = wAuth.user!.id;

    // 2. Resolve company_id
    const { data: profile } = await founderClient.from('users').select('company_id').eq('id', fAuth.user!.id).single();
    companyId = profile!.company_id;
  });

  describe('Phase 1: Pipeline Configuration', () => {
    it('should create a functional pipeline with stages', async () => {
      const stages = [
        { name: 'Backlog', color: 'gray', position: 1, is_initial: true, is_terminal: false, requires_submission: false },
        { name: 'In Progress', color: 'blue', position: 2, is_initial: false, is_terminal: false, requires_submission: true },
        { name: 'Done', color: 'green', position: 3, is_initial: false, is_terminal: true, terminal_type: 'completed', requires_submission: false }
      ];

      const transitions = [
        { from_position: 1, to_position: 2, label: 'Start Work' },
        { from_position: 2, to_position: 3, label: 'Complete' }
      ];

      const { data: pId, error } = await founderClient.rpc('rpc_create_pipeline', {
        p_name: `Standard Workflow ${Date.now()}`,
        p_description: 'E2E Test Pipeline',
        p_stages: stages,
        p_transitions: transitions
      });

      expect(error).toBeNull();
      expect(pId).toBeDefined();
      pipelineId = pId;
    });
  });

  describe('Phase 2: Task Execution Flow', () => {
    it('should manage task lifecycle end-to-end', async () => {
      // 1. Manager: Create Task
      const { data: tId, error: createErr } = await managerClient.rpc('rpc_create_task', {
        p_title: 'E2E Critical Task',
        p_description: 'Verify all systems',
        p_pipeline_id: pipelineId
      });
      expect(createErr).toBeNull();
      taskId = tId;

      // 2. Manager: Assign Task
      const { error: assignErr } = await managerClient.rpc('rpc_assign_task', {
        p_task_id: taskId,
        p_target_user_id: workerId
      });
      expect(assignErr).toBeNull();

      // 3. Worker: Submit Work
      const { error: submitErr } = await workerClient.rpc('rpc_submit_work', {
        p_task_id: taskId,
        p_content: 'Verified. Systems nominal.'
      });
      expect(submitErr).toBeNull();

      // 4. Manager: Review & Advance
      let submissionId;
      for (let i = 0; i < 5; i++) {
        const { data: subs } = await managerClient.from('task_submissions').select('id').eq('task_id', taskId).single();
        if (subs) {
          submissionId = subs.id;
          break;
        }
        await new Promise(r => setTimeout(r, 1000));
      }
      expect(submissionId).toBeDefined();

      const { data: stages } = await managerClient.from('pipeline_stages').select('id').eq('pipeline_id', pipelineId).order('display_order', { ascending: true });
      const doneStageId = stages?.[2]?.id;

      const { error: reviewErr } = await managerClient.rpc('rpc_review_submission', {
        p_submission_id: submissionId,
        p_decision: 'approved',
        p_notes: 'Excellent work.',
        p_advance_stage_id: doneStageId
      });
      expect(reviewErr).toBeNull();

      // 5. Audit Check
      const { data: events } = await founderClient.from('activity_events').select('*').eq('entity_id', taskId);
      const eventTypes = events?.map(e => e.event_type);
      expect(eventTypes).toContain('task.created');
      expect(eventTypes).toContain('task.assigned');
      expect(eventTypes).toContain('task.work_submitted');
      expect(eventTypes).toContain('task.submission_reviewed');
    });
  });
});
