// Supabase Edge Function — notify-new-signup
// Triggered by a Database Webhook on INSERT to public.profiles.
// Sends a notification email to the founder whenever a new user signs up.

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const FOUNDER_EMAIL = 'kabirfarhan2@gmail.com';
const FROM_EMAIL    = 'Finni Alerts <notify@updates.heyfinni.com>';

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Supabase webhooks send the Authorization header with the service role key
  const auth = req.headers.get('Authorization') ?? '';
  if (!auth.includes(SUPABASE_SERVICE_KEY.slice(0, 10))) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: { record?: Record<string, unknown> };
  try {
    payload = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const profile = payload.record;
  if (!profile) return new Response('No record', { status: 400 });

  // Fetch the user's email from auth
  let email = 'unknown';
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${profile.id}`, {
      headers: {
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'apikey': SUPABASE_SERVICE_KEY,
      },
    });
    const data = await res.json();
    email = data?.email ?? 'unknown';
  } catch {}

  const name     = (profile.name as string) || 'No name yet';
  const currency = (profile.currency as string) || 'Not set';
  const signedUp = new Date().toUTCString();

  const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#07070E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
    <div style="text-align:center;margin-bottom:24px;">
      <span style="font-size:36px;">🎉</span>
      <h1 style="margin:8px 0 4px;font-size:22px;font-weight:800;color:#F4F6FC;">New Finni User!</h1>
      <p style="margin:0;font-size:13px;color:#57647F;">Someone just signed up</p>
    </div>

    <div style="background:#0D1322;border-radius:16px;padding:20px 24px;border:1px solid rgba(255,255,255,0.07);">
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:8px 0;font-size:13px;color:#57647F;width:40%;">Name</td>
          <td style="padding:8px 0;font-size:13px;color:#F4F6FC;font-weight:600;">${name}</td>
        </tr>
        <tr style="border-top:1px solid rgba(255,255,255,0.05);">
          <td style="padding:8px 0;font-size:13px;color:#57647F;">Email</td>
          <td style="padding:8px 0;font-size:13px;color:#5EEAD4;font-weight:600;">${email}</td>
        </tr>
        <tr style="border-top:1px solid rgba(255,255,255,0.05);">
          <td style="padding:8px 0;font-size:13px;color:#57647F;">Currency</td>
          <td style="padding:8px 0;font-size:13px;color:#F4F6FC;">${currency}</td>
        </tr>
        <tr style="border-top:1px solid rgba(255,255,255,0.05);">
          <td style="padding:8px 0;font-size:13px;color:#57647F;">Signed up</td>
          <td style="padding:8px 0;font-size:13px;color:#F4F6FC;">${signedUp}</td>
        </tr>
      </table>
    </div>

    <p style="text-align:center;font-size:12px;color:#3A4660;margin-top:20px;">
      Finni · Founder alert
    </p>
  </div>
</body></html>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: FOUNDER_EMAIL,
      subject: `🎉 New Finni user: ${email}`,
      html,
    }),
  });

  if (!emailRes.ok) {
    const err = await emailRes.text();
    return new Response(JSON.stringify({ error: err }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, notified: FOUNDER_EMAIL }), { status: 200 });
});
