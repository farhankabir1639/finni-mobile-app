// ── Trigger library (detection layer) ───────────────────────────────────────
//
// Each trigger is pure, deterministic math over InsightContext. It returns the
// numeric `facts` that the generator is then allowed to phrase — and NOTHING
// the generator says may contain a number outside those facts.
//
// This is the thin-slice subset: feasible on Finni's manual-entry data and
// cold-start-safe where noted. Adding a trigger = adding one entry here; the
// generation/ranking layers don't change.

import type { Trigger, TriggerResult, InsightContext } from './types';

const round1 = (n: number) => Math.round(n * 10) / 10;

// T1 — A budgeted category is pacing well ahead of the month. (restrict)
const categoryOverpacing: Trigger = {
  id: 'category_overpacing',
  category: 'Spending patterns',
  tone: 'restrict',
  coldStartSafe: false,
  detect: (ctx) => {
    const budgeted = ctx.categories.filter((c) => (c.budget ?? 0) > 0);
    let worst: { c: typeof budgeted[number]; usedPct: number } | null = null;
    for (const c of budgeted) {
      const usedPct = ((c.spent ?? 0) / (c.budget as number)) * 100;
      if (usedPct > ctx.monthElapsedPct + 15 && (!worst || usedPct > worst.usedPct)) {
        worst = { c, usedPct };
      }
    }
    if (!worst) return null;
    const ahead = worst.usedPct - ctx.monthElapsedPct;
    return {
      triggerId: 'category_overpacing',
      category: 'Spending patterns',
      tone: 'restrict',
      facts: {
        used_pct: Math.round(worst.usedPct),
        month_elapsed_pct: Math.round(ctx.monthElapsedPct),
        spent: round1(worst.c.spent ?? 0),
        budget: round1(worst.c.budget as number),
      },
      context: { category: worst.c.name, emoji: worst.c.emoji ?? '' },
      severity: Math.min(1, ahead / 60),
      actionable: true,
      coldStartSafe: false,
      dedupeKey: `cat:${worst.c.name.toLowerCase()}`,
    };
  },
};

// T2 — One category dominates this month's spend. (awareness)
const topCategoryConcentration: Trigger = {
  id: 'top_category_concentration',
  category: 'Spending patterns',
  tone: 'awareness',
  coldStartSafe: false,
  detect: (ctx) => {
    if (ctx.monthSpent <= 0) return null;
    const ranked = [...ctx.categories]
      .map((c) => ({ c, spent: c.spent ?? 0 }))
      .sort((a, b) => b.spent - a.spent);
    const top = ranked[0];
    if (!top || top.spent <= 0) return null;
    const pct = (top.spent / ctx.monthSpent) * 100;
    if (pct < 40) return null;
    return {
      triggerId: 'top_category_concentration',
      category: 'Spending patterns',
      tone: 'awareness',
      facts: {
        pct_of_spend: Math.round(pct),
        amount: round1(top.spent),
        total_spent: round1(ctx.monthSpent),
      },
      context: { category: top.c.name, emoji: top.c.emoji ?? '' },
      severity: Math.min(1, (pct - 40) / 50),
      actionable: false,
      coldStartSafe: false,
      dedupeKey: `cat:${top.c.name.toLowerCase()}`,
    };
  },
};

// T3 — A budgeted category is barely touched late in the month. (encourage)
const underusedBudget: Trigger = {
  id: 'underused_budget',
  category: 'Behavioral',
  tone: 'encourage',
  coldStartSafe: false,
  detect: (ctx) => {
    if (ctx.monthElapsedPct < 60) return null;
    const budgeted = ctx.categories.filter((c) => (c.budget ?? 0) > 0);
    let best: { c: typeof budgeted[number]; usedPct: number } | null = null;
    for (const c of budgeted) {
      const usedPct = ((c.spent ?? 0) / (c.budget as number)) * 100;
      if (usedPct < 30 && (!best || usedPct < best.usedPct)) best = { c, usedPct };
    }
    if (!best) return null;
    return {
      triggerId: 'underused_budget',
      category: 'Behavioral',
      tone: 'encourage',
      facts: {
        used_pct: Math.round(best.usedPct),
        month_elapsed_pct: Math.round(ctx.monthElapsedPct),
        budget: round1(best.c.budget as number),
      },
      context: { category: best.c.name, emoji: best.c.emoji ?? '' },
      severity: 0.4,
      actionable: false,
      coldStartSafe: false,
      dedupeKey: `cat:${best.c.name.toLowerCase()}`,
    };
  },
};

// T4 — User logs expenses but hasn't set any budget. (cold-start, encourage)
const setABudget: Trigger = {
  id: 'set_a_budget',
  category: 'Goals & milestones',
  tone: 'encourage',
  coldStartSafe: true,
  detect: (ctx) => {
    const anyBudget = ctx.categories.some((c) => (c.budget ?? 0) > 0);
    if (anyBudget || ctx.transactionCount < 3) return null;
    return {
      triggerId: 'set_a_budget',
      category: 'Goals & milestones',
      tone: 'encourage',
      facts: { category_count: ctx.categories.length },
      context: {},
      severity: 0.5,
      actionable: true,
      coldStartSafe: true,
      dedupeKey: 'onboarding:set_budget',
    };
  },
};

// T5 — Progress toward a financial goal. (encourage)
const goalProgress: Trigger = {
  id: 'goal_progress',
  category: 'Goals & milestones',
  tone: 'encourage',
  coldStartSafe: true,
  detect: (ctx) => {
    const withTarget = ctx.goals.filter((g) => (g.target_amount ?? 0) > 0);
    if (!withTarget.length) return null;
    // Surface the goal closest to completion (most motivating).
    let best: { g: typeof withTarget[number]; pct: number } | null = null;
    for (const g of withTarget) {
      const pct = ((g.current_amount ?? 0) / (g.target_amount as number)) * 100;
      if (pct >= 100) continue; // already done
      if (!best || pct > best.pct) best = { g, pct };
    }
    if (!best) return null;
    const remaining = (best.g.target_amount as number) - (best.g.current_amount ?? 0);
    return {
      triggerId: 'goal_progress',
      category: 'Goals & milestones',
      tone: 'encourage',
      facts: {
        pct: Math.round(best.pct),
        current: round1(best.g.current_amount ?? 0),
        target: round1(best.g.target_amount as number),
        remaining: round1(remaining),
      },
      context: { goal_name: best.g.name },
      severity: 0.45,
      actionable: false,
      coldStartSafe: true,
      dedupeKey: `goal:${best.g.name.toLowerCase()}`,
    };
  },
};

// T6 — Brand-new user with almost no data. (cold-start, encourage)
const startLogging: Trigger = {
  id: 'start_logging',
  category: 'Behavioral',
  tone: 'encourage',
  coldStartSafe: true,
  detect: (ctx) => {
    if (ctx.transactionCount >= 3) return null;
    return {
      triggerId: 'start_logging',
      category: 'Behavioral',
      tone: 'encourage',
      facts: { logged_count: ctx.transactionCount },
      context: {},
      severity: 0.3,
      actionable: true,
      coldStartSafe: true,
      dedupeKey: 'onboarding:start_logging',
    };
  },
};

export const TRIGGERS: Trigger[] = [
  categoryOverpacing,
  topCategoryConcentration,
  underusedBudget,
  setABudget,
  goalProgress,
  startLogging,
];

export function detectAll(ctx: InsightContext): TriggerResult[] {
  const out: TriggerResult[] = [];
  for (const t of TRIGGERS) {
    try {
      const r = t.detect(ctx);
      if (r) out.push(r);
    } catch {
      // a misbehaving trigger must never break the feed
    }
  }
  return out;
}
