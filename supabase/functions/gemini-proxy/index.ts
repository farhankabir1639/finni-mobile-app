import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ALLOWED_MODELS = ['gemini-2.5-flash'];
// Master server-side go-live switch for AI metering. Off unless the env var is
// explicitly 'true' — so deploying this function never caps users before the
// paywall can actually sell Pro. Flip on (set METERING_ENABLED=true) in sync
// with the client MONETIZATION_LIVE flag.
const METERING_ENABLED = Deno.env.get('METERING_ENABLED') === 'true';

Deno.serve(async (req) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Verify authentication
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Validate API key is configured
  if (!GEMINI_API_KEY) {
    return new Response(JSON.stringify({ error: 'Gemini API key not configured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Parse request body
  let body: { contents: unknown; generationConfig?: unknown; model?: string; meter?: boolean };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!body.contents) {
    return new Response(JSON.stringify({ error: 'Missing contents field' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Monthly AI-action metering. Only enforced for explicitly-metered calls
  // (interactive chat). Two-phase so retries don't over-count: (1) a DRY-RUN
  // check here rejects a capped user before we spend a Gemini call; (2) the real
  // increment happens only after Gemini returns 2xx (below). Runs as the
  // signed-in user, so auth.uid() resolves and the counter is race-safe.
  // Free = 50/mo, Pro = 500/mo. On cap → 402 (client maps it to a paywall).
  const metered = METERING_ENABLED && body.meter === true;
  if (metered) {
    const { data: gate, error: gateErr } = await supabase.rpc('consume_ai_action', {
      p_free_limit: 50,
      p_pro_limit: 500,
      p_dry_run: true,
    });
    // Fail-open on metering errors: never block a paying/active user because the
    // counter hiccuped — we'd rather eat a little cost than break the core flow.
    if (!gateErr && Array.isArray(gate) && gate.length > 0) {
      const row = gate[0] as { allowed: boolean; used: number; action_limit: number; plan: string };
      if (!row.allowed) {
        return new Response(
          JSON.stringify({ error: 'cap_reached', used: row.used, action_limit: row.action_limit, plan: row.plan }),
          { status: 402, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }
  }

  // Resolve model — hardcoded allowlist prevents model substitution
  const model = ALLOWED_MODELS.includes(body.model ?? '') ? body.model! : ALLOWED_MODELS[0];
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  // Forward to Gemini with 30s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const geminiRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: body.contents,
        generationConfig: body.generationConfig ?? { temperature: 0.3, maxOutputTokens: 2048 },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    // Pass through Gemini's response status and body verbatim
    // This preserves 429/503 status codes so client retry logic works unchanged
    const geminiBody = await geminiRes.text();

    // Count the action only on a successful (2xx) generation, so infra-error
    // retries (503/504/timeout) don't burn the user's quota.
    if (metered && geminiRes.ok) {
      await supabase.rpc('consume_ai_action', { p_free_limit: 50, p_pro_limit: 500, p_dry_run: false });
    }

    return new Response(geminiBody, {
      status: geminiRes.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e instanceof Error && e.name === 'AbortError') {
      return new Response(JSON.stringify({ error: 'Gemini request timed out' }), {
        status: 504,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'Failed to reach Gemini API' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
