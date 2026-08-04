# `supabase/_archive/`

Source for edge functions that were **deployed to production but never existed
in this repo**, captured before being deleted from production.

**Nothing in here is deployed.** The Supabase CLI only deploys from
`supabase/functions/`, which is exactly why these live one directory over — an
archived function must not be resurrected by someone running a bulk deploy.

Each was pulled with:

```
supabase functions download <slug> --project-ref wbvgufqfgbvbinjrdzlg
```

(The CLI parses `supabase/config.toml` first and v2.97.0 rejects the
`[local_smtp]` key this project uses, so the download was run against a scratch
workdir holding a one-line config, and the result copied here.)

---

## `generate-pdf-report-v8` — deleted from production 2026-08-04

A server-side PDF report worker. Took `{ job_id }`, read `reporting_jobs`, built
one of ten report types with jsPDF, uploaded to `reports/${company_id}/${job_id}.pdf`
and marked the job completed. Last deployed **2026-05-14**.

**Superseded.** `components/intelligence/reports/generate.ts` does the identical
job in the client — same `reporting_jobs` lifecycle, same storage path, same
`upsert: true`. Nothing in the codebase referenced the edge function; it had
been dead for roughly three months.

**Why it was deleted rather than left alone.** It was `verify_jwt = false`,
ran with the service-role key, and performed **no authorization check of any
kind** — it read `job_id` straight out of the request body and acted on it. So
anyone on the internet holding a job id could flip that job's status, and
overwrite the finished PDF at `${company_id}/${job_id}.pdf` in the `reports`
bucket, for **any tenant**. Job ids are returned to clients. A dead endpoint is
not a harmless one when it is an unauthenticated cross-tenant write primitive.

Restoring it, should that ever be wanted, means copying this directory back
under `supabase/functions/` **and** adding the caller check it never had.

## `purge-ksa-templates-cleanup` — deleted from production 2026-08-04

A one-off cleanup for an orphaned damaged file, confirmed spent by the repo
owner. Not archived: it hard-deleted every `filehub_files` and `filehub_folders`
row for a single hardcoded group id plus their storage objects, with the
service-role key, `verify_jwt = true`, and no authorization check — so any
signed-in user of any tenant could fire it. The target group still exists, which
made it armed rather than spent. Nothing here is worth keeping; the shape is
recorded in `security_local_clone_drives_prod` and in issue #178.
