// ── Purchases (RevenueCat seam) ──────────────────────────────────────────────
// Single integration point for in-app subscriptions. RevenueCat
// (react-native-purchases) is a NATIVE module — installing it requires a new
// dev/prod build, and the buy calls need the product IDs created in Play
// Console / App Store Connect. Until that's wired, these are safe no-ops so the
// Paywall can ship and show pricing now (the founder's stated goal: pricing
// visible first, purchase + AppSumo next).
//
// To go live, flip PURCHASES_ENABLED, `expo install react-native-purchases`,
// and fill in the TODO bodies. Entitlement truth still lives on `profiles.plan`
// (synced by the RevenueCat webhook → see supabase/functions, Phase-0 follow-up).

export const PURCHASES_ENABLED = false;

export type PlanId = 'monthly' | 'annual';

export type PurchaseResult = {
  ok: boolean;
  isPro: boolean;
  /** 'not_ready' while PURCHASES_ENABLED is false; 'cancelled' on user cancel. */
  reason?: 'not_ready' | 'cancelled' | 'error';
  message?: string;
};

/** Configure the SDK with the signed-in user. Call once after auth. */
export async function initPurchases(_userId: string): Promise<void> {
  if (!PURCHASES_ENABLED) return;
  // TODO(revenuecat): Purchases.configure({ apiKey, appUserID: _userId });
}

/** Live prices to render. Falls back to the static PRICING constant until wired. */
export async function getProOfferings(): Promise<null> {
  if (!PURCHASES_ENABLED) return null;
  // TODO(revenuecat): return (await Purchases.getOfferings()).current;
  return null;
}

export async function purchasePlan(_plan: PlanId): Promise<PurchaseResult> {
  if (!PURCHASES_ENABLED) {
    return { ok: false, isPro: false, reason: 'not_ready', message: 'Subscriptions launch in the next update.' };
  }
  // TODO(revenuecat): purchase the package, then refresh profiles.plan via webhook/customerInfo.
  return { ok: false, isPro: false, reason: 'error' };
}

export async function restorePurchases(): Promise<PurchaseResult> {
  if (!PURCHASES_ENABLED) {
    return { ok: false, isPro: false, reason: 'not_ready', message: 'Subscriptions launch in the next update.' };
  }
  // TODO(revenuecat): const info = await Purchases.restorePurchases();
  return { ok: false, isPro: false, reason: 'error' };
}
