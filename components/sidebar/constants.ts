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
  // Synonyms the command palette matches on in addition to `label` — so a user
  // who types the concept ("teams", "calendar") still lands the page whose
  // title is something else ("Corporate", "Deadlines"). Top-level only; deeper
  // destinations live in PALETTE_DESTINATIONS below.
  keywords?: string[];
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
  { id: 'dashboard', permissionKey: 'dashboard', icon: 'th-large', label: 'Dashboard', href: '/', keywords: ['home', 'overview', 'widgets'] },
  { id: 'tasks', permissionKey: '', icon: 'check-square-o', label: 'Tasks', href: '/tasks', keywords: ['todo', 'todos', 'work', 'board', 'kanban'] },
  { id: 'search', permissionKey: '', icon: 'search', label: 'Search', href: '/search', keywords: ['find', 'lookup'] },
  { id: 'deadlines', permissionKey: '', icon: 'calendar-o', label: 'Deadlines', href: '/deadlines', keywords: ['calendar', 'due', 'timeline', 'schedule'] },
  // project.view, not project.edit: reading the projects list has never required
  // edit rights anywhere else. rpc_projects_table gates on project.view,
  // projects_select is fn_project_accessible, and app/(tabs)/menu.tsx already
  // used view — this entry was the outlier, and it meant a view-only user saw
  // Portfolios (correctly gated on view) but not the Projects inside them.
  { id: 'projects', permissionKey: 'project.view', icon: 'folder-o', label: 'Projects', href: '/projects', keywords: ['clients', 'engagements'] },
  // Icon/kind match components/entities/EntityUI.tsx's canonical portfolio
  // glyph (ENTITY_META.portfolio.icon === 'cubes') — same glyph the
  // /portfolios screen itself headers with. Gated on project.view: the same
  // permission rpc_portfolios_table and fn_project_accessible enforce
  // server-side, so a user without it never sees the entry point.
  { id: 'portfolios', permissionKey: 'project.view', icon: 'cubes', label: 'Portfolios', href: '/portfolios', keywords: ['batch', 'batches', 'programs'] },
  { id: 'radar', permissionKey: '', anyPermissions: INTELLIGENCE_PERMISSIONS, icon: 'bullseye', label: 'Intelligence', href: '/intelligence', keywords: ['analytics', 'insights', 'radar', 'metrics', 'hub'] },
  { id: 'filehub', permissionKey: 'filehub:view', icon: 'folder-open-o', label: 'File Hub', href: '/filehub', keywords: ['files', 'documents', 'attachments', 'storage', 'uploads'] },
  { id: 'team', permissionKey: 'user.view_all', fallbackPermissionKey: 'role.manage', icon: 'briefcase', label: 'Corporate', href: '/people?section=teams', keywords: ['teams', 'org', 'members', 'staff', 'people', 'directory'] },
  { id: 'pipelines-admin', permissionKey: 'pipeline.edit', icon: 'code-fork', label: 'Pipelines', href: '/admin/pipelines', keywords: ['workflow', 'stages', 'automation', 'admin'] },
];

// Deeper, keyword-indexed jump targets — the sub-features that live *inside* a
// top-level page, so a search for the concept ("compare", "rbac", "pdf") lands
// the right screen even though it has no rail entry of its own. This is the ONE
// place sub-destinations are declared for the palette.
//
// ponytail: `_IntelligenceDesktopLayout.tsx` NAV and `app/(tabs)/menu.tsx`
// MENU_ITEMS still keep their own copies of these routes. They should
// eventually import label/href/icon/permission from here — not refactored now,
// just flagged so the next person touching either one folds them in.
export type PaletteDestination = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  keywords: string[];
  parentLabel?: string;
  permission?: string;
  anyPermissions?: string[];
};

export const PALETTE_DESTINATIONS: PaletteDestination[] = [
  // Intelligence hub sub-nav (source: components/intelligence/_IntelligenceDesktopLayout.tsx NAV).
  // Overview is omitted on purpose — its href is the `radar` shortcut above.
  { id: 'intel-performance', parentLabel: 'Intelligence', label: 'Performance', href: '/intelligence/graphs', icon: 'line-chart', permission: 'analytics.view', keywords: ['graphs', 'trends', 'throughput', 'velocity', 'charts'] },
  { id: 'intel-targets', parentLabel: 'Intelligence', label: 'Targets', href: '/intelligence/targets', icon: 'bullseye', permission: 'target.view', keywords: ['goals', 'okr', 'objectives', 'kpi', 'quota'] },
  { id: 'intel-reports', parentLabel: 'Intelligence', label: 'Reports', href: '/intelligence/reports', icon: 'file-pdf-o', permission: 'report.view', keywords: ['pdf', 'export', 'architect', 'generate', 'summary'] },
  { id: 'intel-analytics', parentLabel: 'Intelligence', label: 'Analytics', href: '/intelligence/analytics', icon: 'bar-chart', permission: 'analytics.view', keywords: ['compare', 'comparison', 'worker', 'team', 'versus', 'benchmark'] },
  { id: 'intel-archives', parentLabel: 'Intelligence', label: 'Cold Storage', href: '/intelligence/archives', icon: 'archive', permission: 'archive.view', keywords: ['archive', 'archived', 'storage', 'deleted', 'old'] },
  // Admin (source: grep of app/admin/* permission gates).
  { id: 'admin-roles', parentLabel: 'Admin', label: 'Roles & Permissions', href: '/admin/roles', icon: 'shield', permission: 'role.manage', keywords: ['roles', 'permissions', 'rbac', 'access', 'mandate'] },
  { id: 'admin-notifications', parentLabel: 'Admin', label: 'Notifications', href: '/admin/notifications', icon: 'bell-o', permission: 'manage_notifications', keywords: ['alerts', 'notify', 'rules', 'ping', 'email'] },
];

export type DestinationMatch = {
  id: string;
  label: string;
  href: string;
  icon: IconName;
  parentLabel?: string;
  topLevel: boolean;
  // The synonym that matched when the visible label itself did not — lets the
  // palette show "Also known as: <matchedKeyword>" on the row.
  matchedKeyword?: string;
};

// Unified GO-TO source for the command palette: top-level SHORTCUTS (gated by
// shortcutVisible) + PALETTE_DESTINATIONS (gated by its own permission). Empty
// query → only the top-level pages (don't dump every sub-route). Non-empty →
// match `label` + `keywords` across both, deduped by href (top-level wins).
export function matchDestinations(
  rawQuery: string,
  ctx: { hasPermission: (key: string) => boolean; isOwner: boolean; isMobile: boolean }
): DestinationMatch[] {
  const q = (rawQuery || '').trim().toLowerCase();
  const visibleTop = SHORTCUTS.filter((s) => shortcutVisible(s, ctx));

  if (!q) {
    return visibleTop.map((s) => ({ id: s.id, label: s.label, href: s.href, icon: s.icon, topLevel: true }));
  }

  const hit = (label: string, keywords: string[] | undefined) => {
    if (label.toLowerCase().includes(q)) return { ok: true as const, kw: undefined };
    const kw = (keywords ?? []).find((k) => k.toLowerCase().includes(q));
    return kw ? { ok: true as const, kw } : { ok: false as const, kw: undefined };
  };

  const out: DestinationMatch[] = [];
  const seen = new Set<string>();

  for (const s of visibleTop) {
    const m = hit(s.label, s.keywords);
    if (!m.ok) continue;
    out.push({ id: s.id, label: s.label, href: s.href, icon: s.icon, topLevel: true, matchedKeyword: m.kw });
    seen.add(s.href);
  }

  for (const d of PALETTE_DESTINATIONS) {
    if (seen.has(d.href)) continue; // top-level already covers this href
    const gated = d.permission
      ? ctx.hasPermission(d.permission)
      : d.anyPermissions
      ? d.anyPermissions.some((p) => ctx.hasPermission(p))
      : true;
    if (!gated) continue;
    const m = hit(d.label, d.keywords);
    if (!m.ok) continue;
    out.push({ id: d.id, label: d.label, href: d.href, icon: d.icon, parentLabel: d.parentLabel, topLevel: false, matchedKeyword: m.kw });
    seen.add(d.href);
  }

  return out;
}

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
