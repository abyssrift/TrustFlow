/**
 * Preset role templates.
 *
 * These are starting points an admin can instantiate into their company's
 * Role Registry (alongside the built-in Owner / Admin / Manager system roles).
 * Picking a template pre-fills the Role Editor — the admin can tweak the name,
 * colour and permission set before saving, so nothing is created until they
 * confirm.
 *
 * Templates are defined by permission KEYS. At apply time the keys are resolved
 * against the live `permissions` table; any key that doesn't exist in the
 * current schema is simply skipped, so templates stay forward-compatible.
 *
 * The DB carries both legacy (`tasks.*`) and current (`task.*`) variants of a
 * few permissions — we list both where relevant so a template behaves the same
 * regardless of which variant a given check uses.
 */
export type RoleTemplate = {
  id: string;
  name: string;
  description: string;
  color: string;
  /** FontAwesome (v4) icon name shown in the gallery card. */
  icon: string;
  permissionKeys: string[];
};

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: 'project-manager',
    name: 'Project Manager',
    description: 'Full control over projects, pipelines and tasks plus team oversight and reporting.',
    color: '#6366f1',
    icon: 'sitemap',
    permissionKeys: [
      'project.view', 'project.create', 'project.edit', 'project.archive',
      'pipeline.create', 'pipeline.edit', 'pipeline.reverse',
      'task.view_all', 'tasks.view_all', 'task.view_detail', 'task.create', 'tasks.create',
      'task.edit', 'tasks.update', 'task.assign', 'tasks.assign', 'task.comment', 'task.view_history',
      'team.create', 'team.edit', 'team.manage_members',
      'analytics.view', 'analytics.compare',
      'report.view', 'report.generate', 'report.export',
      'target.set', 'target.view',
      'system.view_all_data',
    ],
  },
  {
    id: 'team-lead',
    name: 'Team Lead',
    description: 'Runs day-to-day execution: assigns and edits tasks, manages team members, shares files.',
    color: '#10b981',
    icon: 'users',
    permissionKeys: [
      'project.view',
      'task.view_all', 'tasks.view_all', 'task.view_detail', 'task.create', 'tasks.create',
      'task.edit', 'tasks.update', 'task.assign', 'tasks.assign', 'task.comment',
      'team.manage_members',
      'filehub:view', 'filehub:send', 'filehub:groups',
      'submission.review', 'target.view', 'analytics.view',
    ],
  },
  {
    id: 'contributor',
    name: 'Contributor',
    description: 'Standard member: works tasks, comments, and exchanges files. No admin access.',
    color: '#0ea5e9',
    icon: 'user',
    permissionKeys: [
      'project.view',
      'task.view_detail', 'task.create', 'tasks.create', 'task.edit', 'tasks.update', 'task.comment',
      'filehub:view', 'filehub:send',
    ],
  },
  {
    id: 'analyst',
    name: 'Analyst',
    description: 'Read-only insight role: dashboards, reports, targets and full task visibility.',
    color: '#f59e0b',
    icon: 'bar-chart',
    permissionKeys: [
      'project.view',
      'task.view_all', 'tasks.view_all', 'task.view_detail', 'task.view_history',
      'analytics.view', 'analytics.compare',
      'report.view', 'report.generate', 'report.export', 'report.schedule',
      'target.view', 'system.view_all_data',
    ],
  },
  {
    id: 'file-coordinator',
    name: 'File Coordinator',
    description: 'Owns FileHub: company-wide broadcasts, group management and file distribution.',
    color: '#a855f7',
    icon: 'folder-open',
    permissionKeys: [
      'filehub:view', 'filehub:send', 'filehub:broadcast', 'filehub:groups',
      'task.comment', 'project.view',
    ],
  },
  {
    id: 'auditor',
    name: 'Auditor',
    description: 'Compliance / oversight: archives, history and reports — view and restore, no editing.',
    color: '#64748b',
    icon: 'shield',
    permissionKeys: [
      'archive.view', 'archive.restore',
      'task.view_all', 'tasks.view_all', 'task.view_detail', 'task.view_history',
      'submission.view_all', 'report.view',
      'system.view_all_data', 'user.view_all',
    ],
  },
];
