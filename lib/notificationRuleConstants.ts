export type NotificationRule = {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  conditions: Record<string, unknown>;
  recipient_strategies: string[];
  recipient_config: Record<string, unknown>;
  channels_override: Record<string, unknown> | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export const EVENT_META: Record<string, { label: string; cat: string; icon: any; colorKey: string }> = {
  'task.assigned':              { label: 'Task Assigned',          cat: 'Tasks',     icon: 'user-plus',          colorKey: 'primary' },
  'task.commented':             { label: 'New Comment',            cat: 'Comments',  icon: 'comment',            colorKey: 'warning' },
  'task.due_soon':              { label: 'Due Soon',               cat: 'Deadlines', icon: 'clock-o',            colorKey: 'danger'  },
  'task.mentioned':             { label: 'Mention',                cat: 'Comments',  icon: 'at',                 colorKey: 'warning' },
  'task.overdue':               { label: 'Task Overdue',           cat: 'Deadlines', icon: 'exclamation-circle', colorKey: 'danger'  },
  'task.created':               { label: 'Task Created',           cat: 'Tasks',     icon: 'plus-circle',        colorKey: 'primary' },
  'task.completed':             { label: 'Task Completed',         cat: 'Tasks',     icon: 'check-circle',       colorKey: 'primary' },
  'task.status_changed':        { label: 'Status Changed',         cat: 'Tasks',     icon: 'exchange',           colorKey: 'primary' },
  'task.stage_transition':      { label: 'Stage Transition',       cat: 'Pipelines', icon: 'arrow-right',        colorKey: 'primary' },
  'task.manual_time_flagged':   { label: 'Manual Time Flagged',    cat: 'Time',      icon: 'flag',               colorKey: 'warning' },
  'task.manual_time_approved':  { label: 'Manual Time Approved',   cat: 'Time',      icon: 'thumbs-up',          colorKey: 'primary' },
  'task.manual_time_rejected':  { label: 'Manual Time Rejected',   cat: 'Time',      icon: 'thumbs-down',        colorKey: 'danger'  },
  'pipeline.member_added':      { label: 'Pipeline Member Added',  cat: 'Pipelines', icon: 'user-plus',          colorKey: 'primary' },
  'pipeline.archived':          { label: 'Pipeline Archived',      cat: 'Pipelines', icon: 'archive',            colorKey: 'textMuted' },
};

export const STRATEGY_LABELS: Record<string, string> = {
  assignee:         'Assignees',
  task_owner:       'Task Owner',
  watchers:         'Watchers',
  specific_users:   'Specific Users',
  pipeline_members: 'Pipeline Members',
  role:             'By Role',
  payload_user:     'Payload User',
};

export const STRATEGY_HELP: Record<string, string> = {
  assignee:         'All users assigned to the task',
  task_owner:       'The user who created the task',
  watchers:         'Users watching the task',
  specific_users:   'Explicit user IDs (or mentioned user)',
  pipeline_members: 'All assignees + participants in the pipeline',
  role:             'All users holding the named role',
  payload_user:     'User ID read from a payload field',
};

export const ALL_EVENT_TYPES = Object.keys(EVENT_META);
export const ALL_STRATEGIES = Object.keys(STRATEGY_LABELS);
