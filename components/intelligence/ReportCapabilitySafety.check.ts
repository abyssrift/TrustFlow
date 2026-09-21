import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const capability = readFileSync(resolve('lib/capabilities.ts'), 'utf8')
const generateRequirement = capability.slice(capability.indexOf("'report.generate':"), capability.indexOf("'role.create':"))
assert.match(generateRequirement, /anyPermission:\s*\['report\.generate'\]/)
assert.match(generateRequirement, /ownerCanUse:\s*true/)
assert.doesNotMatch(generateRequirement, /report\.(?:view|export)/)

const migration = readFileSync(resolve('supabase/migrations/20260915124000_report_capability_enforcement.sql'), 'utf8')
const capabilityRpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.rpc_has_capability'), migration.indexOf('REVOKE ALL ON FUNCTION public.rpc_has_capability'))
assert.match(capabilityRpc, /u\.is_owner = true\) OR public\.has_permission\('report\.generate'\)/)
assert.doesNotMatch(capabilityRpc, /report\.(?:view|export)/)
assert.match(migration, /v_safe_parameters := public\.rpc_redact_report_parameters/)
assert.match(migration, /VALUES \(v_company_id, auth\.uid\(\), p_report_type, v_safe_parameters\)/)
assert.match(migration, /'report\.requested', v_safe_parameters\)/)

for (const variant of ['desktop', 'adaptive']) {
  const source = readFileSync(resolve(`components/intelligence/_ReportGenerator_${variant}.tsx`), 'utf8')
  const handler = source.slice(source.indexOf('const handleGenerateReport = async () => {'))
  assert.match(handler, /const persistedParams = redactSensitiveReportParameters\(taggedParams\)/)
  assert.match(handler, /p_parameters:\s*persistedParams/)
  assert.match(handler, /generateAndUploadReport\(jobId, reportType, taggedParams/)
  assert.doesNotMatch(source, /params\.salaries\s*=/)
  assert.doesNotMatch(source, /setParam\('salaries'/)
  assert.match(source, /editable=\{false\}[\s\S]*?placeholder="Unavailable"/)
}

const generator = readFileSync(resolve('components/intelligence/reports/generate.ts'), 'utf8')
assert.match(generator, /p_user_ids: p\.user_ids, p_from: p\.date_start, p_to: p\.date_end, p_salaries: \{\}/)
assert.doesNotMatch(generator, /p_salaries:\s*p\.salaries/)
const personnelReport = readFileSync(resolve('components/intelligence/reports/PersonnelReport.tsx'), 'utf8')
assert.match(personnelReport, /const costRows: any\[\] = \[\]/)
console.log('Report capability and persisted-parameter safety checks passed.')
