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
import type { IncomeRecord } from './types';

function calcMonthlyIncome(record: IncomeRecord): number {
  const amt = Number(record.amount) || 0;
  if (record.frequency === 'weekly') return amt * 4.33;
  if (record.frequency === 'annual') return amt / 12;
  return amt;
}

export default function IncomeModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { currencySymbol } = useProfile();
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [addFrequency, setAddFrequency] = useState<'monthly' | 'weekly' | 'annual'>('monthly');
  const [saving, setSaving] = useState(false);

  const fetchIncome = async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('income')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) {
      console.error('[Income] Fetch error:', error);
      setIncomeRecords([]);
      return;
    }
    setIncomeRecords((data as IncomeRecord[]) ?? []);
  };

  useEffect(() => {
    if (userId) {
      setLoading(true);
      fetchIncome();
    }
  }, [userId]);

  const totalMonthlyIncome = incomeRecords.reduce((sum, r) => sum + calcMonthlyIncome(r), 0);

  const handleAdd = async () => {
    const label = addLabel.trim() || 'Income';
    const amount = parseFloat(addAmount);
    if (!userId) { Alert.alert('Error', 'You must be logged in to add income.'); return; }
    if (isNaN(amount) || amount <= 0) { Alert.alert('Error', 'Please enter a valid amount.'); return; }
    if (!addLabel.trim()) { Alert.alert('Error', 'Please enter a label.'); return; }
    setSaving(true);
    const { error } = await supabase.from('income').insert({
      user_id: userId,
      label,
      amount,
      frequency: addFrequency,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Error', `Could not save income: ${error.message || error.details || JSON.stringify(error)}`);
      return;
    }
    setAddLabel('');
    setAddAmount('');
    setAddFrequency('monthly');
    setShowAddForm(false);
    fetchIncome();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('income').delete().eq('id', id);
    if (error) { console.warn('[Income] Delete error:', error); return; }
    setIncomeRecords((r) => r.filter((x) => x.id !== id));
  };

  const freqSuffix = (f: string) => {
    if (f === 'weekly') return '/wk';
    if (f === 'annual') return '/yr';
    return '/mo';
  };

  return (
    <SafeAreaView style={styles.fullModal} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.fullModalInner} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalHeaderTitle}>Income</Text>
          <View style={styles.modalHeaderRight}>
            {!showAddForm && (
              <TouchableOpacity style={styles.addButton} onPress={() => setShowAddForm(true)} activeOpacity={0.8}>
                <Text style={styles.addButtonText}>Add Income</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.incomeBanner}>
          <Text style={styles.incomeBannerLabel}>Total Monthly Income</Text>
          <Text style={styles.incomeBannerAmount}>{currencySymbol}{totalMonthlyIncome.toFixed(2)}</Text>
        </View>

        {showAddForm && (
          <View style={styles.addForm}>
            <TextInput style={styles.formInput} placeholder="Label (e.g. Salary, Freelance)" placeholderTextColor={colors.textSecondary} value={addLabel} onChangeText={setAddLabel} />
            <TextInput style={styles.formInput} placeholder="Amount" placeholderTextColor={colors.textSecondary} value={addAmount} onChangeText={setAddAmount} keyboardType="decimal-pad" />
            <Text style={styles.formLabel}>Frequency</Text>
            <View style={styles.periodChipsRow}>
              {(['monthly', 'weekly', 'annual'] as const).map((opt) => {
                const active = addFrequency === opt;
                return (
                  <TouchableOpacity key={opt} style={[styles.periodChip, active && styles.periodChipActive]} onPress={() => setAddFrequency(opt)} activeOpacity={0.8}>
                    <Text style={[styles.periodChipText, active && styles.periodChipTextActive]}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.formButtons}>
              <TouchableOpacity style={styles.cancelButton} onPress={() => { setShowAddForm(false); setAddLabel(''); setAddAmount(''); setAddFrequency('monthly'); }}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveButton} onPress={handleAdd} disabled={saving || !addLabel.trim() || !addAmount.trim()}>
                {saving ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Text style={styles.saveButtonText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={styles.modalLoading}><ActivityIndicator size="large" color={colors.primary} /></View>
          ) : incomeRecords.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No income sources</Text>
              <Text style={styles.emptySubtitle}>Add your first income source</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => setShowAddForm(true)}>
                <Text style={styles.emptyButtonText}>Add Income</Text>
              </TouchableOpacity>
            </View>
          ) : (
            incomeRecords.map((record) => (
              <View key={record.id} style={styles.incomeItem}>
                <View style={styles.incomeItemLeft}>
                  <Text style={styles.incomeLabel}>{record.label}</Text>
                  <Text style={styles.incomeSubLabel}>
                    {currencySymbol}{Number(record.amount).toFixed(2)}{freqSuffix(record.frequency)}
                    {' · '}
                    {currencySymbol}{calcMonthlyIncome(record).toFixed(2)}/mo
                  </Text>
                </View>
                <TouchableOpacity onPress={() => handleDelete(record.id)} style={styles.deleteButton}>
                  <Text style={styles.deleteButtonText}>🗑️</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
