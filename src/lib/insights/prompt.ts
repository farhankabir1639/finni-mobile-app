// ── Insight prompt construction (pure, transport-free) ──────────────────────
//
// Kept free of any React Native / Supabase imports so it can be exercised
// directly by the eval harness and reused by a server-side generator later.

import { fewShotBlock } from './fewshot';
import type { TriggerResult, InsightContext } from './types';

const TONE_GUIDE: Record<string, string> = {
  awareness: 'Neutral, observational. Surface the fact without alarm or praise.',
  restrict: 'Gentle brake. Flag the overspend kindly; never scold or shame.',
  encourage: 'Warm, affirming. Celebrate the good behavior; keep momentum.',
};

export function buildInsightPrompt(t: TriggerResult, ctx: InsightContext): string {
  const factLines = Object.entries(t.facts)
    .map(([k, v]) => `  ${k} = ${v}`)
    .join('\n');
  const ctxLines = Object.entries(t.context)
    .map(([k, v]) => `  ${k} = ${v}`)
    .join('\n');
  const region = ctx.region ? `User region: ${ctx.region}. ` : '';

  return `You are Finni, a friendly personal-finance companion (NOT a licensed advisor).
Write ONE short insight and ONE short action for the user, in Finni's voice.

VOICE EXAMPLES (style only — never copy, they carry no numbers):
${fewShotBlock(t.tone)}

TONE for this insight: ${t.tone} — ${TONE_GUIDE[t.tone] ?? ''}

${region}Currency symbol: ${ctx.currencySymbol}

FACTS — the ONLY numbers you may mention (phrase them naturally, you may round):
${factLines || '  (none)'}
${ctxLines ? `\nCONTEXT (non-numeric):\n${ctxLines}` : ''}

HARD RULES:
- NEVER state, compute, estimate, or invent any number that is not in FACTS above. If a number isn't listed, do not mention it.
- Insight ≤ 18 words. Action ≤ 12 words and offers one concrete next step.
- Use the category/goal name from CONTEXT if present. Prepend the currency symbol to money amounts.
- Do NOT give regulated financial advice; keep it observational and supportive.

Return ONLY minified JSON, no markdown:
{"insight":"...","action":"..."}`;
}
