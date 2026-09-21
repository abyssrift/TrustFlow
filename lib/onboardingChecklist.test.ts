import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_CHECKLIST_CATALOG_KEY,
  ONBOARDING_CHECKLIST_PHASES,
  deriveOnboardingChecklist,
  getNewChecklistItems,
  parseOnboardingChecklistCatalogEntry,
} from './onboardingChecklist';

describe('phased onboarding checklist catalog adapter', () => {
  it('keeps workspace-ready items catalog ordered and backward compatible', () => {
    const result = parseOnboardingChecklistCatalogEntry({ catalog_key: ONBOARDING_CHECKLIST_CATALOG_KEY, version: 1, payload: { schema_version: 1, items: [{ key: 'workflow', title: 'Main Workflow', description: 'Edit it later.' }, { key: 'owner', title: 'Owner access', description: 'Full access.' }] } });
    expect(result.items.map(({ key }) => key)).toEqual(['workflow', 'owner']);
  });

  it('rejects an invalid published checklist payload', () => {
    expect(() => parseOnboardingChecklistCatalogEntry({ catalog_key: ONBOARDING_CHECKLIST_CATALOG_KEY, version: 1, payload: { schema_version: 2, items: [] } })).toThrow('Invalid onboarding checklist catalog entry');
  });

  it('derives phase order, eligibility and subtle new content from a catalog', () => {
    const catalog = parseOnboardingChecklistCatalogEntry({
      catalog_key: ONBOARDING_CHECKLIST_CATALOG_KEY,
      version: 2,
      payload: { schema_version: 1, items: [
        { key: 'invite', title: 'Invite a teammate', description: 'Bring someone into the workspace.', phase: 'collaborate', order: 2, capability: 'people' },
        { key: 'profile', title: 'Set up your profile', description: 'Add your details.', phase: 'start', order: 1 },
        { key: 'tasks', title: 'Find your work', description: 'Open your tasks.', phase: 'start', order: 2 },
        { key: 'files', title: 'Share files', description: 'Keep files together.', phase: 'collaborate', order: 1, capability: 'filehub' },
      ] },
    });
    const phases = deriveOnboardingChecklist(catalog, new Set(['people']), new Set(['profile', 'tasks']));
    expect(phases.map(({ id }) => id)).toEqual(['start', 'collaborate']);
    expect(phases[0].items.map(({ key }) => key)).toEqual(['profile', 'tasks']);
    expect(phases[1].items.map(({ key }) => key)).toEqual(['invite']);
    expect(getNewChecklistItems(phases, new Set(['profile', 'tasks'])).map(({ key }) => key)).toEqual(['invite']);
    expect(ONBOARDING_CHECKLIST_PHASES.map(({ id }) => id)).toEqual(['start', 'collaborate', 'grow']);
  });

  it('preserves legacy items while sorting and filtering capability additions by catalog metadata', () => {
    const catalog = parseOnboardingChecklistCatalogEntry({
      catalog_key: ONBOARDING_CHECKLIST_CATALOG_KEY,
      version: 3,
      payload: { schema_version: 1, items: [
        { key: 'invite', title: 'Invite a teammate', description: 'Bring someone in.', phase: 'collaborate', order: 2, capability: 'people' },
        { key: 'profile', title: 'Set up your profile', description: 'Add your details.' },
        { key: 'task', title: 'Find your work', description: 'Open your task list.', phase: 'start', order: 1 },
        { key: 'files', title: 'Share files', description: 'Keep files together.', phase: 'collaborate', order: 1, capability: 'filehub' },
      ] },
    });
    const baseline = deriveOnboardingChecklist(catalog, new Set(), new Set());
    const expanded = deriveOnboardingChecklist(catalog, new Set(['people', 'filehub']), new Set(['profile', 'task']));
    expect(baseline.flatMap(({ items }) => items).map(({ key }) => key)).toEqual(['profile', 'task']);
    expect(expanded.flatMap(({ items }) => items).map(({ key }) => key)).toEqual(['profile', 'task', 'files', 'invite']);
    expect(getNewChecklistItems(expanded, new Set(['profile', 'task'])).map(({ key }) => key)).toEqual(['files', 'invite']);
    expect(getNewChecklistItems(expanded, new Set(['profile', 'task', 'files', 'invite']))).toEqual([]);
  });
});
