export type CapabilityName =
  | 'task.create'
  | 'project.create'
  | 'portfolio.create'
  | 'report.generate'
  | 'role.create'
  | 'upload.create';

export type CapabilityReason =
  | 'allowed'
  | 'unknown-capability'
  | 'profile-missing'
  | 'permissions-loading'
  | 'permission-denied'
  | 'billing-loading'
  | 'billing-error'
  | 'billing-inactive'
  | 'billing-limit-missing';

export type CapabilityDecision = {
  allowed: boolean;
  loading: boolean;
  reason: CapabilityReason;
};

export type CapabilityRequirement = {
  anyPermission: readonly string[];
  ownerCanUse?: boolean;
  billingLimit?: string;
};

/** Command-palette action requirements. Keep permissions aligned with their direct UI gates. */
export const CAPABILITY_REQUIREMENTS: Readonly<Record<CapabilityName, CapabilityRequirement>> = Object.freeze({
  'task.create': { anyPermission: ['task.create'] },
  'project.create': { anyPermission: ['project.create'] },
  // Portfolio creation currently shares the projects surface and its project.create gate.
  'portfolio.create': { anyPermission: ['project.create'] },
  'report.generate': {
    anyPermission: ['report.generate'],
    ownerCanUse: true,
    billingLimit: 'analytics_reports',
  },
  'role.create': { anyPermission: ['role.manage'] },
  'upload.create': { anyPermission: ['filehub:view'] },
});

export type CapabilityContext = {
  profile: { id?: string | null; company_id?: string | null; is_owner?: boolean | null } | null | undefined;
  permissionsLoaded: boolean;
  permissions: readonly string[] | null | undefined;
  billing: {
    loading: boolean;
    error: unknown;
    status: unknown;
    limits: unknown;
  };
};

const deny = (reason: Exclude<CapabilityReason, 'allowed'>, loading = false): CapabilityDecision => ({
  allowed: false,
  loading,
  reason,
});

const hasValidPermissions = (permissions: unknown): permissions is readonly string[] =>
  Array.isArray(permissions) && permissions.every((permission) => typeof permission === 'string');

const evaluateKnownCapability = (
  name: CapabilityName,
  context: CapabilityContext,
  permissionSet: ReadonlySet<string> | null,
): CapabilityDecision => {
  const requirement = CAPABILITY_REQUIREMENTS[name];
  if (!context.profile?.id || !context.profile.company_id) return deny('profile-missing');
  if (!context.permissionsLoaded) return deny('permissions-loading', true);
  if (!permissionSet) return deny('permission-denied');
  const ownerAllowed = requirement.ownerCanUse === true && context.profile.is_owner === true;
  if (!ownerAllowed && !requirement.anyPermission.some((permission) => permissionSet.has(permission))) {
    return deny('permission-denied');
  }

  if (requirement.billingLimit) {
    if (context.billing.loading) return deny('billing-loading', true);
    if (context.billing.error) return deny('billing-error');
    if (context.billing.status !== 'active') return deny('billing-inactive');
    const limits = context.billing.limits;
    if (!limits || typeof limits !== 'object'
        || (limits as Record<string, unknown>)[requirement.billingLimit] !== true) {
      return deny('billing-limit-missing');
    }
  }

  return { allowed: true, loading: false, reason: 'allowed' };
};

/** Pure deterministic decision for one named capability. Unregistered names always deny. */
export function decideCapability(name: string, context: CapabilityContext): CapabilityDecision {
  if (!Object.prototype.hasOwnProperty.call(CAPABILITY_REQUIREMENTS, name)) return deny('unknown-capability');
  const permissionSet = context.permissionsLoaded && hasValidPermissions(context.permissions)
    ? new Set(context.permissions)
    : null;
  return evaluateKnownCapability(name as CapabilityName, context, permissionSet);
}

/** Evaluates many capabilities against one context, normalizing permissions only once. */
export function decideCapabilities(
  names: readonly string[],
  context: CapabilityContext,
): Record<string, CapabilityDecision> {
  const permissionSet = context.permissionsLoaded && hasValidPermissions(context.permissions)
    ? new Set(context.permissions)
    : null;
  const decisions: Record<string, CapabilityDecision> = {};
  for (const name of names) {
    decisions[name] = Object.prototype.hasOwnProperty.call(CAPABILITY_REQUIREMENTS, name)
      ? evaluateKnownCapability(name as CapabilityName, context, permissionSet)
      : deny('unknown-capability');
  }
  return decisions;
}
