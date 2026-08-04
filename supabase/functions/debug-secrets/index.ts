// Decommissioned diagnostic. Returns 410 Gone.
//
// Captured from PRODUCTION on 2026-08-04 (#178): this function was live with
// no source in the repo, which is why it kept showing up as drift. It is
// already inert -- the body below is exactly what is deployed -- and it runs
// with verify_jwt=true. Committed rather than deleted so the slug stays
// accounted for; delete the deployment when someone is confident nothing calls
// it and remove this directory in the same change.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
serve(() => new Response('Gone', { status: 410 }))
