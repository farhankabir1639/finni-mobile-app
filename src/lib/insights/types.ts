// ── Grounded insights pipeline — shared types ───────────────────────────────
//
// Architecture (per the CTO plan):
//   detect (deterministic math) → facts → generate (LLM phrases only) →
//   validate (no invented numbers) → rank (severity + Thompson personalization).
//
// The LLM NEVER computes a number. The detection layer puts every figure into
// `facts`, the generator may only phrase those figures, and the validator
// rejects any output containing a number not traceable to `facts`.

export type Tone = 'awareness' | 'restrict' | 'encourage';

// Snapshot of everything the detection layer is allowed to reason over. Built
// from data the app already fetches — no extra round-trips for the thin slice.
export interface InsightContext {
  userId: string;
  region?: string | null;        // coarse location from onboarding, e.g. "Dhaka"
  currency: string;              // ISO code, e.g. "BDT"
  currencySymbol: string;        // e.g. "৳"
  monthlyIncome: number;         // configured monthly income (0 if none)
  monthSpent: number;            // spent so far this month
  monthElapsedPct: number;       // 0–100, how far into the month we are
  monthName: string;
  categories: { id: string; name: string; emoji?: string; budget?: number; spent?: number }[];
  goals: { name: string; target_amount?: number; current_amount?: number }[];
  transactionCount: number;      // total logged (coarse; used for cold-start gating)
}

// A fired trigger. `facts` is the ONLY set of numbers allowed to appear in the
// generated text — this is what makes "never invent a number" enforceable.
export interface TriggerResult {
  triggerId: string;
  category: string;              // taxonomy category, e.g. "Spending patterns"
  tone: Tone;
  facts: Record<string, number>; // numeric facts the generator may phrase
  context: Record<string, string>; // non-numeric context (category name, region…)
  severity: number;              // 0–1, how much is at stake
  actionable: boolean;           // is there a concrete in-app next step?
  coldStartSafe: boolean;        // safe to show a brand-new / low-data user?
  dedupeKey: string;             // collapses duplicates & drives novelty decay
}

export interface Trigger {
  id: string;
  category: string;
  tone: Tone;
  coldStartSafe: boolean;
  // Returns a fired result or null if the condition isn't met for this user.
  detect: (ctx: InsightContext) => TriggerResult | null;
}

// Final, user-facing insight after generation + validation.
export interface GeneratedInsight {
  triggerId: string;
  category: string;
  tone: Tone;
  insight: string;   // the observation, in Finni's voice
  action: string;    // one concrete next step
  dedupeKey: string;
}
