// ── Email-capture client layer ──────────────────────────────────────────────
// Forwarding-alias management + the auto-captured review queue.
// Accepting an item inserts a normal transaction (matching the app's shape) and
// marks the staged row accepted. See docs/email-forwarding-v1-spec.md.

import { supabase } from './supabase';
import { captureError } from './sentry';

const ALIAS_DOMAIN = 'in.heyfinni.com';

export interface ExtractedTxn {
  id: string;
  source: 'email' | 'push';
  amount: number;
  direction: 'expense' | 'income';
  merchant: string | null;
  currency: string | null;
  occurred_at: string | null;
  suggested_category_id: string | null;
  confidence: number | null;
  status: 'pending' | 'accepted' | 'rejected';
}

function makeToken(): string {
  // Unguessable-ish alias token (no native crypto dependency required).
  return `${Math.random().toString(36).slice(2, 8)}${Math.random().toString(36).slice(2, 8)}`;
}

// Return the user's forwarding alias, creating the connection on first use.
export async function getOrCreateForwardingAlias(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data: existing } = await supabase
      .from('email_sms_connections')
      .select('forwarding_alias')
      .eq('user_id', userId).eq('connection_type', 'email')
      .maybeSingle();
    if (existing?.forwarding_alias) return existing.forwarding_alias;

    const alias = `u-${makeToken()}@${ALIAS_DOMAIN}`;
    const { error } = await supabase.from('email_sms_connections').insert({
      user_id: userId, connection_type: 'email', forwarding_alias: alias, is_active: true,
    });
    if (error) { captureError(error, { context: 'getOrCreateForwardingAlias' }); return null; }
    return alias;
  } catch (e) {
    captureError(e, { context: 'getOrCreateForwardingAlias' });
    return null;
  }
}

export async function getPendingCount(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    const { count } = await supabase
      .from('extracted_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId).eq('status', 'pending');
    return count ?? 0;
  } catch {
    return 0;
  }
}

export async function listPending(userId: string): Promise<ExtractedTxn[]> {
  if (!userId) return [];
  try {
    const { data } = await supabase
      .from('extracted_transactions')
      .select('id, source, amount, direction, merchant, currency, occurred_at, suggested_category_id, confidence, status')
      .eq('user_id', userId).eq('status', 'pending')
      .order('created_at', { ascending: false });
    return (data ?? []) as ExtractedTxn[];
  } catch {
    return [];
  }
}

// Accept → insert a real transaction (same column shape the app uses) + mark accepted.
export async function acceptExtracted(userId: string, item: ExtractedTxn, categoryId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    const isExpense = item.direction !== 'income';
    const desc = item.merchant ?? 'Imported transaction';
    const { error: insErr } = await supabase.from('transactions').insert({
      user_id: userId,
      withdrawal: isExpense ? item.amount : 0,
      deposit: isExpense ? 0 : item.amount,
      balance: 0,
      given_to: desc,
      description: desc,
      type: isExpense ? 'expense' : 'income',
      date: item.occurred_at ?? new Date().toISOString(),
      matching_score: Math.round((item.confidence ?? 0.5) * 100),
      category_id: categoryId,
    });
    if (insErr) { captureError(insErr, { context: 'acceptExtracted.insert' }); return false; }
    await supabase.from('extracted_transactions').update({ status: 'accepted' }).eq('id', item.id).eq('user_id', userId);
    return true;
  } catch (e) {
    captureError(e, { context: 'acceptExtracted' });
    return false;
  }
}

export async function rejectExtracted(userId: string, id: string): Promise<void> {
  try {
    await supabase.from('extracted_transactions').update({ status: 'rejected' }).eq('id', id).eq('user_id', userId);
  } catch (e) {
    captureError(e, { context: 'rejectExtracted' });
  }
}
