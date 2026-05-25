import { SupabaseClient } from '@supabase/supabase-js'

export async function generateAndUploadReport(
  _jobId: string,
  _reportType: string,
  _parameters: any,
  _sb: SupabaseClient,
  _userId: string,
  _companyId: string,
): Promise<string> {
  throw new Error('PDF generation is not supported on native platforms')
}
