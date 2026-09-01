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

export const PIPELINE_ICONS: IconName[] = ['bolt', 'sitemap', 'random', 'server', 'exchange', 'cogs'];

// The desktop rail groups SHORTCUTS into titled sections separated by
// hairlines (#211). SHORTCUTS stays flat — it's the single source of truth for
// shortcut metadata (icons, labels, hrefs, permission gating), while
// SIDEBAR_GROUPS only governs the rail's order and grouping. Groups are plain:
// every shortcut is a sibling row under its section title; there are no
// expandable/collapsible parents. Targets/Archives were removed from the rail
// entirely (#211) — they live inside the Intelligence hub itself, not as nav
// destinations.
export type SidebarGroupDef = {
  id: string;
  title?: string;
  items: { id: string }[];
};

export const SIDEBAR_GROUPS: SidebarGroupDef[] = [
  // Untitled lead-in group: Dashboard sits alone above the titled sections.
  { id: 'home', items: [{ id: 'dashboard' }] },
  {
    id: 'work',
    title: 'Work',
    items: [{ id: 'tasks' }, { id: 'deadlines' }, { id: 'projects' }, { id: 'portfolios' }],
  },
  {
    id: 'intel',
    title: 'Intelligence',
    items: [{ id: 'radar' }],
  },
  {
    id: 'company',
    title: 'Company',
    items: [{ id: 'filehub' }, { id: 'team' }],
  },
  {
    id: 'admin',
    title: 'Admin',
    items: [{ id: 'pipelines-admin' }],
  },
];

export type PinnedShortcut = {
  id: string;
  label: string;
  icon: IconName;
  href: string;
  // Set only for a pinned portfolio — tells PinnedShortcuts to render it with
  // EntityGlyph (components/entities/EntityUI.tsx) instead of a plain
  // FontAwesome glyph, so a portfolio reads as workspace data, not a nav
  // destination, everywhere it appears (pill + picker row).
  kind?: 'portfolio';
};

export const MAX_PINNED_SHORTCUTS = 4;

// The picker shows only the N most recent portfolios as pin candidates — a
// company with 50 portfolios would otherwise turn "Pin a shortcut" into a
// scroll pit of batches nobody is currently working. usePortfolios() already
// orders by recency, so capping here keeps the ones most likely to be
// pinned; "Browse all portfolios" (linking to /portfolios, which has its own
// search) covers anything older.
export const MAX_PORTFOLIO_CANDIDATES = 6;

export const INTELLIGENCE_PERMISSIONS = ['analytics.view', 'analytics.compare', 'report.view', 'target.view', 'archive.view'];

export const SHORTCUTS: Shortcut[] = [
  { id: 'dashboard', permissionKey: 'dashboard', icon: 'th-large', label: 'Dashboard', href: '/' },
  { id: 'tasks', permissionKey: '', icon: 'check-square-o', label: 'Tasks', href: '/tasks' },
  { id: 'search', permissionKey: '', icon: 'search', label: 'Search', href: '/search' },
  { id: 'deadlines', permissionKey: '', icon: 'calendar-o', label: 'Deadlines', href: '/deadlines' },
  // project.view, not project.edit: reading the projects list has never required
  // edit rights anywhere else. rpc_projects_table gates on project.view,
  // projects_select is fn_project_accessible, and app/(tabs)/menu.tsx already
  // used view — this entry was the outlier, and it meant a view-only user saw
  // Portfolios (correctly gated on view) but not the Projects inside them.
  { id: 'projects', permissionKey: 'project.view', icon: 'folder-o', label: 'Projects', href: '/projects' },
  // Icon/kind match components/entities/EntityUI.tsx's canonical portfolio
  // glyph (ENTITY_META.portfolio.icon === 'cubes') — same glyph the
  // /portfolios screen itself headers with. Gated on project.view: the same
  // permission rpc_portfolios_table and fn_project_accessible enforce
  // server-side, so a user without it never sees the entry point.
  { id: 'portfolios', permissionKey: 'project.view', icon: 'cubes', label: 'Portfolios', href: '/portfolios' },
  { id: 'radar', permissionKey: '', anyPermissions: INTELLIGENCE_PERMISSIONS, icon: 'bullseye', label: 'Intelligence', href: '/intelligence' },
  { id: 'filehub', permissionKey: 'filehub:view', icon: 'folder-open-o', label: 'File Hub', href: '/filehub' },
  { id: 'team', permissionKey: 'user.view_all', fallbackPermissionKey: 'role.manage', icon: 'briefcase', label: 'Corporate', href: '/people?section=teams' },
  { id: 'pipelines-admin', permissionKey: 'pipeline.edit', icon: 'code-fork', label: 'Pipelines', href: '/admin/pipelines' },
];

// "Can this user see this shortcut?" — the desktop nav rail (Sidebar.web.tsx)
// and the command palette (CommandPalette.web.tsx) both need this exact test.
// One predicate, two callers: don't inline the boolean in a third place.
export function shortcutVisible(
  s: Shortcut,
  ctx: { hasPermission: (key: string) => boolean; isOwner: boolean; isMobile: boolean }
): boolean {
  const { hasPermission, isOwner, isMobile } = ctx;
  return (
    s.id === 'dashboard' ||
    s.id === 'tasks' ||
    // Search/Deadlines already have a desktop entry point (topbar search,
    // topbar calendar strip) — only surface these as shortcuts on mobile web.
    (isMobile && (s.id === 'search' || s.id === 'deadlines')) ||
    (isOwner && (s.id === 'team' || s.id === 'pipelines-admin')) ||
    (s.anyPermissions ? s.anyPermissions.some((p) => hasPermission(p)) : false) ||
    (!!s.permissionKey && hasPermission(s.permissionKey)) ||
    (!!s.fallbackPermissionKey && hasPermission(s.fallbackPermissionKey))
  );
}
