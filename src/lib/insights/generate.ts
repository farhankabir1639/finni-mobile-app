// ── Generation layer ────────────────────────────────────────────────────────
//
// Turns a fired trigger into one user-facing insight + action. The LLM is given
// ONLY the trigger's facts and is told it may phrase nothing else numeric. Every
// output passes through validateNumbers(); a failure triggers one stricter retry,
// then the candidate is dropped (better no card than a wrong number).

import { generateGroundedText } from '../agents';
import { fewShotBlock } from './fewshot';
import { validateNumbers } from './validate';
import type { TriggerResult, GeneratedInsight, InsightContext } from './types';

const TONE_GUIDE: Record<string, string> = {
  awareness: 'Neutral, observational. Surface the fact without alarm or praise.',
  restrict: 'Gentle brake. Flag the overspend kindly; never scold or shame.',
  encourage: 'Warm, affirming. Celebrate the good behavior; keep momentum.',
};

function buildPrompt(t: TriggerResult, ctx: InsightContext): string {
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

export async function generateInsight(
  t: TriggerResult,
  ctx: InsightContext
): Promise<GeneratedInsight | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await generateGroundedText(buildPrompt(t, ctx), {
        temperature: attempt === 0 ? 0.5 : 0.2, // tighten on retry
        maxOutputTokens: 256,
      });
      const cleaned = raw.replace(/```json?|```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { insight?: string; action?: string };
      const insight = (parsed.insight ?? '').trim();
      const action = (parsed.action ?? '').trim();
      if (!insight) continue;

      // The guardrail: validate BOTH fields against the facts.
      const v = validateNumbers(`${insight} ${action}`, t.facts);
      if (!v.ok) {
        if (__DEV__) console.log(`[insights] ${t.triggerId} dropped — untraceable numbers:`, v.offending);
        continue; // retry stricter, then drop
      }
      return {
        triggerId: t.triggerId,
        category: t.category,
        tone: t.tone,
        insight,
        action,
        dedupeKey: t.dedupeKey,
      };
    } catch (e) {
      if (__DEV__) console.log(`[insights] generate ${t.triggerId} attempt ${attempt} failed:`, e);
    }
  }
  return null;
}
