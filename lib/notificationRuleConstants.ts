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
  'project.stage_transition':   { label: 'Project Stage Moved',    cat: 'Projects',  icon: 'arrow-right',        colorKey: 'primary' },
  'project.flag_raised':        { label: 'Project Flagged',        cat: 'Projects',  icon: 'flag',               colorKey: 'danger'  },
  'project.due_soon':           { label: 'Project Due Soon',       cat: 'Deadlines', icon: 'clock-o',            colorKey: 'danger'  },
  'portfolio.completed':        { label: 'Batch Completed',        cat: 'Projects',  icon: 'check-circle',       colorKey: 'primary' },
  'project_template.updated':   { label: 'Template Updated',       cat: 'Projects',  icon: 'files-o',            colorKey: 'warning' },
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
  payload_users:    'Payload Users',
};

export const STRATEGY_HELP: Record<string, string> = {
  assignee:         'All users assigned to the task',
  task_owner:       'The user who created the task',
  watchers:         'Users watching the task',
  specific_users:   'Explicit user IDs (or mentioned user)',
  pipeline_members: 'All assignees + participants in the pipeline',
  role:             'All users holding the named role',
  payload_user:     'User ID read from a payload field',
  // Project/portfolio events resolve "who can see this" in the database via
  // fn_project_accessible (auth.uid()-bound, unreachable from the Edge
  // Function's service-role client) and ship the list in the payload. This
  // strategy consumes that list verbatim -- it can only narrow, never widen.
  payload_users:    'User ID list read from a payload field (resolved in the database)',
};

export const ALL_EVENT_TYPES = Object.keys(EVENT_META);
export const ALL_STRATEGIES = Object.keys(STRATEGY_LABELS);
