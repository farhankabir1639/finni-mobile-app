// ── Few-shot voice exemplars ────────────────────────────────────────────────
//
// Hand-picked from finance_coach_insights_500.jsonl. These exist ONLY to teach
// Finni's voice — the brevity, the single concrete action, the awareness /
// restrict / encourage tonality. They are NEVER emitted verbatim and carry no
// numbers; the generator phrases the user's real `facts` in this style.

import type { Tone } from './types';

interface VoiceExample { tone: Tone; insight: string; action: string }

const EXAMPLES: VoiceExample[] = [
  // encourage
  { tone: 'encourage', insight: "You've underspent your guilt-free budget this month.", action: 'Want ideas in your value zone for it?' },
  { tone: 'encourage', insight: "You've logged expenses many days straight — that streak alone tends to cut spending.", action: 'Keep the streak — want a tiny daily check-in reminder?' },
  { tone: 'encourage', insight: "You're closing in on a goal you set for yourself.", action: 'Want me to nudge the finish line a little closer?' },
  // awareness
  { tone: 'awareness', insight: "One category is quietly eating most of your spending this month.", action: "Want to see what's driving it?" },
  { tone: 'awareness', insight: "There's matched money you're currently leaving behind.", action: "I'll show you the raise-equivalent you're missing." },
  { tone: 'awareness', insight: "A charge just landed that doesn't fit your usual pattern.", action: 'Was this you? One tap confirms or flags it.' },
  // restrict
  { tone: 'restrict', insight: "You're burning through this budget faster than the month is passing.", action: 'Want to set a soft cap for the rest of the month?' },
  { tone: 'restrict', insight: 'This bucket is on track to blow past its limit before payday.', action: "Let's right-size it before it does." },
];

// Up to `n` examples, preferring the target tone but always showing a spread so
// the model learns the overall register, not just one mood.
export function fewShotBlock(tone: Tone, n = 5): string {
  const sameTone = EXAMPLES.filter((e) => e.tone === tone);
  const others = EXAMPLES.filter((e) => e.tone !== tone);
  const chosen = [...sameTone, ...others].slice(0, n);
  return chosen
    .map((e) => `- (${e.tone}) insight: "${e.insight}"  action: "${e.action}"`)
    .join('\n');
}
