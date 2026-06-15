/**
 * Insights eval harness — golden-set + guardrail checks for the grounded
 * insights pipeline.
 *
 * Run:
 *   npx tsx eval/insights_eval.ts            # offline suites only (no network)
 *   npx tsx eval/insights_eval.ts --online   # also runs generation + LLM-judge
 *
 * Offline suites are deterministic and import the REAL pipeline logic
 * (validate / rank / triggers / prompt) — these gate every prompt change.
 * The online pass calls Gemini directly with the production prompt, runs the
 * number guardrail on the output, and uses an LLM judge to score voice/tone
 * against the finance_coach_insights_500 register.
 */

import { validateNumbers } from '../src/lib/insights/validate';
import { rankInsights } from '../src/lib/insights/rank';
import { detectAll } from '../src/lib/insights/triggers';
import { buildInsightPrompt } from '../src/lib/insights/prompt';
import type { InsightContext, TriggerResult } from '../src/lib/insights/types';

// ── tiny test harness ───────────────────────────────────────────────────────
let pass = 0;
let fail = 0;
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}`); }
}

// ── fixtures ─────────────────────────────────────────────────────────────────
function ctx(over: Partial<InsightContext> = {}): InsightContext {
  return {
    userId: 'u1', region: 'Dhaka', currency: 'BDT', currencySymbol: '৳',
    monthlyIncome: 60000, monthSpent: 20000, monthElapsedPct: 30, monthName: 'June',
    categories: [], goals: [], transactionCount: 25, ...over,
  };
}

// ── Suite A: number guardrail ────────────────────────────────────────────────
function suiteValidator() {
  console.log('\n[A] Number guardrail');
  const facts = { used_pct: 24, spent: 1200, budget: 5000 };
  check('accepts only traceable numbers', validateNumbers("You've used 24% of your ৳5,000 budget — ৳1,200 in.", facts).ok);
  check('rejects an invented number', !validateNumbers('Try to save ৳500 more this week.', facts).ok);
  check('allows rounding of a fact', validateNumbers('about 24%', { used_pct: 23.7 }).ok);
  check('allows thousands separators', validateNumbers('৳13,000 spent', { amount: 13000 }).ok);
  check('allows text with no numbers', validateNumbers("You're pacing well this month.", facts).ok);
  check('rejects a fabricated percentage', !validateNumbers('That is 90% of your budget.', facts).ok);
}

// ── Suite B: detection ────────────────────────────────────────────────────────
function suiteDetection() {
  console.log('\n[B] Detection triggers');
  const overpacing = detectAll(ctx({
    categories: [{ id: 'c1', name: 'Food', spent: 4000, budget: 5000 }], // 80% used at 30% elapsed
    monthElapsedPct: 30,
  }));
  check('category_overpacing fires when pacing ahead', overpacing.some((r) => r.triggerId === 'category_overpacing'));

  const newUser = detectAll(ctx({ transactionCount: 1, categories: [], goals: [] }));
  check('start_logging fires for brand-new user', newUser.some((r) => r.triggerId === 'start_logging'));
  check('non-cold-start triggers absent for new user data', !newUser.some((r) => r.triggerId === 'category_overpacing'));

  const goal = detectAll(ctx({ goals: [{ name: 'Eid Fund', target_amount: 10000, current_amount: 6000 }] }));
  check('goal_progress fires with an active goal', goal.some((r) => r.triggerId === 'goal_progress'));

  const calm = detectAll(ctx({ categories: [{ id: 'c1', name: 'Food', spent: 100, budget: 5000 }], monthElapsedPct: 10 }));
  check('no false-positive overpacing when on track', !calm.some((r) => r.triggerId === 'category_overpacing'));
}

// ── Suite C: ranking ──────────────────────────────────────────────────────────
function mkCand(over: Partial<TriggerResult>): TriggerResult {
  return {
    triggerId: 't', category: 'Spending patterns', tone: 'awareness',
    facts: {}, context: {}, severity: 0.5, actionable: false,
    coldStartSafe: true, dedupeKey: 'k', ...over,
  };
}
function suiteRanking() {
  console.log('\n[C] Ranking');
  const cands = [
    mkCand({ category: 'Spending patterns', dedupeKey: 'a', severity: 0.9 }),
    mkCand({ category: 'Spending patterns', dedupeKey: 'b', severity: 0.8 }),
    mkCand({ category: 'Behavioral', dedupeKey: 'c', severity: 0.7 }),
  ];
  const ranked = rankInsights(cands, {}, {}, Date.now(), 3);
  check('diversity: no two picks share a category', new Set(ranked.map((r) => r.category)).size === ranked.length);
  check('respects maxResults', rankInsights(cands, {}, {}, Date.now(), 1).length === 1);

  // Novelty: an insight shown today should usually lose to a fresh equal-severity one.
  const now = Date.now();
  const shownToday = { stale: new Date(now).toISOString() };
  let freshWins = 0;
  for (let i = 0; i < 200; i++) {
    const r = rankInsights(
      [mkCand({ category: 'A', dedupeKey: 'stale', severity: 0.6 }), mkCand({ category: 'B', dedupeKey: 'fresh', severity: 0.6 })],
      {}, shownToday, now, 1,
    );
    if (r[0]?.dedupeKey === 'fresh') freshWins++;
  }
  check('novelty: fresh insight wins the majority of the time', freshWins > 120);

  // Thompson: strong positive feedback should lift a category most of the time.
  let likedWins = 0;
  for (let i = 0; i < 200; i++) {
    const r = rankInsights(
      [mkCand({ category: 'Liked', dedupeKey: 'x', severity: 0.5 }), mkCand({ category: 'Neutral', dedupeKey: 'y', severity: 0.5 })],
      { Liked: { up: 8, down: 0 } }, {}, now, 1,
    );
    if (r[0]?.category === 'Liked') likedWins++;
  }
  check('personalization: liked category wins majority', likedWins > 120);
}

// ── Suite D: online generation + LLM judge ───────────────────────────────────
async function loadKey(): Promise<string | null> {
  if (process.env.EXPO_PUBLIC_GEMINI_API_KEY) return process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  try {
    const fs = await import('node:fs');
    const env = fs.readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const m = env.match(/EXPO_PUBLIC_GEMINI_API_KEY=(.+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

async function gemini(key: string, prompt: string, temperature = 0.5): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature, maxOutputTokens: 512, thinkingConfig: { thinkingBudget: 0 } } }),
  });
  const data = await res.json() as any;
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function suiteOnline() {
  console.log('\n[D] Online generation + LLM judge');
  const key = await loadKey();
  if (!key) { console.log('  (skipped — no EXPO_PUBLIC_GEMINI_API_KEY)'); return; }

  const samples: TriggerResult[] = [
    { triggerId: 'category_overpacing', category: 'Spending patterns', tone: 'restrict',
      facts: { used_pct: 82, month_elapsed_pct: 40, spent: 4100, budget: 5000 },
      context: { category: 'Food' }, severity: 0.7, actionable: true, coldStartSafe: false, dedupeKey: 'cat:food' },
    { triggerId: 'goal_progress', category: 'Goals & milestones', tone: 'encourage',
      facts: { pct: 60, current: 6000, target: 10000, remaining: 4000 },
      context: { goal_name: 'Eid Fund' }, severity: 0.45, actionable: false, coldStartSafe: true, dedupeKey: 'goal:eid' },
  ];

  let grounded = 0, voiceTotal = 0;
  for (const t of samples) {
    const raw = await gemini(key, buildInsightPrompt(t, ctx()));
    const cleaned = raw.replace(/```json?|```/g, '').trim();
    let insight = '', action = '';
    try { const p = JSON.parse(cleaned); insight = p.insight ?? ''; action = p.action ?? ''; } catch { /* malformed */ }
    const v = validateNumbers(`${insight} ${action}`, t.facts);
    if (v.ok && insight) grounded++;
    console.log(`  • ${t.triggerId} [${t.tone}] grounded=${v.ok}  "${insight}" / "${action}"`);
    if (v.offending.length) console.log(`      offending numbers: ${v.offending.join(', ')}`);

    // LLM judge for voice/tone.
    const judgeRaw = await gemini(key,
      `Rate 1-5 how well this matches a concise, warm "${t.tone}" personal-finance coach voice (5=perfect). Return ONLY {"score":n}.\nInsight: "${insight}"\nAction: "${action}"`, 0.1);
    try { voiceTotal += JSON.parse(judgeRaw.replace(/```json?|```/g, '').trim()).score ?? 0; } catch { /* ignore */ }
  }
  check('all sampled insights pass the number guardrail', grounded === samples.length);
  check('average voice score >= 3.5', voiceTotal / samples.length >= 3.5);
  console.log(`  avg voice score: ${(voiceTotal / samples.length).toFixed(1)}/5`);
}

// ── run ───────────────────────────────────────────────────────────────────────
async function main() {
  suiteValidator();
  suiteDetection();
  suiteRanking();
  if (process.argv.includes('--online')) await suiteOnline();
  console.log(`\n── ${pass} passed, ${fail} failed ──`);
  process.exit(fail ? 1 : 0);
}
main();
