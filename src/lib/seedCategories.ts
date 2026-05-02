import { supabase } from './supabase';

const DEFAULT_CATEGORIES = [
  { name: 'Food', emoji: '🍔' },
  { name: 'Transport', emoji: '🚗' },
  { name: 'Shopping', emoji: '🛒' },
  { name: 'Health', emoji: '💊' },
  { name: 'Entertainment', emoji: '🎬' },
  { name: 'Bills', emoji: '📄' },
  { name: 'Education', emoji: '📚' },
  { name: 'Other', emoji: '💰' },
];

export async function seedDefaultCategories(userId: string): Promise<void> {
  const { data: existing } = await supabase
    .from('categories')
    .select('id')
    .eq('user_id', userId)
    .limit(1);

  if (existing && existing.length > 0) return;

  const payload = DEFAULT_CATEGORIES.map((c) => ({
    user_id: userId,
    name: c.name,
    emoji: c.emoji,
    budget: 0,
    spent: 0,
    color: '#6366F1',
    type: 'monthly',
  }));

  const { error } = await supabase.from('categories').insert(payload);
  if (error) {
    console.error('[seedCategories] Failed to seed default categories:', error);
  } else {
    console.log('[seedCategories] Default categories seeded for user:', userId);
  }
}
