// ── Insights pipeline orchestrator ──────────────────────────────────────────
//
//   detectAll → cold-start gate → rank → generate top (validate) → cache.
//
// Returns the single best validated insight for the "Finni noticed" card. We
// generate lazily down the ranked list: the top candidate is phrased first, and
// only if it fails the number guardrail do we fall through to the next. The
// result is cached per user per day so we make at most one Gemini call/day.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { detectAll } from './triggers';
import { rankInsights } from './rank';
import { generateInsight } from './generate';
import { getFeedbackStats, getShownMap, recordShown, recordFeedback } from './feedback';
import type { InsightContext, GeneratedInsight } from './types';

export type { InsightContext, GeneratedInsight } from './types';
export { recordFeedback } from './feedback';

const COLD_START_TX = 3; // below this, only show cold-start-safe insights

function todayKey(userId: string): string {
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `insight_card_${userId}_${local}`;
}

export async function getTopInsight(ctx: InsightContext): Promise<GeneratedInsight | null> {
  if (!ctx.userId) return null;

  // One generated card per day (cheap + stable). Dismissals clear this key.
  const cacheK = todayKey(ctx.userId);
  try {
    const cached = await AsyncStorage.getItem(cacheK);
    if (cached) return JSON.parse(cached) as GeneratedInsight;
  } catch {
    // ignore cache read failures
  }

  let candidates = detectAll(ctx);
  // Cold-start gate: low-data users only ever see cold-start-safe insights.
  if (ctx.transactionCount < COLD_START_TX) {
    candidates = candidates.filter((c) => c.coldStartSafe);
  }
  if (!candidates.length) return null;

  const [feedback, shown] = await Promise.all([
    getFeedbackStats(ctx.userId),
    getShownMap(ctx.userId),
  ]);
  const ranked = rankInsights(candidates, feedback, shown, Date.now(), 3);

  // Generate down the ranked list until one passes the number guardrail.
  for (const cand of ranked) {
    const generated = await generateInsight(cand, ctx);
    if (generated) {
      const nowIso = new Date().toISOString();
      await recordShown(ctx.userId, generated.dedupeKey, nowIso);
      try {
        await AsyncStorage.setItem(cacheK, JSON.stringify(generated));
      } catch {
        // ignore cache write failures
      }
      return generated;
    }
  }
  return null;
}

// Called when the user 👎 an insight: record it and clear today's cache so a
// different insight can surface (and personalization shifts away from this type).
export async function dismissInsight(userId: string, category: string): Promise<void> {
  await recordFeedback(userId, category, 'down');
  try {
    await AsyncStorage.removeItem(todayKey(userId));
  } catch {
    // ignore
  }
}
