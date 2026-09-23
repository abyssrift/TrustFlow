import { describe, expect, it } from 'vitest';
import {
  GUIDE_REGISTRY,
  GUIDE_PHASES,
  type GuideRowStatus,
  clampGuideStep,
  eligibleGuides,
  eligibleGuidePhases,
  filterEligibleProgress,
  getGuideStatusLabel,
  getNewGuideIds,
  getSubtleNewGuideIds,
  isGuideNew,
  getGuideForRoute,
  visibleGuides,
} from './contextualGuides';
import { getShortcut, shortcutVisible } from '@/components/sidebar/constants';

const ready = (permissions: string[] = [], isOwner = false) => ({
  authenticated: true,
  profileReady: true,
  accessReady: true,
  hasPermission: (key: string) => permissions.includes(key),
  isOwner,
  isMobile: false,
});

describe('contextual guide registry', () => {
  it('finds the first eligible guide with an exact pathname and declared query params', () => {
    const eligible = eligibleGuides(ready(['user.view_all', 'role.manage']));

    expect(getGuideForRoute(eligible, '/tasks', {} )?.id).toBe('tasks');
    expect(getGuideForRoute(eligible, '/people', { section: 'teams' })?.id).toBe('team-people');
    expect(getGuideForRoute(eligible, '/people', { section: 'people' })).toBeNull();
    expect(getGuideForRoute(eligible, '/tasks/details', {})).toBeNull();
  });

  it('provides a deep, screen-grounded curriculum grouped into ordered phases', () => {
    expect(GUIDE_REGISTRY.length).toBeGreaterThanOrEqual(12);
    expect(GUIDE_PHASES.length).toBeGreaterThanOrEqual(3);
    for (const guide of GUIDE_REGISTRY) {
      expect(guide.version).toBeGreaterThan(0);
      expect(guide.steps.length).toBeGreaterThanOrEqual(3);
      expect(guide.phaseId).toBeTruthy();
      expect(guide.order).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify({ title: guide.title, summary: guide.summary, steps: guide.steps })).not.toMatch(/permission|\.view|\.edit|role\.manage/i);
      for (const step of guide.steps) {
        expect(step.anchorId == null || step.anchorId.startsWith(`${guide.id}:`)).toBe(true);
      }
    }
  });

  it('keeps universal guides stable while capability guides appear with navigation access', () => {
    const baseline = eligibleGuides(ready());
    const expanded = eligibleGuides(ready(['filehub:view', 'user.view_all', 'pipeline.edit'], true));
    expect(baseline.filter((guide) => guide.scope === 'universal').map(({ id }) => id))
      .toEqual(expanded.filter((guide) => guide.scope === 'universal').map(({ id }) => id));
    expect(expanded.length).toBeGreaterThan(baseline.length);
    expect(eligibleGuides({ ...ready(), authenticated: false })).toEqual([]);
    expect(eligibleGuides({ ...ready(), profileReady: false })).toEqual([]);
    expect(eligibleGuides({ ...ready(), accessReady: false })).toEqual([]);
  });

  it('derives phase order and new capability content without reclassifying familiar guides', () => {
    const before = eligibleGuides(ready());
    const after = eligibleGuides(ready(['filehub:view', 'user.view_all']));
    const phases = eligibleGuidePhases(after);
    expect(phases.map(({ id }) => id)).toEqual(GUIDE_PHASES.map(({ id }) => id).filter((id) => phases.some((phase) => phase.id === id)));
    expect(getNewGuideIds(before, after)).toEqual(after.filter((guide) => !before.some((old) => old.id === guide.id)).map(({ id }) => id));
    expect(getNewGuideIds(after, before)).toEqual([]);
  });

  it('tracks navigation visibility against the shared shortcut rules', () => {
    const contexts = [ready(), ready(['filehub:view']), ready(['user.view_all']), ready(['pipeline.edit']), { ...ready(), isOwner: true }, { ...ready(), isMobile: true }, ready(['filehub:view', 'user.view_all', 'pipeline.edit'], true)];
    for (const context of contexts) {
      const eligibleIds = new Set(eligibleGuides(context).map(({ id }) => id));
      for (const guide of GUIDE_REGISTRY.filter(({ shortcutId }) => shortcutId)) {
        const shortcut = getShortcut(guide.shortcutId!);
        expect(eligibleIds.has(guide.id)).toBe(!!shortcut && shortcutVisible(shortcut, context) && (!guide.eligibilityPermission || context.hasPermission(guide.eligibilityPermission)));
      }
    }
  });

  it('shows deadlines only on the mobile surface and keeps them off desktop', () => {
    const desktopIds = new Set(eligibleGuides(ready()).map(({ id }) => id));
    const mobileIds = new Set(eligibleGuides({ ...ready(), isMobile: true }).map(({ id }) => id));

    expect(desktopIds.has('deadlines')).toBe(false);
    expect(mobileIds.has('deadlines')).toBe(true);
  });

  it('requires assignment management access while preserving view-only team directory access', () => {
    const viewerIds = new Set(eligibleGuides(ready(['user.view_all'])).map(({ id }) => id));
    const managerIds = new Set(eligibleGuides(ready(['user.view_all', 'role.manage'])).map(({ id }) => id));

    expect(viewerIds.has('team-people')).toBe(true);
    expect(viewerIds.has('team-assignments')).toBe(false);
    expect(managerIds.has('team-people')).toBe(true);
    expect(managerIds.has('team-assignments')).toBe(true);
  });

  it('keeps skip as an acknowledged not-started state and derives status labels', () => {
    expect(getGuideStatusLabel('not_started')).toBe('Not started');
    expect(getGuideStatusLabel('in_progress')).toBe('In progress');
    expect(getGuideStatusLabel('done')).toBe('Done');
    const familiar: GuideRowStatus = 'familiar';
    expect(getGuideStatusLabel(familiar)).toBe('Familiar');
    expect(isGuideNew({ acknowledgedAt: null })).toBe(true);
    expect(isGuideNew({ acknowledgedAt: '2026-09-20T00:00:00Z' })).toBe(false);
    expect(clampGuideStep('tasks', -3)).toBe(0);
    expect(clampGuideStep('tasks', 99)).toBe(GUIDE_REGISTRY.find((guide) => guide.id === 'tasks')!.steps.length - 1);
  });

  it('filters displayed progress without mutating stored progress', () => {
    const definitions = eligibleGuides(ready());
    const supplied = { tasks: { guideId: 'tasks', status: 'done' }, filehub: { guideId: 'filehub', status: 'in_progress' } } as any;
    expect(filterEligibleProgress(supplied, definitions)).toEqual({ tasks: supplied.tasks });
    expect(supplied.filehub).toBeDefined();
  });

  it('hides completed and familiar rows by default but supports explicit rediscovery', () => {
    const definitions = eligibleGuides(ready());
    const progress = {
      profile: { status: 'done' },
      'top-bar': { status: 'familiar' },
      tasks: { status: 'in_progress' },
    } as any;
    expect(visibleGuides(definitions, progress).map(({ id }) => id)).not.toContain('profile');
    expect(visibleGuides(definitions, progress).map(({ id }) => id)).not.toContain('top-bar');
    expect(visibleGuides(definitions, progress, { rediscoverIds: ['profile', 'top-bar'] }).map(({ id }) => id))
      .toEqual(expect.arrayContaining(['profile', 'top-bar']));
  });

  it('marks only newly accessible, unacknowledged capability guides as subtly new', () => {
    const before = eligibleGuides(ready());
    const after = eligibleGuides(ready(['filehub:view', 'user.view_all']));
    const progress = Object.fromEntries(after.map((guide) => [guide.id, {
      guideId: guide.id, guideVersion: guide.version, status: 'not_started', acknowledgedAt: null,
    }]));
    expect(getSubtleNewGuideIds(before, after, progress)).toContain('filehub');
    expect(getSubtleNewGuideIds(before, after, progress)).not.toContain('profile');
    expect(getSubtleNewGuideIds(before, after, {
      ...progress,
      filehub: { ...progress.filehub, status: 'done' },
      'team-people': { ...progress['team-people'], acknowledgedAt: '2026-09-20T00:00:00Z' },
    } as any)).not.toContain('filehub');
    expect(getSubtleNewGuideIds(after, after, progress)).toEqual([]);
  });
});

describe('guide copy', () => {
  it('is plain printable text so a wrong-codepage paste cannot ship as garbled characters', () => {
    for (const guide of GUIDE_REGISTRY) {
      for (const text of [guide.title, guide.summary, ...guide.steps.flatMap((step) => [step.title, step.body])]) {
        expect(text, `${guide.id}: ${text}`).toMatch(/^[\x20-\x7E]+$/);
      }
    }
  });
});
