-- Fill in descriptions for permissions that had none (shown as "(no documentation)" in the Role Editor).
-- Applied to prod 2026-07-26 via MCP (migration: fill_permission_descriptions).
UPDATE permissions SET description = v.description
FROM (VALUES
  ('analytics.view',        'Access the analytics dashboard with productivity and time-tracking insights.'),
  ('analytics.compare',     'Compare performance metrics side-by-side across users and teams.'),
  ('archive:create',        'Archive tasks and projects, moving them out of active pipelines into cold storage.'),
  ('archive.delete',        'Permanently delete archived items. This cannot be undone.'),
  ('filehub:view',          'Access File Hub and view files and channels shared with the user.'),
  ('filehub:send',          'Send files directly to specific company members.'),
  ('filehub:broadcast',     'Send files to every member of the company at once.'),
  ('filehub:groups',        'Create FileHub channels and manage their members and files.'),
  ('manage_notifications',  'Create and edit company-wide notification rules.'),
  ('project.view',          'View projects the user has access to.'),
  ('project.delete',        'Delete projects from the workspace.'),
  ('report.generate',       'Generate PDF reports from analytics and task data.')
) AS v(key, description)
WHERE permissions.key = v.key AND permissions.description IS NULL;
