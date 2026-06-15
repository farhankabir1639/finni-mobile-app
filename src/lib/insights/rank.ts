// ── Ranking layer ───────────────────────────────────────────────────────────
//
// score = wSev·severity + wAct·actionable + wNov·novelty + wFit·personalFit
//
// personalFit is the ONLY learned term: a Thompson sample from Beta(👍+1, 👎+1)
// for this user × category. With no feedback it's Beta(1,1) = uniform = pure
// exploration, which is exactly the cold-start behavior we want — the same
// mechanism explores when it knows nothing and exploits as feedback arrives.
// After scoring we apply novelty decay, then greedily pick with category
// diversity so the feed isn't three spending-pattern cards in a row.

import type { TriggerResult } from './types';
import type { FeedbackStats } from './feedback';

const W = { sev: 0.4, act: 0.15, nov: 0.2, fit: 0.25 };

// Gamma(k,1) for integer k≥1 via sum of exponentials — exact, no dependencies.
function gammaInt(k: number): number {
  let acc = 0;
  for (let i = 0; i < k; i++) acc += -Math.log(1 - Math.random());
  return acc;
}

// Sample from Beta(a,b) with integer a,b ≥ 1.
function sampleBeta(a: number, b: number): number {
  const ga = gammaInt(a);
  const gb = gammaInt(b);
  const denom = ga + gb;
  return denom === 0 ? 0.5 : ga / denom;
}

// 0 if shown today, ramping to 1 over NOVELTY_DAYS since last shown.
const NOVELTY_DAYS = 5;
function novelty(dedupeKey: string, shown: Record<string, string>, nowMs: number): number {
  const last = shown[dedupeKey];
  if (!last) return 1;
  const days = (nowMs - new Date(last).getTime()) / 86400000;
  if (days <= 0) return 0;
  return Math.min(1, days / NOVELTY_DAYS);
}

export interface RankedCandidate extends TriggerResult {
  score: number;
}

export function rankInsights(
  candidates: TriggerResult[],
  feedback: FeedbackStats,
  shown: Record<string, string>,
  nowMs: number,
  maxResults = 3
): RankedCandidate[] {
  const scored: RankedCandidate[] = candidates.map((c) => {
    const fb = feedback[c.category] ?? { up: 0, down: 0 };
    const personalFit = sampleBeta(fb.up + 1, fb.down + 1);
    const nov = novelty(c.dedupeKey, shown, nowMs);
    const score =
      W.sev * c.severity +
      W.act * (c.actionable ? 1 : 0) +
      W.nov * nov +
      W.fit * personalFit;
    return { ...c, score };
  });

  scored.sort((a, b) => b.score - a.score);

  // Greedy pick with diversity: at most one insight per taxonomy category, and
  // never two with the same dedupeKey.
  const picked: RankedCandidate[] = [];
  const seenCats = new Set<string>();
  const seenKeys = new Set<string>();
  for (const c of scored) {
    if (seenKeys.has(c.dedupeKey) || seenCats.has(c.category)) continue;
    picked.push(c);
    seenCats.add(c.category);
    seenKeys.add(c.dedupeKey);
    if (picked.length >= maxResults) break;
  }
  return picked;
}
