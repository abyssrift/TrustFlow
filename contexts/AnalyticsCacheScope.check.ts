import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve('contexts/AnalyticsContext.tsx'), 'utf8')
assert.match(source, /useAuth\(\)/, 'analytics provider must use the authenticated scope')
assert.match(source, /buildAnalyticsCacheScopeIdentity\(/)
assert.match(source, /buildAnalyticsCacheKey\(/)
assert.match(source, /analyticsCacheKeyMatchesPrefix\(/, 'existing logical-key invalidation must remain scoped')
assert.match(source, /inFlight\.current\.clear\(\)/, 'scope changes must invalidate in-flight deduplication')
assert.match(source, /cache\.current\.clear\(\)/, 'scope changes must clear cached results')
assert.match(source, /scopeKeyRef\.current\s*===\s*scopeKey/, 'old requests must not repopulate a new identity cache')
