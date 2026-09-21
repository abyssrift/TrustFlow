export type AnalyticsCacheScopeInput = {
  userId: string | null
  companyId: string | null
  permissions: readonly string[]
  roleIds: readonly string[]
  permissionsLoaded: boolean
}

export function buildAnalyticsCacheScopeIdentity(scope: AnalyticsCacheScopeInput): string {
  return JSON.stringify([
    scope.userId,
    scope.companyId,
    [...scope.permissions].sort(),
    [...scope.roleIds].sort(),
    scope.permissionsLoaded,
  ])
}

export function buildAnalyticsCacheKey(
  scope: AnalyticsCacheScopeInput,
  logicalKey: string,
): string {
  return JSON.stringify([buildAnalyticsCacheScopeIdentity(scope), logicalKey])
}

export function analyticsCacheKeyMatchesPrefix(scopedKey: string, prefix: string): boolean {
  try {
    const tuple = JSON.parse(scopedKey) as unknown[]
    return typeof tuple[1] === 'string' && tuple[1].startsWith(prefix)
  } catch {
    return false
  }
}
