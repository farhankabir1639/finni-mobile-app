import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '../../contexts/ProfileContext';
import { supabase } from '../../lib/supabase';
import { clearAgentCache } from '../../lib/agents';
import { t, fonts } from '../../theme/tokens';
import { styles } from './settingsStyles';
import Aurora from '../../components/Aurora';
import GlassCard from '../../components/GlassCard';
import type { Goal, Category } from './types';

const { width: SW, height: SH } = Dimensions.get('window');

const GOAL_TYPES = [
  { value: 'saving', label: 'Saving' },
  { value: 'debt_payment', label: 'Debt' },
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
    supabase.from('financial_goals').select('*').eq('user_id', userId)
      .then(({ data, error }) => { setLoading(false); setGoals(error ? [] : (data as Goal[]) ?? []); });
  };

  const fetchCategories = () => {
    if (!userId) return;
    supabase.from('categories').select('*').eq('user_id', userId)
      .then(({ data, error }) => { setCategories(error ? [] : (data as Category[]) ?? []); });
  };

  useEffect(() => { if (userId) { setLoading(true); fetchGoals(); fetchCategories(); } }, [userId]);

  const handleAddGoal = async () => {
    const goalName = addName.trim();
    const targetAmount = addTarget.trim();
    const currentAmount = addCurrent.trim();
    const targetDate = addDate.trim();
    if (!goalName || !userId || !targetAmount || dateError) return;
    setSaving(true);
    const targetDateVal = targetDate
      ? new Date(`${targetDate}T12:00:00`).toISOString()
      : new Date(Date.now() + 365 * 86400000).toISOString();
    const { error } = await supabase.from('financial_goals').insert({
      user_id: userId, name: goalName, description: '',
      target_amount: parseFloat(targetAmount), current_amount: parseFloat(currentAmount) || 0,
      target_date: targetDateVal, goal_type: selectedGoalType, status: 'in_progress',
      category_id: selectedCategoryId || null,
    });
    setSaving(false);
    if (error) { Alert.alert('Error', JSON.stringify(error)); return; }
    clearAgentCache(userId).catch(() => {});
    Alert.alert('Success', 'Goal saved!');
    resetForm();
    fetchGoals();
  };

  const resetForm = () => {
    setAddName(''); setAddTarget(''); setAddCurrent(''); setAddDate('');
    setDateError(''); setSelectedCategoryId(null); setSelectedGoalType('saving'); setShowAddForm(false);
  };

  const handleDeleteGoal = async (id: string, name: string) => {
    Alert.alert('Delete Goal', `Delete "${name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('financial_goals').delete().eq('id', id).eq('user_id', userId);
          setGoals((g) => g.filter((x) => x.id !== id));
          clearAgentCache(userId).catch(() => {});
        },
      },
    ]);
  };

  const goalTypeLabel = (gt: string) => GOAL_TYPES.find((g) => g.value === gt)?.label ?? gt;

  return (
    <View style={styles.modalRoot}>
      <Aurora width={SW} height={SH} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Goals</Text>
            <View style={styles.modalHeaderRight}>
              {!showAddForm && (
                <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)} activeOpacity={0.8}>
                  <Text style={{ fontSize: 14, color: '#fff' }}>+</Text>
                  <Text style={styles.addBtnText}>Add Goal</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
            {/* Add form */}
            {showAddForm && (
              <GlassCard style={styles.formCard}>
                <Text style={styles.formTitle}>New goal</Text>
                <TextInput style={styles.formInput} placeholder="Goal name" placeholderTextColor={t.text3} value={addName} onChangeText={setAddName} />

                <Text style={styles.formLabel}>Link to category (optional)</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} contentContainerStyle={{ gap: 8 }}>
                  <TouchableOpacity style={[styles.chip, !selectedCategoryId && styles.chipActive]} onPress={() => setSelectedCategoryId(null)} activeOpacity={0.8}>
                    <Text style={[styles.chipText, !selectedCategoryId && styles.chipTextActive]}>None</Text>
                  </TouchableOpacity>
                  {categories.map((cat) => {
                    const sel = selectedCategoryId === cat.id;
                    return (
                      <TouchableOpacity key={cat.id} style={[styles.chip, sel && styles.chipActive]} onPress={() => setSelectedCategoryId(cat.id)} activeOpacity={0.8}>
                        <Text style={[styles.chipText, sel && styles.chipTextActive]}>{cat.emoji} {cat.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                <Text style={styles.formLabel}>Goal type</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  {GOAL_TYPES.map((gt) => {
                    const active = selectedGoalType === gt.value;
                    return (
                      <TouchableOpacity key={gt.value} style={[styles.chip, active && styles.chipActive, { flex: 1, alignItems: 'center', minWidth: 70 }]} onPress={() => setSelectedGoalType(gt.value)} activeOpacity={0.8}>
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{gt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <TextInput style={styles.formInput} placeholder="Target amount" placeholderTextColor={t.text3} value={addTarget} onChangeText={setAddTarget} keyboardType="decimal-pad" />
                <TextInput style={styles.formInput} placeholder="Current amount" placeholderTextColor={t.text3} value={addCurrent} onChangeText={setAddCurrent} keyboardType="decimal-pad" />

                <Text style={styles.formLabel}>Target date</Text>
                <TextInput
                  style={[styles.formInput, dateError ? { borderColor: t.red } : {}]}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={t.text3}
                  value={addDate}
                  onChangeText={(text) => {
                    setAddDate(text);
                    if (text.trim()) {
                      const valid = /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) && !isNaN(new Date(text.trim()).getTime());
                      setDateError(valid ? '' : 'Use format YYYY-MM-DD');
                    } else { setDateError(''); }
                  }}
                />
                {dateError ? <Text style={{ color: t.red, fontSize: 12, marginTop: -10, marginBottom: 8, fontFamily: fonts.regular }}>{dateError}</Text> : null}

                <View style={styles.formRow}>
                  <TouchableOpacity style={styles.btnSecondary} onPress={resetForm}>
                    <Text style={styles.btnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnPrimary} onPress={handleAddGoal} disabled={saving}>
                    {saving ? <ActivityIndicator size="small" color="#fff" /> : (
                      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                        <Text style={{ fontSize: 14, color: '#fff' }}>✓</Text>
                        <Text style={styles.btnPrimaryText}>Save</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              </GlassCard>
            )}

            {/* List */}
            {loading ? (
              <View style={styles.modalLoading}><ActivityIndicator size="large" color={t.auraAqua} /></View>
            ) : goals.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No goals yet</Text>
                <Text style={styles.emptySubtitle}>Set your first financial goal</Text>
                <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)}>
                  <Text style={styles.addBtnText}>Add Goal</Text>
                </TouchableOpacity>
              </View>
            ) : (
              goals.map((goal) => {
                const target = goal.target_amount || 1;
                const current = Math.min(goal.current_amount ?? 0, target);
                const pct = Math.round((current / target) * 100);
                const targetDateStr = goal.target_date
                  ? new Date(goal.target_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : null;
                return (
                  <GlassCard key={goal.id} style={styles.goalCard}>
                    <View style={styles.goalTopRow}>
                      <View style={styles.goalLeft}>
                        <View style={styles.goalIcon}>
                          <Text style={{ fontSize: 20 }}>🎯</Text>
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.goalName}>{goal.name}</Text>
                          {goal.goal_type && (
                            <View style={styles.goalTypeBadge}>
                              <Text style={styles.goalTypeBadgeText}>{goalTypeLabel(goal.goal_type)}</Text>
                            </View>
                          )}
                        </View>
                      </View>
                      <TouchableOpacity
                        style={[styles.miniBtn, { backgroundColor: t.redTint, borderColor: t.red + '45' }]}
                        onPress={() => handleDeleteGoal(goal.id, goal.name)}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 16 }}>🗑️</Text>
                      </TouchableOpacity>
                    </View>

                    {/* Progress */}
                    <View style={styles.goalProgress}>
                      <View style={[styles.barTrack, { height: 8 }]}>
                        <View style={[styles.barFill, { width: `${pct}%`, height: 8, backgroundColor: t.auraAqua }]} />
                      </View>
                    </View>

                    <View style={styles.goalStats}>
                      <Text style={styles.goalAmounts}>
                        {currencySymbol}{current.toFixed(0)}
                        <Text style={styles.goalAmountTarget}> / {currencySymbol}{target.toFixed(0)}</Text>
                      </Text>
                      {targetDateStr && (
                        <View style={styles.goalDate}>
                          <Text style={{ fontSize: 13 }}>📅</Text>
                          <Text style={styles.goalDateText}>{targetDateStr}</Text>
                        </View>
                      )}
                    </View>
                  </GlassCard>
                );
              })
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
