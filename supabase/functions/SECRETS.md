# Edge Function Secrets

Set all of these in:
**Supabase Dashboard → Project Settings → Edge Functions → Secrets**

---

## Required now (Phases 3–5)

| Secret | How to get it | Used by |
|--------|--------------|---------|
| `NOTIFY_INTERNAL_SECRET` | Run `openssl rand -base64 32` in your terminal | `notify`, `process-notification-event` |
| `RESEND_API_KEY` | resend.com → API Keys → Create API Key | `notify` |
| `FROM_EMAIL` | e.g. `TrustFlow <notifications@yourdomain.com>` — domain must be verified in Resend (Domains → Add → verify DNS TXT records) | `notify` |
| `APP_URL` | Your deployed app URL, e.g. `https://app.trustflow.io` | `notify` (email CTA button deep links) |
| `EXPO_ACCESS_TOKEN` | expo.dev → Account Settings → Access Tokens → Create | `notify` (Expo push receipt verification) |

## Required for Phase 6 (Web Push / VAPID)

| Secret | How to get it | Used by |
|--------|--------------|---------|
| `VAPID_PUBLIC_KEY` | `npx web-push generate-vapid-keys` | `notify`, client SW registration |
| `VAPID_PRIVATE_KEY` | same command as above | `notify` |
| `VAPID_SUBJECT` | `mailto:your@email.com` | `notify` |

The `VAPID_PUBLIC_KEY` also needs to be added to your `.env` file as:
```
EXPO_PUBLIC_VAPID_PUBLIC_KEY=<your public key>
```

## Auto-injected (no action needed)

These are provided by Supabase automatically to every Edge Function:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_ANON_KEY`
