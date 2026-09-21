import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_REQUIREMENTS,
  decideCapabilities,
  decideCapability,
  type CapabilityContext,
  type CapabilityName,
} from './capabilities';

const baseContext: CapabilityContext = {
  profile: { id: 'user-1', company_id: 'company-1' },
  permissionsLoaded: true,
  permissions: ['report.generate'],
  billing: {
    loading: false,
    error: null,
    status: 'active',
    limits: { analytics_reports: true },
  },
};

describe('capability requirements registry', () => {
  it('explicitly maps each command-palette create action to its canonical permission gate', () => {
    expect(CAPABILITY_REQUIREMENTS).toMatchObject({
      'task.create': { anyPermission: ['task.create'] },
      'project.create': { anyPermission: ['project.create'] },
      'portfolio.create': { anyPermission: ['project.create'] },
      'report.generate': {
        anyPermission: ['report.generate'],
        ownerCanUse: true,
        billingLimit: 'analytics_reports',
      },
      'role.create': { anyPermission: ['role.manage'] },
      'upload.create': { anyPermission: ['filehub:view'] },
    });
  });

  it.each([
    ['task.create', 'task.create'],
    ['project.create', 'project.create'],
    ['portfolio.create', 'project.create'],
    ['role.create', 'role.manage'],
    ['upload.create', 'filehub:view'],
  ] as const)('allows %s only with %s', (name, permission) => {
    expect(decideCapability(name, { ...baseContext, permissions: [permission] })).toMatchObject({
      allowed: true,
      loading: false,
      reason: 'allowed',
    });
    expect(decideCapability(name, { ...baseContext, permissions: [] })).toMatchObject({
      allowed: false,
      loading: false,
      reason: 'permission-denied',
    });
  });
});

describe('report.generate capability', () => {
  it('allows a loaded member with report access and the exact live report limit', () => {
    expect(decideCapability('report.generate', baseContext)).toEqual({
      allowed: true,
      loading: false,
      reason: 'allowed',
    });
  });

  it.each(['report.view', 'report.export'])('does not treat %s as report generation permission', (permission) => {
    expect(decideCapability('report.generate', {
      ...baseContext,
      permissions: [permission],
    })).toMatchObject({ allowed: false, reason: 'permission-denied' });
  });

  it('allows an active company owner without a report.generate role permission', () => {
    expect(decideCapability('report.generate', {
      ...baseContext,
      profile: { ...baseContext.profile, is_owner: true },
      permissions: [],
    })).toMatchObject({ allowed: true, reason: 'allowed' });
  });

  it('does not let owner status bypass the active report entitlement', () => {
    expect(decideCapability('report.generate', {
      ...baseContext,
      profile: { ...baseContext.profile, is_owner: true },
      permissions: [],
      billing: { ...baseContext.billing, status: 'past_due' },
    })).toMatchObject({ allowed: false, reason: 'billing-inactive' });
  });

  it.each([
    ['permissions loading', { permissionsLoaded: false }, 'permissions-loading'],
    ['billing loading', { billing: { ...baseContext.billing, loading: true } }, 'billing-loading'],
    ['billing error', { billing: { ...baseContext.billing, error: new Error('offline') } }, 'billing-error'],
    ['missing profile', { profile: null }, 'profile-missing'],
    ['inactive billing', { billing: { ...baseContext.billing, status: 'past_due' } }, 'billing-inactive'],
    ['malformed limit', { billing: { ...baseContext.billing, limits: { analytics_reports: 'true' } } }, 'billing-limit-missing'],
    ['missing permission', { permissions: [] }, 'permission-denied'],
  ])('denies when %s', (_label, override, reason) => {
    const context = { ...baseContext, ...override, billing: { ...baseContext.billing, ...(override as any).billing } };
    expect(decideCapability('report.generate', context as CapabilityContext)).toEqual({
      allowed: false,
      loading: reason.endsWith('loading'),
      reason,
    });
  });
});

describe('capability decisions fail closed', () => {
  it('denies unknown names', () => {
    expect(decideCapability('role.unknown', baseContext)).toMatchObject({
      allowed: false,
      loading: false,
      reason: 'unknown-capability',
    });
  });

  it.each([
    ['missing profile', { profile: null }],
    ['missing user id', { profile: { company_id: 'company-1' } }],
    ['missing company', { profile: { id: 'user-1' } }],
    ['permissions not loaded', { permissionsLoaded: false }],
    ['missing permissions', { permissions: undefined }],
    ['null permissions', { permissions: null }],
    ['non-array permissions', { permissions: 'task.create' }],
    ['malformed permission entries', { permissions: ['task.create', 7] }],
  ])('denies %s and never allows while loading', (_label, override) => {
    const context = { ...baseContext, ...override } as unknown as CapabilityContext;
    const result = decideCapability('task.create', context);
    expect(result.allowed).toBe(false);
    if ((override as { permissionsLoaded?: boolean }).permissionsLoaded === false) {
      expect(result).toMatchObject({ loading: true, reason: 'permissions-loading' });
    } else {
      expect(result.loading).toBe(false);
    }
  });

  it('computes several capabilities from one shared context in input order', () => {
    const names: CapabilityName[] = ['task.create', 'project.create', 'report.generate', 'role.create', 'upload.create'];
    const decisions = decideCapabilities(names, {
      ...baseContext,
      permissions: ['task.create', 'report.generate', 'role.manage'],
    });
    expect(Object.keys(decisions)).toEqual(names);
    expect(decisions).toMatchObject({
      'task.create': { allowed: true },
      'project.create': { allowed: false, reason: 'permission-denied' },
      'report.generate': { allowed: true },
      'role.create': { allowed: true },
      'upload.create': { allowed: false, reason: 'permission-denied' },
    });
  });

  it('does not let a report permission bypass missing billing entitlement', () => {
    expect(decideCapability('report.generate', {
      ...baseContext,
      billing: { ...baseContext.billing, limits: {} },
    })).toMatchObject({ allowed: false, reason: 'billing-limit-missing' });
  });
});
