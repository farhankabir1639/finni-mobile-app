import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '../../contexts/ProfileContext';
import { listRecurring, pauseRecurring, deleteRecurring, setRecurringReminder, type RecurringTemplate } from '../../lib/recurring';
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

  const REMINDER_DAYS = [{ label: '1 day', v: 1 }, { label: '2 days', v: 2 }, { label: '3 days', v: 3 }, { label: '1 week', v: 7 }];

  const toggleReminder = async (tpl: RecurringTemplate) => {
    await setRecurringReminder(tpl.id, !tpl.reminder_enabled, tpl.reminder_days_before || 1);
    refresh();
  };
  const setReminderDays = async (tpl: RecurringTemplate, days: number) => {
    await setRecurringReminder(tpl.id, true, days);
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

                {/* Bill reminder — expenses only */}
                {tpl.type === 'expense' && (
                  <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: t.glassLine, paddingTop: 12 }}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                      onPress={() => toggleReminder(tpl)}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 13.5, fontFamily: fonts.medium, color: t.text2 }}>🔔  Remind me before it's due</Text>
                      <View style={{
                        width: 44, height: 26, borderRadius: 13, padding: 3,
                        backgroundColor: tpl.reminder_enabled ? t.auraAqua : 'rgba(255,255,255,0.12)',
                        alignItems: tpl.reminder_enabled ? 'flex-end' : 'flex-start', justifyContent: 'center',
                      }}>
                        <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' }} />
                      </View>
                    </TouchableOpacity>
                    {tpl.reminder_enabled && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 11 }}>
                        {REMINDER_DAYS.map((d) => {
                          const on = tpl.reminder_days_before === d.v;
                          return (
                            <TouchableOpacity
                              key={d.v}
                              onPress={() => setReminderDays(tpl, d.v)}
                              activeOpacity={0.7}
                              style={{
                                paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1,
                                backgroundColor: on ? 'rgba(94,234,212,0.12)' : 'rgba(255,255,255,0.05)',
                                borderColor: on ? t.auraAqua : t.glassLine,
                              }}
                            >
                              <Text style={{ fontSize: 12.5, fontFamily: fonts.medium, color: on ? t.auraAqua : t.text2 }}>{d.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                )}
              </GlassCard>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
