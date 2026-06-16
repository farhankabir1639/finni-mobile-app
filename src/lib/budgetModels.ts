// ── Budget models + allocation engine (pure, testable) ──────────────────────
//
// Replaces the old "divide income by spending share" logic with recognized
// personal-finance frameworks. Categories are sorted into needs/wants/savings
// buckets (AI + keyword, done by the caller), each bucket gets the model's % of
// income, and that pool is split across its categories weighted by past spend
// (or evenly with no history). All math here is deterministic.

export type Bucket = 'needs' | 'wants' | 'savings';
export type BudgetModelId = 'balanced' | 'essentials' | 'aggressive' | 'spending';

export interface BudgetModel {
  id: BudgetModelId;
  name: string;       // e.g. "50 / 30 / 20"
  tagline: string;
  needs?: number;     // % (omitted for 'spending', which is dynamic)
  wants?: number;
  savings?: number;
}

export const SPENDING_SAVINGS_PCT = 20; // 'spending' model reserves this for savings

export const BUDGET_MODELS: BudgetModel[] = [
  { id: 'balanced',  name: '50 / 30 / 20', tagline: 'Balanced — needs, wants, savings', needs: 50, wants: 30, savings: 20 },
  { id: 'essentials', name: '70 / 10 / 20', tagline: 'Essentials first',                 needs: 70, wants: 10, savings: 20 },
  { id: 'aggressive', name: '50 / 20 / 30', tagline: 'Aggressive saver',                 needs: 50, wants: 20, savings: 30 },
  { id: 'spending',   name: 'My spending',  tagline: `Your habits, with ${SPENDING_SAVINGS_PCT}% saved` },
];

// Keyword classifier (savings checked first so "savings" never matches "needs").
const KEYWORDS: Record<Bucket, string[]> = {
  savings: ['saving', 'save', 'invest', 'emergency', 'fund', 'retire', 'dps', 'deposit', 'goal'],
  needs: ['food', 'grocer', 'bazar', 'rent', 'bill', 'utilit', 'electric', 'water', 'gas', 'internet', 'transport', 'fuel', 'petrol', 'commute', 'bus', 'cng', 'rickshaw', 'health', 'medic', 'doctor', 'pharma', 'education', 'tuition', 'school', 'insurance', 'loan', 'emi', 'debt', 'mortgage'],
  wants: ['entertain', 'shopping', 'dining', 'restaurant', 'movie', 'cinema', 'game', 'hobby', 'treat', 'travel', 'trip', 'gift', 'subscription', 'netflix', 'spotify', 'cigarette', 'coffee', 'snack'],
};

export function classifyByKeyword(name: string): Bucket | null {
  const n = (name ?? '').toLowerCase();
  for (const b of ['savings', 'needs', 'wants'] as Bucket[]) {
    if (KEYWORDS[b].some((k) => n.includes(k))) return b;
  }
  return null;
}

export interface CatInput { id: string; name: string; spent: number; bucket: Bucket }
export interface Allocation { id: string; bucket: Bucket; budget: number }
export interface AllocationResult {
  allocations: Allocation[];
  savingsAmount: number;     // total savings for the period
  savingsHasHome: boolean;   // is there a savings category to hold it?
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Split a pool across categories weighted by past spend (even split if no history).
function distribute(pool: number, list: CatInput[]): Allocation[] {
  if (!list.length || pool <= 0) return list.map((c) => ({ id: c.id, bucket: c.bucket, budget: 0 }));
  const totalSpent = list.reduce((s, c) => s + Math.max(0, c.spent), 0);
  return list.map((c) => ({
    id: c.id,
    bucket: c.bucket,
    budget: round2(totalSpent > 0 ? pool * (Math.max(0, c.spent) / totalSpent) : pool / list.length),
  }));
}

export function allocateBudgets(model: BudgetModel, monthlyIncome: number, cats: CatInput[]): AllocationResult {
  const needsCats = cats.filter((c) => c.bucket === 'needs');
  const wantsCats = cats.filter((c) => c.bucket === 'wants');
  const savingsCats = cats.filter((c) => c.bucket === 'savings');

  const savingsPct = model.id === 'spending' ? SPENDING_SAVINGS_PCT : (model.savings ?? 0);
  const savingsAmount = round2(monthlyIncome * savingsPct / 100);

  let allocations: Allocation[];
  if (model.id === 'spending') {
    const spendable = monthlyIncome - savingsAmount;
    allocations = [...distribute(spendable, [...needsCats, ...wantsCats]), ...distribute(savingsAmount, savingsCats)];
  } else {
    let needsPool = monthlyIncome * (model.needs ?? 0) / 100;
    let wantsPool = monthlyIncome * (model.wants ?? 0) / 100;
    // If a spending bucket has no categories, fold its pool into the other so
    // income isn't silently dropped.
    if (!needsCats.length && wantsCats.length) { wantsPool += needsPool; needsPool = 0; }
    if (!wantsCats.length && needsCats.length) { needsPool += wantsPool; wantsPool = 0; }
    allocations = [
      ...distribute(needsPool, needsCats),
      ...distribute(wantsPool, wantsCats),
      ...distribute(savingsAmount, savingsCats),
    ];
  }
  return { allocations, savingsAmount, savingsHasHome: savingsCats.length > 0 };
}
