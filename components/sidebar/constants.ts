import type FontAwesome from '@expo/vector-icons/FontAwesome';
import type React from 'react';
import type { ThemeType } from '@/contexts/ThemeContext';

export type IconName = React.ComponentProps<typeof FontAwesome>['name'];

export type Shortcut = {
  id: string;
  permissionKey: string;
  anyPermissions?: string[];
  fallbackPermissionKey?: string;
  icon: IconName;
  label: string;
  href: string;
};

export const THEME_OPTIONS: { id: ThemeType; label: string; icon: IconName }[] = [
  { id: 'indigo', label: 'Indigo Night', icon: 'moon-o' },
  { id: 'emerald', label: 'Emerald Matrix', icon: 'leaf' },
  { id: 'amber', label: 'Amber Signal', icon: 'sun-o' },
  { id: 'amethyst', label: 'Amethyst Grid', icon: 'diamond' },
  { id: 'light', label: 'Light Mode', icon: 'certificate' },
  { id: 'dark', label: 'Dark Mode', icon: 'circle-o' },
];

export const PIPELINE_ICONS: IconName[] = ['bolt', 'sitemap', 'random', 'sliders', 'exchange', 'cogs'];

export type PinnedShortcut = {
  id: string;
  label: string;
  icon: IconName;
  href: string;
};

export const MAX_PINNED_SHORTCUTS = 4;

export const INTELLIGENCE_PERMISSIONS = ['analytics.view', 'analytics.compare', 'report.view', 'target.view', 'archive.view'];

export const SHORTCUTS: Shortcut[] = [
  { id: 'dashboard', permissionKey: 'dashboard', icon: 'th-large', label: 'Dashboard', href: '/' },
  { id: 'tasks', permissionKey: '', icon: 'check-square-o', label: 'Tasks', href: '/tasks' },
  { id: 'projects', permissionKey: 'project.edit', icon: 'folder-o', label: 'Projects', href: '/projects' },
  { id: 'radar', permissionKey: '', anyPermissions: INTELLIGENCE_PERMISSIONS, icon: 'bullseye', label: 'Intelligence', href: '/intelligence' },
  { id: 'targets', permissionKey: 'target.view', icon: 'crosshairs', label: 'Targets', href: '/intelligence/targets' },
  { id: 'archives', permissionKey: 'archive.view', icon: 'archive', label: 'Archives', href: '/intelligence/archives' },
  { id: 'filehub', permissionKey: 'filehub:view', icon: 'folder-open', label: 'File Hub', href: '/filehub' },
  { id: 'team', permissionKey: 'user.view_all', fallbackPermissionKey: 'role.manage', icon: 'users', label: 'Corporate', href: '/people?section=teams' },
  { id: 'pipelines-admin', permissionKey: 'pipeline.edit', icon: 'gear', label: 'Pipelines', href: '/admin/pipelines' },
];
