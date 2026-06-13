import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { CategoryProposal } from './agents';

// Pending category proposals are persisted per-user so they survive an app
// background/restart and can be auto-created when the session ends (the user's
// chosen behavior: ask first, save the transaction under "Other" now, then
// auto-create the category if they don't respond).

const storageKey = (userId: string) => `finni_pending_categories_${userId}`;

export async function getPendingProposals(userId: string): Promise<CategoryProposal[]> {
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    return raw ? (JSON.parse(raw) as CategoryProposal[]) : [];
  } catch {
    return [];
  }
}

async function setPending(userId: string, list: CategoryProposal[]): Promise<void> {
  try {
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(list));
  } catch {
    // best-effort; a failed persist just means the live card still works
  }
}

// Merge freshly-proposed categories into the persisted pending list (by name).
export async function addPendingProposals(userId: string, proposals: CategoryProposal[]): Promise<void> {
  if (!proposals.length) return;
  const current = await getPendingProposals(userId);
  for (const p of proposals) {
    const existing = current.find((c) => c.name.toLowerCase() === p.name.toLowerCase());
    if (existing) {
      for (const id of p.transactionIds) {
        if (!existing.transactionIds.includes(id)) existing.transactionIds.push(id);
      }
    } else {
      current.push({ ...p, transactionIds: [...p.transactionIds] });
    }
  }
  await setPending(userId, current);
}

export async function removePendingProposal(userId: string, name: string): Promise<void> {
  const current = await getPendingProposals(userId);
  await setPending(userId, current.filter((c) => c.name.toLowerCase() !== name.toLowerCase()));
}

// Create the proposed category (or reuse one that already exists) and re-tag the
// transactions that were temporarily saved under "Other". Returns the category
// id, or null on failure.
export async function createProposedCategory(userId: string, p: CategoryProposal): Promise<string | null> {
  try {
    let catId: string | null = null;

    const { data: existing } = await supabase
      .from('categories')
      .select('id')
      .eq('user_id', userId)
      .ilike('name', p.name)
      .maybeSingle();

    if (existing) {
      catId = existing.id as string;
    } else {
      const { data: created, error } = await supabase
        .from('categories')
        .insert({
          user_id: userId,
          name: p.name,
          emoji: p.emoji,
          budget: 0,
          spent: 0,
          color: '#6366F1',
          type: 'monthly',
        })
        .select()
        .single();
      if (error || !created) return null;
      catId = created.id as string;
    }

    if (catId && p.transactionIds.length) {
      await supabase
        .from('transactions')
        .update({ category_id: catId })
        .in('id', p.transactionIds)
        .eq('user_id', userId);
    }
    return catId;
  } catch {
    return null;
  }
}

// Auto-create every still-pending proposal, then clear the store. Idempotent —
// safe to call from multiple lifecycle hooks (session end, app background,
// next app open). Returns how many categories were created/resolved.
export async function resolvePendingProposals(userId: string): Promise<number> {
  const pending = await getPendingProposals(userId);
  if (!pending.length) return 0;
  let resolved = 0;
  for (const p of pending) {
    const id = await createProposedCategory(userId, p);
    if (id) resolved++;
  }
  await setPending(userId, []);
  return resolved;
}
