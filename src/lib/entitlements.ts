// ── Entitlements ─────────────────────────────────────────────────────────────
// Single Pro tier. Source of truth for plan + AI quota lives on the `profiles`
// row (server-enforced in the gemini-proxy edge function via consume_ai_action).
// This module is the client-side read layer + the catalog of what Pro unlocks.
//
// Keep FREE_AI_LIMIT / PRO_AI_LIMIT in sync with the proxy defaults
// (supabase/functions/gemini-proxy/index.ts) and the SQL RPC defaults
// (supabase/migrations/20260619_entitlements.sql).

import { useProfile } from '../contexts/ProfileContext';

export const FREE_AI_LIMIT = 50;   // AI actions / month, free tier
export const PRO_AI_LIMIT = 500;   // AI actions / month, Pro fair-use

export const PRICING = {
  monthly: { price: '$9.99', period: 'month' },
  annual: { price: '$79', period: 'year', note: 'Save 34%' },
} as const;

// Features gated behind Pro. Used as the `feature` key on <ProGate>.
export type ProFeature =
  | 'insights'
  | 'email_coach'
  | 'smart_budget'
  | 'recurring'
  | 'investments'
  | 'multi_currency'
  | 'voice'
  | 'export'
  | 'sheets_sync'
  | 'auto_capture';

// Short, human copy for each gate (shown on the paywall when entered from a feature).
export const PRO_FEATURE_COPY: Record<ProFeature, { title: string; blurb: string }> = {
  insights: { title: 'AI Insights', blurb: 'Personalized coaching on where your money goes.' },
  email_coach: { title: 'Email Coach', blurb: 'Daily & weekly money reports in your inbox.' },
  smart_budget: { title: 'Smart Budget', blurb: 'Auto-build a 50/30/20 budget from your income.' },
  recurring: { title: 'Recurring', blurb: 'Auto-log rent, subscriptions and bills.' },
  investments: { title: 'Investments', blurb: 'Track your portfolio and net worth.' },
  multi_currency: { title: 'Multi-currency', blurb: 'Track money in more than one currency.' },
  voice: { title: 'Voice Logging', blurb: 'Just talk — Finni logs it for you.' },
  export: { title: 'Export', blurb: 'Download your data as CSV or PDF.' },
  sheets_sync: { title: 'Google Sheets Sync', blurb: 'Auto-sync transactions to your spreadsheet.' },
  auto_capture: { title: 'Auto-capture', blurb: 'Forward bank emails — Finni logs them automatically.' },
};

export type Entitlement = {
  isPro: boolean;
  plan: 'free' | 'pro';
  aiLimit: number;
  aiUsed: number;
  aiRemaining: number;
};

// Active-Pro = plan is 'pro' AND not expired (lifetime/AppSumo carry a null expiry).
export function useEntitlement(): Entitlement {
  const { profile } = useProfile();
  const notExpired = !profile.planExpiresAt || new Date(profile.planExpiresAt).getTime() > Date.now();
  const isPro = profile.plan === 'pro' && notExpired;
  const aiLimit = isPro ? PRO_AI_LIMIT : FREE_AI_LIMIT;
  const aiUsed = profile.aiActionsUsed ?? 0;
  return {
    isPro,
    plan: isPro ? 'pro' : 'free',
    aiLimit,
    aiUsed,
    aiRemaining: Math.max(0, aiLimit - aiUsed),
  };
}
