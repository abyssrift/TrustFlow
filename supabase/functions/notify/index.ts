// ====================================================================
// notify — Notification dispatcher + email channel
// ====================================================================
//
// !! REQUIRED SECRETS — set these in Supabase Dashboard:
//    Project Settings → Edge Functions → Secrets
//
//   NOTIFY_INTERNAL_SECRET  — shared secret between this function and
//                             process-notification-event. Generate with:
//                             openssl rand -base64 32
//                             Without this, any caller can dispatch notifications.
//
//   RESEND_API_KEY          — from resend.com → API Keys.
//                             Without this, emails are silently skipped.
//
//   FROM_EMAIL              — must be a Resend-verified sender, e.g.:
//                             TrustFlow <notifications@yourdomain.com>
//                             Resend → Domains → Add Domain → verify DNS.
//
//   APP_URL                 — base URL of your deployed app, e.g.:
//                             https://app.trustflow.io
//                             Used for CTA deep-link buttons in emails.
//
// Phase 6 will also need VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT.
//
//   EXPO_ACCESS_TOKEN   — expo.dev → Account Settings → Access Tokens.
//                         Used when checking Expo push receipts (DeviceNotRegistered
//                         cleanup). The push send itself works without it, but
//                         stale tokens will accumulate without receipt checks.
//
// Phase 6 (web push — now implemented):
//   VAPID_PUBLIC_KEY    — base64url-encoded 65-byte uncompressed EC public key.
//   VAPID_PRIVATE_KEY   — base64url-encoded 32-byte EC private key.
//   VAPID_SUBJECT       — mailto: or https: URI identifying the sender,
//                         e.g.: mailto:admin@trustflow.io
//
//   Generate with:  npx web-push generate-vapid-keys
// ====================================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
// @deno-types="npm:@types/web-push"
import webpush from 'npm:web-push'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const NOTIFY_INTERNAL_SECRET = Deno.env.get('NOTIFY_INTERNAL_SECRET') ?? ''
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? ''
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'TrustFlow <notifications@trustflow.io>'
const APP_URL = Deno.env.get('APP_URL') ?? 'https://app.trustflow.io'
const EXPO_ACCESS_TOKEN = Deno.env.get('EXPO_ACCESS_TOKEN') ?? ''
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@trustflow.io'

// ── Entry point ──────────────────────────────────────────────────────
serve(async (req: Request) => {
  // Internal auth — only process-notification-event and trusted callers
  if (NOTIFY_INTERNAL_SECRET) {
    const auth = req.headers.get('Authorization') ?? ''
    if (auth !== `Bearer ${NOTIFY_INTERNAL_SECRET}`) {
      return respond({ error: 'unauthorized' }, 401)
    }
  }

  try {
    const { user_id, type, title, body, data } = await req.json()

    if (!user_id || !type || !title || !body) {
      return respond({ error: 'missing required fields: user_id, type, title, body' }, 400)
    }

    const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    // 1. Read user preferences — all-enabled if no row exists yet
    const { data: prefs } = await db
      .from('notification_preferences')
      .select('email_enabled, push_mobile_enabled, push_web_enabled')
      .eq('user_id', user_id)
      .single()

    const preferences = {
      email_enabled: prefs?.email_enabled ?? true,
      push_mobile_enabled: prefs?.push_mobile_enabled ?? true,
      push_web_enabled: prefs?.push_web_enabled ?? true,
    }

    // 2. Write the audit record before any fan-out begins
    const { data: notification, error: insertErr } = await db
      .from('notifications')
      .insert({ user_id, type, title, body, data: data ?? {} })
      .select('id')
      .single()

    if (insertErr) throw insertErr

    // 3. Fan out to enabled channels — failures are isolated
    const channelResults = await Promise.allSettled([
      preferences.email_enabled
        ? dispatchEmail(db, user_id, title, body, data ?? {})
        : Promise.resolve(null),
      preferences.push_mobile_enabled
        ? dispatchExpoPush(db, user_id, title, body, data ?? {})
        : Promise.resolve(null),
      preferences.push_web_enabled
        ? dispatchWebPush(db, user_id, title, body, data ?? {})
        : Promise.resolve(null),
    ])

    // 4. Collect which channels succeeded
    const channelsSent: string[] = []
    const [emailResult, mobilePushResult, webPushResult] = channelResults

    if (emailResult.status === 'fulfilled' && emailResult.value === true) {
      channelsSent.push('email')
    } else if (emailResult.status === 'rejected') {
      console.error('[notify] email channel error:', emailResult.reason)
    }

    if (mobilePushResult.status === 'fulfilled' && mobilePushResult.value === true) {
      channelsSent.push('push_mobile')
    } else if (mobilePushResult.status === 'rejected') {
      console.error('[notify] mobile push channel error:', mobilePushResult.reason)
    }

    if (webPushResult.status === 'fulfilled' && webPushResult.value === true) {
      channelsSent.push('push_web')
    } else if (webPushResult.status === 'rejected') {
      console.error('[notify] web push channel error:', webPushResult.reason)
    }

    // 5. Persist channel outcomes
    await db
      .from('notifications')
      .update({ channels_sent: channelsSent })
      .eq('id', notification!.id)

    return respond({ notification_id: notification!.id, channels_sent: channelsSent }, 200)
  } catch (err) {
    console.error('[notify]', err)
    return respond({ error: String(err) }, 500)
  }
})

// ── Email channel ────────────────────────────────────────────────────
async function dispatchEmail(
  db: SupabaseClient,
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<boolean> {
  if (!RESEND_API_KEY) {
    console.warn('[notify] RESEND_API_KEY not configured — skipping email')
    return false
  }

  const { data: user } = await db
    .from('users')
    .select('email, full_name, display_name')
    .eq('id', userId)
    .single()

  if (!user?.email) return false

  const ctaUrl = data.task_id
    ? `${APP_URL}/tasks/${data.task_id}`
    : data.pipeline_id
    ? `${APP_URL}/pipelines/${data.pipeline_id}`
    : APP_URL

  const recipientName = user.display_name || user.full_name || 'there'

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [user.email],
      subject: title,
      html: buildEmailHtml(recipientName, title, body, ctaUrl),
    }),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('[notify] Resend error:', res.status, errText)
    return false
  }

  return true
}

// ── Mobile push channel (Expo Push Notification Service) ─────────────
async function dispatchExpoPush(
  db: SupabaseClient,
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<boolean> {
  // Fetch all active Expo tokens for this user
  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id, token')
    .eq('user_id', userId)
    .eq('type', 'expo')
    .is('revoked_at', null)

  if (error) throw error
  if (!subs?.length) return false

  const messages = subs.map((sub: { id: string; token: string }) => ({
    to: sub.token,
    title,
    body,
    data,
    sound: 'default',
    channelId: 'default',
  }))

  const expoHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
  if (EXPO_ACCESS_TOKEN) {
    expoHeaders['Authorization'] = `Bearer ${EXPO_ACCESS_TOKEN}`
  }

  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: expoHeaders,
    body: JSON.stringify(messages),
  })

  if (!res.ok) {
    const errText = await res.text()
    console.error('[notify] Expo push error:', res.status, errText)
    return false
  }

  const result = await res.json()

  // Clean up tokens that Expo reports as no longer registered
  const staleIds: string[] = []
  const tickets: Array<{ status: string; details?: { error?: string } }> =
    Array.isArray(result.data) ? result.data : []

  tickets.forEach((ticket, idx) => {
    if (
      ticket.status === 'error' &&
      ticket.details?.error === 'DeviceNotRegistered'
    ) {
      staleIds.push(subs[idx].id)
    }
  })

  if (staleIds.length) {
    await db
      .from('push_subscriptions')
      .update({ revoked_at: new Date().toISOString() })
      .in('id', staleIds)
  }

  return tickets.some((t) => t.status === 'ok')
}

// ── Web push channel (VAPID) ─────────────────────────────────────────
async function dispatchWebPush(
  db: SupabaseClient,
  userId: string,
  title: string,
  body: string,
  data: Record<string, unknown>
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    console.warn('[notify] VAPID keys not configured — skipping web push')
    return false
  }

  const { data: subs, error } = await db
    .from('push_subscriptions')
    .select('id, token')
    .eq('user_id', userId)
    .eq('type', 'web')
    .is('revoked_at', null)

  if (error) throw error
  if (!subs?.length) return false

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  const payload = JSON.stringify({ title, body, data })
  const staleIds: string[] = []

  const sends = await Promise.allSettled(
    subs.map(async (sub: { id: string; token: string }) => {
      let subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
      try {
        subscription = JSON.parse(sub.token)
      } catch {
        console.error('[notify] invalid web push token for sub', sub.id)
        return false
      }
      try {
        await webpush.sendNotification(subscription, payload, { TTL: 86400 })
        return true
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode
        if (status === 410 || status === 404) {
          staleIds.push(sub.id)
          return false
        }
        throw err
      }
    })
  )

  if (staleIds.length) {
    await db
      .from('push_subscriptions')
      .update({ revoked_at: new Date().toISOString() })
      .in('id', staleIds)
  }

  return sends.some((r) => r.status === 'fulfilled' && r.value === true)
}

// ── Email HTML template ──────────────────────────────────────────────
function buildEmailHtml(
  recipientName: string,
  title: string,
  body: string,
  ctaUrl: string
): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

          <!-- Header -->
          <tr>
            <td style="background:#1a1a2e;padding:24px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">
                TrustFlow
              </span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:0.5px;font-weight:600;">
                Notification
              </p>
              <h1 style="margin:0 0 16px;color:#111827;font-size:22px;font-weight:700;line-height:1.3;">
                ${escapeHtml(title)}
              </h1>
              <p style="margin:0 0 28px;color:#374151;font-size:15px;line-height:1.6;">
                Hi ${escapeHtml(recipientName)},<br /><br />
                ${escapeHtml(body)}
              </p>

              <!-- CTA -->
              <a href="${ctaUrl}"
                 style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;">
                View in TrustFlow →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px;border-top:1px solid #e5e7eb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">
                You're receiving this because you have notifications enabled in TrustFlow.<br />
                <a href="${APP_URL}/settings/notifications" style="color:#6b7280;">Manage preferences</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ── Helper ───────────────────────────────────────────────────────────
function respond(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
