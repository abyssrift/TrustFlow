import { describe, expect, it } from 'vitest'
import {
  buildAnalyticsCacheKey,
  buildAnalyticsCacheScopeIdentity,
  analyticsCacheKeyMatchesPrefix,
  type AnalyticsCacheScopeInput,
} from './analyticsCache'

const scope: AnalyticsCacheScopeInput = {
  userId: 'user-1',
  companyId: 'company-1',
  permissions: ['analytics.read', 'projects.read'],
  roleIds: ['role-1', 'role-2'],
  permissionsLoaded: true,
}

describe('analytics cache scope and key helpers', () => {
  it('reuses the same key for the same scope and logical key', () => {
    expect(buildAnalyticsCacheKey(scope, 'summary')).toBe(
      buildAnalyticsCacheKey({ ...scope }, 'summary'),
    )
  })

  it('changes the scope identity when the user changes', () => {
    expect(buildAnalyticsCacheScopeIdentity({ ...scope, userId: 'user-2' })).not.toBe(
      buildAnalyticsCacheScopeIdentity(scope),
    )
  })

  it('changes the scope identity when the company changes', () => {
    expect(buildAnalyticsCacheScopeIdentity({ ...scope, companyId: 'company-2' })).not.toBe(
      buildAnalyticsCacheScopeIdentity(scope),
    )
  })

  it('changes the scope identity when permissions or roles change', () => {
    expect(
      buildAnalyticsCacheScopeIdentity({ ...scope, permissions: ['analytics.read'] }),
    ).not.toBe(buildAnalyticsCacheScopeIdentity(scope))
    expect(buildAnalyticsCacheScopeIdentity({ ...scope, roleIds: ['role-1'] })).not.toBe(
      buildAnalyticsCacheScopeIdentity(scope),
    )
  })

  it('changes the scope identity when permissions finish loading', () => {
    expect(
      buildAnalyticsCacheScopeIdentity({ ...scope, permissionsLoaded: false }),
    ).not.toBe(buildAnalyticsCacheScopeIdentity(scope))
  })

  it('ignores ordering differences in permissions and roles', () => {
    expect(
      buildAnalyticsCacheScopeIdentity({
        ...scope,
        permissions: [...scope.permissions].reverse(),
        roleIds: [...scope.roleIds].reverse(),
      }),
    ).toBe(buildAnalyticsCacheScopeIdentity(scope))
  })

  it('keeps scope and logical key boundaries collision-free', () => {
    expect(buildAnalyticsCacheKey(scope, 'a:b')).not.toBe(
      buildAnalyticsCacheKey({ ...scope, userId: 'user-1:a' }, 'b'),
    )
  })

  it('matches invalidation prefixes against the logical key only', () => {
    expect(analyticsCacheKeyMatchesPrefix(buildAnalyticsCacheKey(scope, 'series:user-1:month'), 'series:user-1')).toBe(true)
    expect(analyticsCacheKeyMatchesPrefix(buildAnalyticsCacheKey(scope, 'pulse'), 'series:')).toBe(false)
    expect(analyticsCacheKeyMatchesPrefix('not-json', 'series:')).toBe(false)
  })
})
