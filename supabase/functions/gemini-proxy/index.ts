import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY');
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const ALLOWED_MODELS = ['gemini-2.5-flash'];

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
  // (interactive chat). Runs as the signed-in user, so the RPC's auth.uid()
  // resolves and the per-user counter is race-safe (SELECT ... FOR UPDATE).
  // Free = 50/mo, Pro = 500/mo. On cap → 402 (the client maps it to a paywall).
  if (body.meter === true) {
    const { data: gate, error: gateErr } = await supabase.rpc('consume_ai_action', {
      p_free_limit: 50,
      p_pro_limit: 500,
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
