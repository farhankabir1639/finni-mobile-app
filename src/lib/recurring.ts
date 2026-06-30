// ── Recurring transactions — DB operations + catch-up engine ────────────────
//
// Templates live in `recurring_transactions`; the catch-up engine materializes
// due occurrences into `transactions` on app open (idempotent via the unique
// (recurring_id, date) index). Pure date math is in recurring_schedule.ts.
// See docs/recurring-transactions-spec.md.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { captureError } from './sentry';
import {
  advance, nextFutureOccurrence, planOccurrences, type Frequency,
} from './recurring_schedule';

const CATCH_UP_CAP = 90; // max occurrences materialized per template per run

export interface RecurringTemplate {
  id: string;
  user_id: string;
  amount: number;
  description: string | null;
  category_id: string | null;
  type: 'expense' | 'income';
  frequency: Frequency;
  anchor_day: number | null;
  anchor_weekday: number | null;
  next_run: string;
  last_run: string | null;
  active: boolean;
  reminder_enabled: boolean;
  reminder_days_before: number;
}

function localToday(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export interface CreateRecurringInput {
  amount: number;
  description: string | null;
  categoryId: string | null;
  type: 'expense' | 'income';
  frequency: Frequency;
  anchorDay?: number;      // monthly (defaults to today's day-of-month)
  anchorWeekday?: number;  // weekly/biweekly (defaults to today's weekday)
}

// Create a template. next_run is the next FUTURE occurrence, so the
// just-logged transaction stays as the current period's instance (no
// back-dating, no double-count).
export async function createRecurring(userId: string, input: CreateRecurringInput): Promise<RecurringTemplate | null> {
  if (!userId || input.amount <= 0) return null;
  const today = localToday();
  const next_run = nextFutureOccurrence(today, input.frequency, {
    anchorDay: input.anchorDay,
    anchorWeekday: input.anchorWeekday,
  });
  try {
    const { data, error } = await supabase
      .from('recurring_transactions')
      .insert({
        user_id: userId,
        amount: input.amount,
        description: input.description,
        category_id: input.categoryId,
        type: input.type,
        frequency: input.frequency,
        anchor_day: input.frequency === 'monthly' ? (input.anchorDay ?? Number(today.split('-')[2])) : null,
        anchor_weekday: (input.frequency === 'weekly' || input.frequency === 'biweekly') ? (input.anchorWeekday ?? null) : null,
        next_run,
        active: true,
      })
      .select()
      .single();
    if (error || !data) return null;
    return data as RecurringTemplate;
  } catch (e) {
    captureError(e, { context: 'createRecurring', userId });
    return null;
  }
}

export async function listRecurring(userId: string): Promise<RecurringTemplate[]> {
  if (!userId) return [];
  try {
    const { data } = await supabase
      .from('recurring_transactions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    return (data ?? []) as RecurringTemplate[];
  } catch {
    return [];
  }
}

export async function pauseRecurring(id: string, active: boolean): Promise<void> {
  try {
    // On resume, don't back-fill the paused gap — advance next_run to today.
    const patch: Record<string, unknown> = { active };
    if (active) patch.next_run = localToday();
    await supabase.from('recurring_transactions').update(patch).eq('id', id);
  } catch (e) {
    captureError(e, { context: 'pauseRecurring' });
  }
}

// Opt-in bill reminder: notify N days before this expense's next occurrence.
// The daily push cron reads these fields.
export async function setRecurringReminder(id: string, enabled: boolean, daysBefore: number): Promise<void> {
  try {
    await supabase
      .from('recurring_transactions')
      .update({ reminder_enabled: enabled, reminder_days_before: daysBefore })
      .eq('id', id);
  } catch (e) {
    captureError(e, { context: 'setRecurringReminder' });
  }
}

export async function deleteRecurring(id: string): Promise<void> {
  try {
    await supabase.from('recurring_transactions').delete().eq('id', id);
  } catch (e) {
    captureError(e, { context: 'deleteRecurring' });
  }
}

// Materialize all due occurrences for the user. Runs at most once per local day
// (guarded), inserts idempotently, and never lets one bad template block others.
export async function materializeDueRecurring(userId: string): Promise<number> {
  if (!userId) return 0;
  const today = localToday();
  const ranKey = `recurring_ran_${userId}_${today}`;
  try {
    if (await AsyncStorage.getItem(ranKey)) return 0;
  } catch { /* ignore */ }

  let created = 0;
  try {
    const { data } = await supabase
      .from('recurring_transactions')
      .select('*')
      .eq('user_id', userId)
      .eq('active', true)
      .lte('next_run', today);
    const due = (data ?? []) as RecurringTemplate[];

    for (const tpl of due) {
      try {
        const plan = planOccurrences(tpl.next_run, today, tpl.frequency, tpl.anchor_day ?? undefined, CATCH_UP_CAP);
        if (plan.occurrences.length) {
          // Mirror the column shape the app's own transaction insert uses
          // (balance / given_to / matching_score are set there, so treat them
          // as required to avoid a NOT NULL insert failure).
          const desc = tpl.description ?? '';
          const rows = plan.occurrences.map((date) => ({
            user_id: userId,
            recurring_id: tpl.id,
            date,
            description: desc,
            given_to: desc,
            balance: 0,
            matching_score: 0,
            category_id: tpl.category_id,
            type: tpl.type,
            withdrawal: tpl.type === 'expense' ? tpl.amount : 0,
            deposit: tpl.type === 'income' ? tpl.amount : 0,
          }));
          const { error } = await supabase
            .from('transactions')
            .upsert(rows, { onConflict: 'recurring_id,date', ignoreDuplicates: true });
          if (error) throw error;
          created += plan.occurrences.length;
        }
        await supabase
          .from('recurring_transactions')
          .update({ next_run: plan.newNextRun, last_run: plan.occurrences[plan.occurrences.length - 1] ?? tpl.last_run })
          .eq('id', tpl.id);
        if (plan.skipped > 0 && __DEV__) console.log(`[recurring] ${tpl.id} skipped ${plan.skipped} occurrences (cap)`);
      } catch (e) {
        captureError(e, { context: 'recurring.materialize', templateId: tpl.id });
      }
    }
    try { await AsyncStorage.setItem(ranKey, '1'); } catch { /* ignore */ }
  } catch (e) {
    captureError(e, { context: 'materializeDueRecurring', userId });
  }
  return created;
}

// Re-export for callers that want to show "next run" labels.
export { advance };
