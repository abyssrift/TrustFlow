import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

for (const variant of ['desktop', 'adaptive']) {
  const source = readFileSync(resolve(`components/intelligence/_ReportGenerator_${variant}.tsx`), 'utf8')
  const handlerStart = source.indexOf('const handleGenerateReport = async () => {')
  const requestStart = source.indexOf("supabase.rpc('rpc_request_report'", handlerStart)
  assert.ok(handlerStart >= 0 && requestStart > handlerStart, `${variant}: report job request must be in the generation handler`)

  const handler = source.slice(handlerStart, requestStart)
  const validation = handler.indexOf('normalizeReportTimeframe(')
  const invalidGuard = handler.indexOf('if (!normalized.ok)')
  const expansion = handler.indexOf('const expanded = expandJobs(')
  assert.ok(validation >= 0 && validation < invalidGuard, `${variant}: custom date validation must run before job planning`)
  assert.ok(invalidGuard >= 0 && invalidGuard < expansion, `${variant}: invalid dates must return before job expansion`)
  assert.match(handler.slice(invalidGuard, expansion), /setGenError\(normalized\.error\.message\)[\s\S]*?return/)
  assert.match(source, /params\.date_end_exclusive = dateEndExclusiveParam/)
  assert.match(source, /params\.date_start_local = dateStartLocalParam/)
  assert.match(source, /params\.date_end_local = dateEndLocalParam/)
  assert.match(source, /params\.timezone = timezone/)
}

const generator = readFileSync(resolve('components/intelligence/reports/generate.ts'), 'utf8')
assert.match(generator, /p\.date_end_exclusive[\s\S]*?\.lt\('completed_at', p\.date_end_exclusive\)/)
assert.match(generator, /p_from: p\.date_start_local \|\| p\.date_start,\s*p_to: p\.date_end_local \|\| p\.date_end/)
