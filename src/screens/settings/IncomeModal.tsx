import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '../../contexts/ProfileContext';
import { supabase } from '../../lib/supabase';
import { t, fonts } from '../../theme/tokens';
import { styles } from './settingsStyles';
import Aurora from '../../components/Aurora';
import GlassCard from '../../components/GlassCard';
import type { IncomeRecord } from './types';

const { width: SW, height: SH } = Dimensions.get('window');

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
    const { data, error } = await supabase.from('income').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    setLoading(false);
    if (error) { setIncomeRecords([]); return; }
    setIncomeRecords((data as IncomeRecord[]) ?? []);
  };

  useEffect(() => { if (userId) { setLoading(true); fetchIncome(); } }, [userId]);

  const totalMonthlyIncome = incomeRecords.reduce((sum, r) => sum + calcMonthlyIncome(r), 0);

  const handleAdd = async () => {
    const label = addLabel.trim() || 'Income';
    const amount = parseFloat(addAmount);
    if (!userId) { Alert.alert('Error', 'You must be logged in.'); return; }
    if (isNaN(amount) || amount <= 0) { Alert.alert('Error', 'Please enter a valid amount.'); return; }
    if (!addLabel.trim()) { Alert.alert('Error', 'Please enter a label.'); return; }
    setSaving(true);
    const { error } = await supabase.from('income').insert({ user_id: userId, label, amount, frequency: addFrequency });
    setSaving(false);
    if (error) { Alert.alert('Error', `Could not save: ${error.message}`); return; }
    setAddLabel(''); setAddAmount(''); setAddFrequency('monthly'); setShowAddForm(false);
    fetchIncome();
  };

  const handleDelete = async (id: string) => {
    Alert.alert('Delete Income', 'Remove this income source?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('income').delete().eq('id', id).eq('user_id', userId);
          if (error) return;
          setIncomeRecords((r) => r.filter((x) => x.id !== id));
        },
      },
    ]);
  };

  const freqSuffix = (f: string) => f === 'weekly' ? '/wk' : f === 'annual' ? '/yr' : '/mo';

  return (
    <View style={styles.modalRoot}>
      <Aurora width={SW} height={SH} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Income</Text>
            <View style={styles.modalHeaderRight}>
              {!showAddForm && (
                <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)} activeOpacity={0.8}>
                  <Text style={{ fontSize: 14 }}>+</Text>
                  <Text style={styles.addBtnText}>Add Income</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
            {/* Total banner */}
            <View style={styles.incomeBanner}>
              <Text style={styles.incomeBannerLabel}>Total Monthly Income</Text>
              <Text style={styles.incomeBannerAmount}>{currencySymbol}{totalMonthlyIncome.toFixed(0)}</Text>
            </View>

            {/* Add form */}
            {showAddForm && (
              <GlassCard style={styles.formCard}>
                <Text style={styles.formTitle}>New income source</Text>
                <TextInput style={styles.formInput} placeholder="Label (e.g. Salary)" placeholderTextColor={t.text3} value={addLabel} onChangeText={setAddLabel} />
                <TextInput style={styles.formInput} placeholder="Amount" placeholderTextColor={t.text3} value={addAmount} onChangeText={setAddAmount} keyboardType="decimal-pad" />
                <Text style={styles.formLabel}>Frequency</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                  {(['monthly', 'weekly', 'annual'] as const).map((opt) => {
                    const active = addFrequency === opt;
                    return (
                      <TouchableOpacity key={opt} style={[styles.chip, active && styles.chipActive, { flex: 1, alignItems: 'center' }]} onPress={() => setAddFrequency(opt)} activeOpacity={0.8}>
                        <Text style={[styles.chipText, active && styles.chipTextActive]}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <View style={styles.formRow}>
                  <TouchableOpacity style={styles.btnSecondary} onPress={() => { setShowAddForm(false); setAddLabel(''); setAddAmount(''); }}>
                    <Text style={styles.btnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.btnPrimary} onPress={handleAdd} disabled={saving}>
                    {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPrimaryText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </GlassCard>
            )}

            {/* List */}
            {loading ? (
              <View style={styles.modalLoading}><ActivityIndicator size="large" color={t.auraAqua} /></View>
            ) : incomeRecords.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyTitle}>No income sources</Text>
                <Text style={styles.emptySubtitle}>Add your first income source</Text>
                <TouchableOpacity style={styles.addBtn} onPress={() => setShowAddForm(true)}>
                  <Text style={styles.addBtnText}>Add Income</Text>
                </TouchableOpacity>
              </View>
            ) : (
              incomeRecords.map((record) => (
                <GlassCard key={record.id} style={styles.incomeCard}>
                  <View style={styles.incomeRow}>
                    <View style={styles.incomeIcon}>
                      <Text style={{ fontSize: 20 }}>💼</Text>
                    </View>
                    <View style={styles.incomeInfo}>
                      <Text style={styles.incomeLabel}>{record.label}</Text>
                      <Text style={styles.incomeSub}>
                        {currencySymbol}{Number(record.amount).toFixed(0)}{freqSuffix(record.frequency)}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => handleDelete(record.id)} style={styles.incomeDeleteBtn} activeOpacity={0.7}>
                      <Text style={{ fontSize: 18 }}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                </GlassCard>
              ))
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
