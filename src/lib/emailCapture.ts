// ── Email-capture client layer ──────────────────────────────────────────────
// Forwarding-alias management + the auto-captured review queue.
// Accepting an item inserts a normal transaction (matching the app's shape) and
// marks the staged row accepted. See docs/email-forwarding-v1-spec.md.

import { supabase } from './supabase';
import { captureError } from './sentry';

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

// Return the user's forwarding alias, creating the connection on first use.
// The alias is generated DB-side (gen_random_uuid default → unguessable), not
// client-side, so it can't be predicted or brute-forced. Requires the
// 20260702_harden_alias migration (sets the column default).
export async function getOrCreateForwardingAlias(userId: string): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data: existing } = await supabase
      .from('email_sms_connections')
      .select('forwarding_alias')
      .eq('user_id', userId).eq('connection_type', 'email')
      .maybeSingle();
    if (existing?.forwarding_alias) return existing.forwarding_alias;

    // Insert without an alias — the DB default fills an unguessable one; read it back.
    const { data, error } = await supabase.from('email_sms_connections')
      .insert({ user_id: userId, connection_type: 'email', is_active: true })
      .select('forwarding_alias')
      .single();
    if (error || !data?.forwarding_alias) {
      captureError(error ?? new Error('alias not generated'), { context: 'getOrCreateForwardingAlias' });
      return null;
    }
    return data.forwarding_alias as string;
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
      .eq('user_id', userId).eq('status', 'pending')
      .gt('amount', 0);   // exclude legacy prototype rows (null/0 amount)
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
      .gt('amount', 0)   // exclude legacy prototype rows (null/0 amount)
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
    // Atomically claim the row (pending → accepted) BEFORE inserting, so a
    // double-tap or the two mount points (ReviewModal + ReviewScreen tab) can't
    // both insert and double-book. Only the caller that flips it proceeds.
    const { data: claimed } = await supabase
      .from('extracted_transactions')
      .update({ status: 'accepted' })
      .eq('id', item.id).eq('user_id', userId).eq('status', 'pending')
      .select('id');
    if (!claimed || claimed.length === 0) return true; // already processed

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
    if (insErr) {
      // Revert the claim so the item returns to the queue and can be retried.
      await supabase.from('extracted_transactions').update({ status: 'pending' }).eq('id', item.id).eq('user_id', userId);
      captureError(insErr, { context: 'acceptExtracted.insert' });
      return false;
    }
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
