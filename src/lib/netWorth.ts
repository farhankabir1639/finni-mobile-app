// ── Net-worth tracker ────────────────────────────────────────────────────────
// Manual assets + liabilities. The live investment portfolio is auto-included as
// an asset (pulled from `investments`, never duplicated here).
//   net worth = (manual assets + investments) − liabilities

import { supabase } from './supabase';
import { captureError } from './sentry';

export type NetWorthKind = 'asset' | 'liability';

export interface NetWorthItem {
  id: string;
  kind: NetWorthKind;
  name: string;
  item_type: string | null;
  value: number;
}

// Type options per kind. "Debt" lives on the liability side.
export const ASSET_TYPES = ['cash', 'savings', 'property', 'vehicle', 'other'] as const;
export const LIABILITY_TYPES = ['debt', 'loan', 'credit_card', 'mortgage', 'other'] as const;

export const TYPE_LABELS: Record<string, string> = {
  cash: 'Cash', savings: 'Savings', property: 'Property', vehicle: 'Vehicle',
  debt: 'Debt', loan: 'Loan', credit_card: 'Credit card', mortgage: 'Mortgage',
  other: 'Other',
};

export interface NetWorthSummary {
  assets: NetWorthItem[];
  liabilities: NetWorthItem[];
  investmentsValue: number;   // live portfolio, auto-included as an asset
  totalAssets: number;        // manual assets + investments
  totalLiabilities: number;
  netWorth: number;
}

export async function getNetWorth(userId: string): Promise<NetWorthSummary> {
  const empty: NetWorthSummary = {
    assets: [], liabilities: [], investmentsValue: 0,
    totalAssets: 0, totalLiabilities: 0, netWorth: 0,
  };
  if (!userId) return empty;
  try {
    const [{ data: items }, { data: invs }] = await Promise.all([
      supabase.from('net_worth_items').select('id, kind, name, item_type, value').eq('user_id', userId),
      supabase.from('investments').select('quantity, current_value').eq('user_id', userId),
    ]);
    const all = (items ?? []) as NetWorthItem[];
    const assets = all.filter((i) => i.kind === 'asset');
    const liabilities = all.filter((i) => i.kind === 'liability');
    const investmentsValue = (invs ?? []).reduce(
      (sum, r: any) => sum + (Number(r.quantity) || 0) * (Number(r.current_value) || 0), 0);
    const manualAssets = assets.reduce((s, i) => s + (Number(i.value) || 0), 0);
    const totalAssets = manualAssets + investmentsValue;
    const totalLiabilities = liabilities.reduce((s, i) => s + (Number(i.value) || 0), 0);
    return {
      assets, liabilities, investmentsValue,
      totalAssets, totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
    };
  } catch (e) {
    captureError(e, { context: 'getNetWorth' });
    return empty;
  }
}

export async function addNetWorthItem(
  userId: string, kind: NetWorthKind, name: string, itemType: string, value: number
): Promise<boolean> {
  try {
    const { error } = await supabase.from('net_worth_items')
      .insert({ user_id: userId, kind, name: name.trim(), item_type: itemType, value });
    if (error) { captureError(error, { context: 'addNetWorthItem' }); return false; }
    return true;
  } catch (e) {
    captureError(e, { context: 'addNetWorthItem' });
    return false;
  }
}

export async function updateNetWorthItem(
  userId: string, id: string, patch: { name?: string; item_type?: string; value?: number }
): Promise<boolean> {
  try {
    const { error } = await supabase.from('net_worth_items')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id).eq('user_id', userId);
    if (error) { captureError(error, { context: 'updateNetWorthItem' }); return false; }
    return true;
  } catch (e) {
    captureError(e, { context: 'updateNetWorthItem' });
    return false;
  }
}

export async function deleteNetWorthItem(userId: string, id: string): Promise<void> {
  try {
    await supabase.from('net_worth_items').delete().eq('id', id).eq('user_id', userId);
  } catch (e) {
    captureError(e, { context: 'deleteNetWorthItem' });
  }
}
