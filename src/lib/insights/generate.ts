// ── Generation layer ────────────────────────────────────────────────────────
//
// Turns a fired trigger into one user-facing insight + action. The LLM is given
// ONLY the trigger's facts and is told it may phrase nothing else numeric. Every
// output passes through validateNumbers(); a failure triggers one stricter retry,
// then the candidate is dropped (better no card than a wrong number).

import { generateGroundedText } from '../agents';
import { buildInsightPrompt } from './prompt';
import { validateNumbers } from './validate';
import type { TriggerResult, GeneratedInsight, InsightContext } from './types';

export async function generateInsight(
  t: TriggerResult,
  ctx: InsightContext
): Promise<GeneratedInsight | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await generateGroundedText(buildInsightPrompt(t, ctx), {
        temperature: attempt === 0 ? 0.5 : 0.2, // tighten on retry
        maxOutputTokens: 512,
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
