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
import { clearAgentCache } from '../../lib/agents';
import { colors } from '../../lib/theme';
import { styles } from './settingsStyles';
import type { Goal, Category } from './types';

const GOAL_TYPES = [
  { value: 'saving', label: 'Saving' },
  { value: 'debt_payment', label: 'Debt Payment' },
  { value: 'investment', label: 'Investment' },
  { value: 'expense', label: 'Expense' },
] as const;

export default function GoalsModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { currencySymbol } = useProfile();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addTarget, setAddTarget] = useState('');
  const [addCurrent, setAddCurrent] = useState('');
  const [addDate, setAddDate] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedGoalType, setSelectedGoalType] = useState<string>('saving');
  const [saving, setSaving] = useState(false);
  const [dateError, setDateError] = useState('');

  const fetchGoals = () => {
    if (!userId) return;
    supabase
      .from('financial_goals')
      .select('*')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        setLoading(false);
        if (error) { console.warn('Goals fetch error:', error); setGoals([]); return; }
        setGoals((data as Goal[]) ?? []);
      });
  };

  const fetchCategories = () => {
    if (!userId) return;
    supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        if (error) { console.warn('Categories fetch error:', error); setCategories([]); return; }
        setCategories((data as Category[]) ?? []);
      });
  };

  useEffect(() => {
    if (userId) {
      setLoading(true);
      fetchGoals();
      fetchCategories();
    }
  }, [userId]);

  const handleAddGoal = async () => {
    const goalName = addName.trim();
    const targetAmount = addTarget.trim();
    const currentAmount = addCurrent.trim();
    const targetDate = addDate.trim();
    console.log('Saving goal with:', { user_id: userId, name: goalName, target_amount: parseFloat(targetAmount), current_amount: parseFloat(currentAmount) || 0, target_date: targetDate, goal_type: selectedGoalType, status: 'in_progress' });
    if (!goalName || !userId) return;
    if (!targetAmount) return;
    if (dateError) return;
    setSaving(true);
    // Append T12:00:00 so the date is parsed as local noon, not UTC midnight.
    // Without this, "2027-02-01" parses as UTC 00:00 which displays as Jan 31 in UTC-x zones.
    const targetDateVal = targetDate
      ? new Date(`${targetDate}T12:00:00`).toISOString()
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const payload = {
      user_id: userId,
      name: goalName,
      description: '',
      target_amount: parseFloat(targetAmount),
      current_amount: parseFloat(currentAmount) || 0,
      target_date: targetDateVal,
      goal_type: selectedGoalType,
      status: 'in_progress',
      category_id: selectedCategoryId || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('financial_goals').insert(payload);
    setSaving(false);
    if (error) { Alert.alert('Error', JSON.stringify(error)); return; }
    // Bust cached AI insights so the new goal is reflected on next Analytics visit
    clearAgentCache(userId).catch(() => {});
    Alert.alert('Success', 'Goal saved!');
    setAddName('');
    setAddTarget('');
    setAddCurrent('');
    setAddDate('');
    setDateError('');
    setSelectedCategoryId(null);
    setSelectedGoalType('saving');
    setShowAddForm(false);
    fetchGoals();
  };

  const handleDeleteGoal = async (id: string) => {
    const { error } = await supabase.from('financial_goals').delete().eq('id', id).eq('user_id', userId);
    if (error) { console.warn('Goal delete error:', error); return; }
    setGoals((g) => g.filter((x) => x.id !== id));
  };

  return (
    <SafeAreaView style={styles.fullModal} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fullModalInner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalHeaderTitle}>Goals</Text>
          <View style={styles.modalHeaderRight}>
            {!showAddForm && (
              <TouchableOpacity style={styles.addButton} onPress={() => setShowAddForm(true)} activeOpacity={0.8}>
                <Text style={styles.addButtonText}>Add Goal</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showAddForm ? (
          <View style={styles.addForm}>
            <TextInput style={styles.formInput} placeholder="Goal name" placeholderTextColor={colors.textSecondary} value={addName} onChangeText={setAddName} />
            <Text style={styles.formLabelOptional}>Link to Category (optional)</Text>
            <ScrollView horizontal style={styles.categoryChipsScroll} contentContainerStyle={styles.categoryChipsContent} showsHorizontalScrollIndicator={false}>
              <TouchableOpacity style={[styles.goalCategoryChip, selectedCategoryId === null && styles.goalCategoryChipActive]} onPress={() => setSelectedCategoryId(null)} activeOpacity={0.8}>
                <Text style={[styles.goalCategoryChipText, selectedCategoryId === null && styles.goalCategoryChipTextActive]}>None</Text>
              </TouchableOpacity>
              {categories.map((cat) => {
                const selected = selectedCategoryId === cat.id;
                return (
                  <TouchableOpacity key={cat.id} style={[styles.goalCategoryChip, selected && styles.goalCategoryChipActive]} onPress={() => setSelectedCategoryId(cat.id)} activeOpacity={0.8}>
                    <Text style={[styles.goalCategoryChipText, selected && styles.goalCategoryChipTextActive]}>{cat.emoji} {cat.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.formLabel}>Goal type</Text>
            <View style={styles.goalTypeChipsRow}>
              {GOAL_TYPES.map((gt) => {
                const active = selectedGoalType === gt.value;
                return (
                  <TouchableOpacity key={gt.value} style={[styles.goalTypeChip, active && styles.goalTypeChipActive]} onPress={() => setSelectedGoalType(gt.value)} activeOpacity={0.8}>
                    <Text style={[styles.goalTypeChipText, active && styles.goalTypeChipTextActive]}>{gt.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput style={styles.formInput} placeholder="Target amount" placeholderTextColor={colors.textSecondary} value={addTarget} onChangeText={setAddTarget} keyboardType="decimal-pad" />
            <TextInput style={styles.formInput} placeholder="Current amount" placeholderTextColor={colors.textSecondary} value={addCurrent} onChangeText={setAddCurrent} keyboardType="decimal-pad" />
            <TextInput
              style={[styles.formInput, dateError ? { borderColor: colors.error, borderWidth: 1 } : {}]}
              placeholder="Target date (YYYY-MM-DD)"
              placeholderTextColor={colors.textSecondary}
              value={addDate}
              onChangeText={(text) => {
                setAddDate(text);
                if (text.trim()) {
                  const valid = /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) && !isNaN(new Date(text.trim()).getTime());
                  setDateError(valid ? '' : 'Use format YYYY-MM-DD (e.g. 2025-12-31)');
                } else {
                  setDateError('');
                }
              }}
            />
            {dateError ? <Text style={{ color: colors.error, fontSize: 12, marginTop: -8, marginBottom: 8 }}>{dateError}</Text> : null}
            <View style={styles.formButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => { setShowAddForm(false); setAddName(''); setAddTarget(''); setAddCurrent(''); setAddDate(''); setDateError(''); setSelectedCategoryId(null); setSelectedGoalType('saving'); }}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleAddGoal} disabled={false}>
                {saving ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Text style={styles.saveButtonText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={styles.modalLoading}><ActivityIndicator size="large" color={colors.primary} /></View>
          ) : goals.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No goals yet</Text>
              <Text style={styles.emptySubtitle}>Set your first financial goal</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => setShowAddForm(true)}>
                <Text style={styles.emptyButtonText}>Add Goal</Text>
              </TouchableOpacity>
            </View>
          ) : (
            goals.map((goal) => {
              const target = goal.target_amount || 1;
              const current = Math.min(goal.current_amount ?? 0, target);
              const pct = Math.round((current / target) * 100);
              const linkedCategory = goal.category_id ? categories.find((c) => c.id === goal.category_id) : null;
              const targetDateStr = goal.target_date
                ? new Date(goal.target_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : null;
              return (
                <View key={goal.id} style={styles.goalItem}>
                  <View style={styles.goalItemTop}>
                    <View style={styles.goalItemTitleRow}>
                      <Text style={styles.goalName}>{goal.name}</Text>
                      {linkedCategory && <Text style={styles.goalCategoryBadge}>{linkedCategory.emoji} {linkedCategory.name}</Text>}
                    </View>
                    <TouchableOpacity onPress={() => handleDeleteGoal(goal.id)} style={styles.deleteButton}>
                      <Text style={styles.deleteButtonText}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.goalProgressTrack}>
                    <View style={[styles.goalProgressFill, { width: `${pct}%` }]} />
                  </View>
                  <Text style={styles.goalProgressText}>{currencySymbol}{current.toFixed(2)} / {currencySymbol}{target.toFixed(2)}</Text>
                  {targetDateStr ? <Text style={styles.goalDate}>{targetDateStr}</Text> : null}
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
