import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Alert, Dimensions, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '../../contexts/ProfileContext';
import { supabase } from '../../lib/supabase';
import { t, fonts } from '../../theme/tokens';
import { styles } from './settingsStyles';
import Aurora from '../../components/Aurora';
import GlassCard from '../../components/GlassCard';
import BudgetModelSheet from './BudgetModelSheet';
import type { Category, BudgetPeriod } from './types';

const { width: SW, height: SH } = Dimensions.get('window');

const CAT_COLORS: Record<string, string> = {
  food: t.catFood, transport: t.catTransport, shopping: t.catShopping,
  bills: t.catBills, income: t.catIncome, uncategorized: t.catUncat,
};
function catColor(name: string): string {
  return CAT_COLORS[(name ?? '').toLowerCase()] ?? t.auraViolet;
}

export default function CategoriesModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { currencySymbol } = useProfile();
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmoji, setAddEmoji] = useState('💰');
  const [addBudget, setAddBudget] = useState('');
  const [addBudgetType, setAddBudgetType] = useState<BudgetPeriod>('monthly');
  const [saving, setSaving] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [editBudget, setEditBudget] = useState('');
  const [editBudgetType, setEditBudgetType] = useState<BudgetPeriod>('monthly');
  const [updating, setUpdating] = useState(false);
  const [showBudgetSheet, setShowBudgetSheet] = useState(false);

  const fetchCategories = async () => {
    if (!userId) return;
    const [catResult, txResult] = await Promise.all([
      supabase.from('categories').select('*').eq('user_id', userId),
      supabase.from('transactions').select('category_id, withdrawal, type').eq('user_id', userId),
    ]);
    const cats = (catResult.data ?? []) as Category[];
    const txs = txResult.data ?? [];
    const spentMap: Record<string, number> = {};
    for (const tx of txs) {
      if (tx.type === 'expense' && tx.category_id) {
        spentMap[tx.category_id] = (spentMap[tx.category_id] ?? 0) + (Number(tx.withdrawal) || 0);
      }
    }
    setLoading(false);
    setCategories(cats.map((c) => ({ ...c, spent: spentMap[c.id] ?? 0 })));
  };

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    const subscription = supabase
      .channel(`categories-changes-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'categories', filter: `user_id=eq.${userId}` }, () => {
        fetchCategories().catch(() => setLoading(false));
      })
      .subscribe();
    fetchCategories().catch(() => { setLoading(false); setCategories([]); supabase.removeChannel(subscription); });
    return () => { supabase.removeChannel(subscription); };
  }, [userId]);

  const handleAddCategory = async () => {
    const name = addName.trim();
    if (!name || !userId) return;
    setSaving(true);
    const { error } = await supabase.from('categories').insert({
      user_id: userId, name, emoji: addEmoji.trim() || '💰', color: '#6366F1',
      spent: 0, budget: parseFloat(addBudget) || 0, type: addBudgetType,
    }).select('*');
    setSaving(false);
    if (error) { Alert.alert('Error', `Could not save: ${error.message}`); return; }
    Alert.alert('Success', 'Category added');
    setAddName(''); setAddEmoji('💰'); setAddBudget(''); setAddBudgetType('monthly'); setShowAddForm(false);
    fetchCategories();
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory || !userId || !editName.trim()) return;
    setUpdating(true);
    const budgetVal = parseFloat(editBudget);
    const { error } = await supabase.from('categories').update({
      name: editName.trim(), emoji: editEmoji.trim() || '💰',
      budget: isNaN(budgetVal) ? 0 : budgetVal, type: editBudgetType,
    }).eq('id', editingCategory.id).eq('user_id', userId);
    setUpdating(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setEditingCategory(null);
    fetchCategories();
  };

  // Smart Budget (model-based) lives in BudgetModelSheet — opened from the
  // "AI Budget" button below.

  const handleDeleteCategory = (id: string, name: string) => {
    Alert.alert('Delete Category', `Delete "${name}"? Linked transactions will be uncategorized.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('transactions').update({ category_id: null }).eq('category_id', id).eq('user_id', userId);
          await supabase.from('categories').delete().eq('id', id).eq('user_id', userId);
          setCategories((c) => c.filter((x) => x.id !== id));
        },
      },
    ]);
  };

  const startEdit = (cat: Category) => {
    setEditingCategory(cat); setEditName(cat.name); setEditEmoji(cat.emoji || '💰');
    setEditBudget(cat.budget ? String(cat.budget) : ''); setEditBudgetType((cat.type as BudgetPeriod) || 'monthly');
    setShowAddForm(false);
  };

  // Render form (add or edit)
  const renderForm = (mode: 'add' | 'edit') => {
    const isEdit = mode === 'edit';
    const nameVal = isEdit ? editName : addName;
    const setNameVal = isEdit ? setEditName : setAddName;
    const emojiVal = isEdit ? editEmoji : addEmoji;
    const setEmojiVal = isEdit ? setEditEmoji : setAddEmoji;
    const budgetVal = isEdit ? editBudget : addBudget;
    const setBudgetVal = isEdit ? setEditBudget : setAddBudget;
    const periodVal = isEdit ? editBudgetType : addBudgetType;
    const setPeriodVal = isEdit ? setEditBudgetType : setAddBudgetType;
    const isSaving = isEdit ? updating : saving;
    const onSave = isEdit ? handleUpdateCategory : handleAddCategory;
    const onCancel = isEdit
      ? () => setEditingCategory(null)
      : () => { setShowAddForm(false); setAddName(''); setAddEmoji('💰'); setAddBudget(''); };

    return (
      <GlassCard style={styles.formCard}>
        <Text style={styles.formTitle}>{isEdit ? 'Edit category' : 'New category'}</Text>
        <TextInput style={styles.formInput} placeholder="Category name" placeholderTextColor={t.text3} value={nameVal} onChangeText={setNameVal} />
        <TextInput style={styles.formInput} placeholder="Emoji (e.g. 🍔)" placeholderTextColor={t.text3} value={emojiVal} onChangeText={setEmojiVal} />
        <TextInput style={styles.formInput} placeholder={`Budget amount (${currencySymbol})`} placeholderTextColor={t.text3} value={budgetVal} onChangeText={setBudgetVal} keyboardType="decimal-pad" />
        <Text style={styles.formLabel}>Budget period</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
          {(['daily', 'weekly', 'monthly'] as const).map((opt) => {
            const active = periodVal === opt;
            return (
              <TouchableOpacity key={opt} style={[styles.chip, active && styles.chipActive, { flex: 1, alignItems: 'center' }]} onPress={() => setPeriodVal(opt)} activeOpacity={0.8}>
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.formRow}>
          <TouchableOpacity style={styles.btnSecondary} onPress={onCancel}>
            <Text style={styles.btnSecondaryText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnPrimary} onPress={onSave} disabled={isSaving || !nameVal.trim()}>
            {isSaving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPrimaryText}>Save</Text>}
          </TouchableOpacity>
        </View>
      </GlassCard>
    );
  };

  return (
    <View style={styles.modalRoot}>
      <Aurora width={SW} height={SH} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Categories</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Text style={styles.closeBtnText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Quick actions */}
          {!showAddForm && !editingCategory && (
            <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 22, paddingBottom: 12 }}>
              <TouchableOpacity style={styles.aiBudgetBtn} onPress={() => setShowBudgetSheet(true)} disabled={categories.length === 0} activeOpacity={0.8}>
                <Text style={{ fontSize: 16 }}>✨</Text>
                <Text style={styles.aiBudgetText}>Smart Budget</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.addBtn, { flex: 1, justifyContent: 'center' }]} onPress={() => setShowAddForm(true)} activeOpacity={0.8}>
                <Text style={{ fontSize: 14, color: '#fff' }}>+</Text>
                <Text style={styles.addBtnText}>Add Category</Text>
              </TouchableOpacity>
            </View>
          )}

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
            {showAddForm && renderForm('add')}
            {editingCategory && renderForm('edit')}

            {loading ? (
              <View style={styles.modalLoading}><ActivityIndicator size="large" color={t.auraAqua} /></View>
            ) : categories.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No categories yet</Text>
                <Text style={styles.emptySubtitle}>Add your first category</Text>
                <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)}>
                  <Text style={styles.addBtnText}>Add Category</Text>
                </TouchableOpacity>
              </View>
            ) : (
              categories.map((cat) => {
                const budget = cat.budget ?? 0;
                const spent = cat.spent ?? 0;
                const hasBudget = budget > 0;
                const pct = hasBudget ? Math.round((spent / budget) * 100) : 0;
                const over = hasBudget && spent > budget;
                const color = catColor(cat.name);
                return (
                  <GlassCard key={cat.id} style={styles.catCard}>
                    <View style={styles.catTopRow}>
                      <View style={[styles.catIcon, { backgroundColor: color + '26', borderWidth: 1, borderColor: color + '42' }]}>
                        <Text style={{ fontSize: 22 }}>{cat.emoji || '💰'}</Text>
                      </View>
                      <View style={styles.catInfo}>
                        <Text style={styles.catName}>{cat.name}</Text>
                        {hasBudget && (
                          <Text style={styles.catBudget}>
                            Budget {currencySymbol}{budget.toFixed(0)} · {cat.type || 'monthly'}
                          </Text>
                        )}
                      </View>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity style={[styles.miniBtn, { borderColor: t.auraViolet + '45' }]} onPress={() => startEdit(cat)} activeOpacity={0.7}>
                          <Text style={{ fontSize: 16 }}>✏️</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.miniBtn, { backgroundColor: t.redTint, borderColor: t.red + '45' }]} onPress={() => handleDeleteCategory(cat.id, cat.name)} activeOpacity={0.7}>
                          <Text style={{ fontSize: 16 }}>🗑️</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {hasBudget && (
                      <View style={styles.catProgress}>
                        <View style={styles.catProgressHeader}>
                          <Text style={styles.catSpent}>Spent {currencySymbol}{spent.toFixed(0)}</Text>
                          <Text style={[styles.catPct, { color: over ? t.red : t.text3 }]}>{pct}%</Text>
                        </View>
                        <View style={styles.barTrack}>
                          <View style={[styles.barFill, { width: `${Math.min(100, pct)}%`, backgroundColor: over ? t.red : color }]} />
                        </View>
                      </View>
                    )}
                  </GlassCard>
                );
              })
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal visible={showBudgetSheet} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setShowBudgetSheet(false)}>
        <BudgetModelSheet
          userId={userId}
          categories={categories}
          currencySymbol={currencySymbol}
          onClose={() => setShowBudgetSheet(false)}
          onApplied={fetchCategories}
        />
      </Modal>
    </View>
  );
}
