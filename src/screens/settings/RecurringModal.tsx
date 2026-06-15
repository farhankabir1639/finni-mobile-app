import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '../../contexts/ProfileContext';
import { listRecurring, pauseRecurring, deleteRecurring, type RecurringTemplate } from '../../lib/recurring';
import { t, fonts } from '../../theme/tokens';
import { styles } from './settingsStyles';
import Aurora from '../../components/Aurora';
import GlassCard from '../../components/GlassCard';

const { width: SW, height: SH } = Dimensions.get('window');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function fmtNext(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}
function freqLabel(f: string): string {
  return ({ daily: 'Daily', weekly: 'Weekly', biweekly: 'Every 2 weeks', monthly: 'Monthly' } as Record<string, string>)[f] ?? f;
}

export default function RecurringModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { currencySymbol } = useProfile();
  const [items, setItems] = useState<RecurringTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    if (!userId) return;
    listRecurring(userId).then((r) => { setItems(r); setLoading(false); });
  };
  useEffect(() => { if (userId) { setLoading(true); refresh(); } }, [userId]);

  const togglePause = async (tpl: RecurringTemplate) => {
    await pauseRecurring(tpl.id, !tpl.active);
    refresh();
  };

  const remove = (tpl: RecurringTemplate) => {
    Alert.alert('Delete recurring?', `Stop "${tpl.description ?? 'this'}" from repeating? Already-logged transactions stay.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteRecurring(tpl.id); refresh(); } },
    ]);
  };

  return (
    <View style={styles.modalRoot}>
      <Aurora width={SW} height={SH} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Recurring</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
          {loading ? (
            <View style={styles.modalLoading}><ActivityIndicator size="large" color={t.auraAqua} /></View>
          ) : items.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No recurring transactions</Text>
              <Text style={styles.emptySubtitle}>Log an expense in chat, then tap “🔁 Is this recurring?” on its card.</Text>
            </View>
          ) : (
            items.map((tpl) => (
              <GlassCard key={tpl.id} style={styles.goalCard}>
                <View style={styles.goalTopRow}>
                  <View style={styles.goalLeft}>
                    <View style={styles.goalIcon}><Text style={{ fontSize: 20 }}>🔁</Text></View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.goalName}>{tpl.description ?? (tpl.type === 'income' ? 'Income' : 'Expense')}</Text>
                      <Text style={[styles.goalDateText, { marginTop: 2 }]}>
                        {freqLabel(tpl.frequency)} · {tpl.active ? `next ${fmtNext(tpl.next_run)}` : 'paused'}
                      </Text>
                    </View>
                  </View>
                  <Text style={[styles.goalAmounts, { color: tpl.type === 'income' ? t.green : t.text }]}>
                    {currencySymbol}{Number(tpl.amount).toFixed(0)}
                  </Text>
                </View>

                <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                  <TouchableOpacity
                    style={[styles.miniBtn, { flex: 1, flexDirection: 'row', gap: 6, backgroundColor: 'rgba(255,255,255,0.05)', borderColor: t.glassLine2 }]}
                    onPress={() => togglePause(tpl)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 13, fontFamily: fonts.semiBold, color: t.text2 }}>{tpl.active ? 'Pause' : 'Resume'}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.miniBtn, { backgroundColor: t.redTint, borderColor: t.red + '45' }]}
                    onPress={() => remove(tpl)}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontSize: 16 }}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </GlassCard>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
