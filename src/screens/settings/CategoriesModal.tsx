import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '../../contexts/ProfileContext';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { styles } from './settingsStyles';
import type { Category, BudgetPeriod } from './types';

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
  const [editColor, setEditColor] = useState('#6366F1');
  const [updating, setUpdating] = useState(false);

  const EDIT_COLOR_PALETTE = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#F97316'];

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

    const enriched = cats.map((c) => ({ ...c, spent: spentMap[c.id] ?? 0 }));
    setLoading(false);
    setCategories(enriched);
  };

  useEffect(() => {
    if (!userId) return;
    setLoading(true);

    const subscription = supabase
      .channel('categories-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'categories', filter: `user_id=eq.${userId}` },
        () => {
          fetchCategories().catch((e) => {
            console.error('[Categories] Realtime refetch error:', e);
            setLoading(false);
          });
        }
      )
      .subscribe();

    fetchCategories().catch((e) => {
      console.error('[Categories] Initial fetch error:', e);
      setLoading(false);
      setCategories([]);
      supabase.removeChannel(subscription);
    });

    return () => { supabase.removeChannel(subscription); };
  }, [userId]);

  const handleAddCategory = async () => {
    const name = addName.trim();
    const budgetAmount = parseFloat(addBudget) || 0;
    if (!name || !userId) return;
    setSaving(true);

    const budgetPeriod = addBudgetType === 'daily' ? 'Daily' : addBudgetType === 'weekly' ? 'Weekly' : 'Monthly';
    const payload = {
      user_id: userId,
      name,
      emoji: addEmoji.trim() || '💰',
      color: '#6366F1',
      spent: 0,
      budget: budgetAmount,
      type: budgetPeriod.toLowerCase(),
    };
    console.log('[Categories] Insert payload:', payload);

    const { data, error } = await supabase.from('categories').insert(payload).select('*');
    setSaving(false);
    if (error) {
      console.warn('Category insert error:', error);
      Alert.alert('Error', `Could not save category: ${error.message}`);
      return;
    }
    console.log('[Categories] Insert success:', data);
    Alert.alert('Success', 'Category added successfully');
    setAddName('');
    setAddEmoji('💰');
    setAddBudget('');
    setAddBudgetType('monthly');
    setShowAddForm(false);
    fetchCategories();
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory || !userId) return;
    const name = editName.trim();
    if (!name) {
      Alert.alert('Error', 'Category name cannot be empty.');
      return;
    }
    setUpdating(true);
    const { error } = await supabase
      .from('categories')
      .update({ name, emoji: editEmoji.trim() || '💰', color: editColor })
      .eq('id', editingCategory.id)
      .eq('user_id', userId);
    setUpdating(false);
    if (error) {
      Alert.alert('Error', `Could not update category: ${error.message || JSON.stringify(error)}`);
      return;
    }
    setEditingCategory(null);
    fetchCategories();
  };

  const handleDeleteCategory = (id: string) => {
    Alert.alert(
      'Delete Category',
      'Deleting this category will mark all linked transactions as Uncategorized. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error: txError } = await supabase
              .from('transactions')
              .update({ category_id: null })
              .eq('category_id', id)
              .eq('user_id', userId);
            if (txError) { console.warn('Transaction update error:', txError); return; }
            const { error } = await supabase
              .from('categories')
              .delete()
              .eq('id', id)
              .eq('user_id', userId);
            if (error) { console.warn('Category delete error:', error); return; }
            setCategories((c) => c.filter((x) => x.id !== id));
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.fullModal} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.fullModalInner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.modalHeaderTitle}>Categories</Text>
          <View style={styles.modalHeaderRight}>
            {!showAddForm && !editingCategory && (
              <TouchableOpacity style={styles.addButton} onPress={() => setShowAddForm(true)} activeOpacity={0.8}>
                <Text style={styles.addButtonText}>Add Category</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showAddForm ? (
          <View style={styles.addForm}>
            <TextInput style={styles.formInput} placeholder="Category name" placeholderTextColor={colors.textSecondary} value={addName} onChangeText={setAddName} />
            <TextInput style={styles.formInput} placeholder="Emoji (e.g. 🍔)" placeholderTextColor={colors.textSecondary} value={addEmoji} onChangeText={setAddEmoji} />
            <TextInput style={styles.formInput} placeholder="Budget amount" placeholderTextColor={colors.textSecondary} value={addBudget} onChangeText={setAddBudget} keyboardType="decimal-pad" />
            <Text style={styles.formLabel}>Budget period</Text>
            <View style={styles.periodChipsRow}>
              {(['daily', 'weekly', 'monthly'] as const).map((opt) => {
                const active = addBudgetType === opt;
                return (
                  <TouchableOpacity key={opt} style={[styles.periodChip, active && styles.periodChipActive]} onPress={() => setAddBudgetType(opt)} activeOpacity={0.8}>
                    <Text style={[styles.periodChipText, active && styles.periodChipTextActive]}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.formButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => { setShowAddForm(false); setAddName(''); setAddEmoji('💰'); setAddBudget(''); setAddBudgetType('monthly'); }}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleAddCategory} disabled={saving || !addName.trim()}>
                {saving ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Text style={styles.saveButtonText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {editingCategory ? (
          <View style={styles.addForm}>
            <Text style={styles.formLabel}>Edit Category</Text>
            <TextInput style={styles.formInput} placeholder="Category name" placeholderTextColor={colors.textSecondary} value={editName} onChangeText={setEditName} />
            <TextInput style={styles.formInput} placeholder="Emoji (e.g. 🍔)" placeholderTextColor={colors.textSecondary} value={editEmoji} onChangeText={setEditEmoji} />
            <Text style={styles.formLabel}>Color</Text>
            <View style={styles.editColorRow}>
              {EDIT_COLOR_PALETTE.map((c) => (
                <TouchableOpacity key={c} style={[styles.colorCircle, { backgroundColor: c }, editColor === c && styles.colorCircleSelected]} onPress={() => setEditColor(c)} activeOpacity={0.8} />
              ))}
            </View>
            <View style={styles.formButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => setEditingCategory(null)}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleUpdateCategory} disabled={updating || !editName.trim()}>
                {updating ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Text style={styles.saveButtonText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={styles.modalLoading}><ActivityIndicator size="large" color={colors.primary} /></View>
          ) : categories.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No categories yet</Text>
              <Text style={styles.emptySubtitle}>Add your first category</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => setShowAddForm(true)}>
                <Text style={styles.emptyButtonText}>Add Category</Text>
              </TouchableOpacity>
            </View>
          ) : (
            categories.map((cat) => (
              <View key={cat.id} style={styles.categoryItem}>
                <View style={styles.categoryItemLeft}>
                  <Text style={styles.categoryEmoji}>{cat.emoji || '💰'}</Text>
                  <View>
                    <Text style={styles.categoryName}>{cat.name}</Text>
                    <View style={styles.categoryAmounts}>
                      <Text style={styles.categoryBudget}>Budget: {currencySymbol}{(cat.budget ?? 0).toFixed(2)}{cat.type ? ` / ${cat.type}` : ''}</Text>
                      <Text style={styles.categorySpent}>Spent: {currencySymbol}{(cat.spent ?? 0).toFixed(2)}</Text>
                    </View>
                  </View>
                </View>
                <View style={styles.categoryRowActions}>
                  <TouchableOpacity onPress={() => { setEditingCategory(cat); setEditName(cat.name); setEditEmoji(cat.emoji || '💰'); setEditColor(cat.color || '#6366F1'); setShowAddForm(false); }} style={styles.editButton}>
                    <Text style={styles.editButtonText}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => handleDeleteCategory(cat.id)} style={styles.deleteButton}>
                    <Text style={styles.deleteButtonText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
