// ====================================================================
// process-notification-event — Rule evaluator
// ====================================================================
//
// !! REQUIRED SECRETS — set in Supabase Dashboard:
//    Project Settings → Edge Functions → Secrets
//
//   NOTIFY_INTERNAL_SECRET  — must match the same secret set on the
//                             `notify` function. Generate with:
//                             openssl rand -base64 32
//                             Without this, calls to `notify` have no auth.
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.
// ====================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NOTIFY_INTERNAL_SECRET = Deno.env.get('NOTIFY_INTERNAL_SECRET') ?? ''

// ── Entry point ──────────────────────────────────────────────────────
serve(async (req: Request) => {
  try {
    const body = await req.json()

    // DB Webhook wraps the row in { record: {...} }. Direct test calls can
    // pass the event row itself.
    const event = body.record ?? body

    if (!event?.id || !event?.event_type) {
      return respond({ error: 'invalid payload' }, 400)
    }
    if (event.processed_at) {
      return respond({ skipped: 'already processed' }, 200)
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // 1. Find active rules matching this event type
    const { data: rules, error: rulesErr } = await db
      .from('notification_rules')
      .select('*')
      .eq('event_type', event.event_type)
      .eq('is_active', true)

    if (rulesErr) throw rulesErr

    if (!rules?.length) {
      await markProcessed(db, event.id)
      return respond({ matched_rules: 0, recipients: 0 }, 200)
    }

    // 2. Evaluate conditions and merge recipients across all matching rules
    const recipientSet = new Set<string>()

    for (const rule of rules) {
      if (!conditionsMatch(rule.conditions, event.payload)) continue

      const resolved = await resolveRecipients(db, rule, event)
      for (const uid of resolved) recipientSet.add(uid)
    }

    // 3. Exclude the actor who triggered the event
    if (event.actor_id) recipientSet.delete(event.actor_id)

    // 4. Fetch task title for notification content
    let taskTitle = 'A task'
    if (event.payload?.task_id) {
      const { data: task } = await db
        .from('tasks')
        .select('title')
        .eq('id', event.payload.task_id)
        .single()
      if (task?.title) taskTitle = task.title
    }

    // 5. Build human-readable title + body
    const { title, body: notifBody } = buildContent(
      event.event_type,
      taskTitle,
      event.payload ?? {}
    )

    // 6. Dispatch to notify Edge Function (fail-safe — errors don't abort)
    const notifyUrl = `${SUPABASE_URL}/functions/v1/notify`

    await Promise.allSettled(
      [...recipientSet].map((userId) =>
        fetch(notifyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${NOTIFY_INTERNAL_SECRET}`,
          },
          body: JSON.stringify({
            user_id: userId,
            type: event.event_type,
            title,
            body: notifBody,
            data: {
              task_id: event.payload?.task_id ?? null,
              pipeline_id: event.payload?.pipeline_id ?? null,
              comment_id: event.payload?.comment_id ?? null,
            },
          }),
        })
      )
    )

    // 7. Mark event processed
    await markProcessed(db, event.id)

    return respond({ matched_rules: rules.length, recipients: recipientSet.size }, 200)
  } catch (err) {
    console.error('[process-notification-event]', err)
    return respond({ error: String(err) }, 500)
  }
})

// ── Condition evaluation ─────────────────────────────────────────────
// All keys in the conditions object must match corresponding payload fields.
// An empty conditions object ({}) matches every event of that type.
function conditionsMatch(conditions: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(conditions)) {
    if (payload[key] !== value) return false
  }
  return true
}

// ── Recipient resolution ─────────────────────────────────────────────
async function resolveRecipients(
  db: SupabaseClient,
  rule: Record<string, unknown>,
  event: Record<string, unknown>
): Promise<string[]> {
  const strategies = rule.recipient_strategies as string[]
  const config = (rule.recipient_config ?? {}) as Record<string, unknown>
  const payload = (event.payload ?? {}) as Record<string, unknown>
  const entityId = event.entity_id as string

  const results: string[] = []

  for (const strategy of strategies) {
    const ids = await resolveStrategy(db, strategy, config, payload, entityId)
    results.push(...ids)
  }

  return results
}

async function resolveStrategy(
  db: SupabaseClient,
  strategy: string,
  config: Record<string, unknown>,
  payload: Record<string, unknown>,
  entityId: string
): Promise<string[]> {
  switch (strategy) {
    case 'assignee': {
      const { data } = await db
        .from('task_assignments')
        .select('assignee_user_id')
        .eq('task_id', entityId)
        .not('assignee_user_id', 'is', null)
      return (data ?? []).map((r: { assignee_user_id: string }) => r.assignee_user_id)
    }

    case 'task_owner': {
      const { data } = await db
        .from('tasks')
        .select('created_by')
        .eq('id', entityId)
        .single()
      return data?.created_by ? [data.created_by] : []
    }

    case 'pipeline_members': {
      // No dedicated pipeline_members table — resolve from task_assignments
      // and task_participants scoped to all tasks in the pipeline.
      const pipelineId = payload.pipeline_id as string | undefined
      if (!pipelineId) return []

      const { data: tasks } = await db
        .from('tasks')
        .select('id')
        .eq('pipeline_id', pipelineId)
        .is('deleted_at', null)
      if (!tasks?.length) return []

      const taskIds = tasks.map((t: { id: string }) => t.id)

      const [assignees, participants] = await Promise.all([
        db
          .from('task_assignments')
          .select('assignee_user_id')
          .in('task_id', taskIds)
          .not('assignee_user_id', 'is', null),
        db
          .from('task_participants')
          .select('user_id')
          .in('task_id', taskIds),
      ])

      const ids = new Set<string>()
      for (const r of assignees.data ?? []) ids.add(r.assignee_user_id)
      for (const r of participants.data ?? []) ids.add(r.user_id)
      return [...ids]
    }

    case 'watchers': {
      const { data } = await db
        .from('entity_watchers')
        .select('user_id')
        .eq('entity_type', 'task')
        .eq('entity_id', entityId)
      return (data ?? []).map((r: { user_id: string }) => r.user_id)
    }

    case 'role': {
      const roleName = config.role as string | undefined
      if (!roleName) return []

      const { data } = await db
        .from('user_roles')
        .select('user_id, roles!inner(name)')
        .eq('roles.name', roleName)
        .is('revoked_at', null)
      return (data ?? []).map((r: { user_id: string }) => r.user_id)
    }

    case 'specific_users': {
      const userIds = config.user_ids as string[] | undefined

      // Non-empty explicit list takes priority
      if (userIds?.length) return userIds

      // Special case: task.mentioned passes the target via payload
      if (payload.mentioned_user_id) {
        return [payload.mentioned_user_id as string]
      }

      return []
    }

    case 'payload_user': {
      // Reads a single user ID from a named payload field.
      // recipient_config: { "payload_field": "<field_name>" }
      const field = config.payload_field as string | undefined
      if (!field) return []
      const userId = payload[field] as string | undefined
      return userId ? [userId] : []
    }

    default:
      console.warn('[process-notification-event] unknown strategy:', strategy)
      return []
  }
}

// ── Notification content templates ───────────────────────────────────
function buildContent(
  eventType: string,
  taskTitle: string,
  payload: Record<string, unknown>
): { title: string; body: string } {
  const q = `"${taskTitle}"`

  switch (eventType) {
    case 'task.created':
      return { title: 'New Task Created', body: `${q} has been created.` }
    case 'task.assigned':
      return { title: 'Task Assigned to You', body: `${q} has been assigned to you.` }
    case 'task.mentioned':
      return { title: 'You Were Mentioned', body: `You were mentioned in a comment on ${q}.` }
    case 'task.commented':
      return { title: 'New Comment', body: `Someone commented on ${q}.` }
    case 'task.stage_transition': {
      const tag = (payload.stage_tag as string | undefined) ?? 'a new stage'
      return {
        title: 'Task Stage Updated',
        body: `${q} has moved to ${tag.replace(/_/g, ' ')}.`,
      }
    }
    case 'task.status_changed': {
      const to = (payload.to_status as string | undefined) ?? 'a new status'
      return { title: 'Task Status Updated', body: `${q} status changed to ${to}.` }
    }
    case 'task.completed':
      return { title: 'Task Completed', body: `${q} has been completed.` }
    case 'task.due_soon':
      return { title: 'Task Due Soon', body: `${q} is due within 24 hours.` }
    case 'task.overdue':
      return { title: 'Task Overdue', body: `${q} is past its due date.` }
    case 'task.manual_time_flagged': {
      const mins = payload.declared_minutes as number | undefined
      const time = mins ? `${Math.floor(mins / 60)}h ${mins % 60}m` : 'time'
      return { title: 'Time Declaration Needs Review', body: `A worker declared ${time} on ${q} — this exceeds expected limits and needs your approval.` }
    }
    case 'task.manual_time_approved':
      return { title: 'Time Declaration Approved', body: `Your time declaration on ${q} has been approved. You can now submit your work.` }
    case 'task.manual_time_rejected': {
      const reason = payload.rejection_reason as string | undefined
      return { title: 'Time Declaration Rejected', body: reason ? `Your time on ${q} was rejected: ${reason}` : `Your time declaration on ${q} was rejected. Please re-declare.` }
    }
    case 'pipeline.member_added':
      return { title: 'Added to Pipeline', body: `You have been added to a pipeline.` }
    case 'pipeline.archived':
      return { title: 'Pipeline Archived', body: `A pipeline has been archived.` }
    default:
      return { title: 'TrustFlow Notification', body: `You have a new notification.` }
  }
}

// ── Helpers ──────────────────────────────────────────────────────────
async function markProcessed(db: SupabaseClient, eventId: string) {
  await db
    .from('notification_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', eventId)
}

function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
