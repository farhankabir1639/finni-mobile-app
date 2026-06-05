import React, { useCallback, useState, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Pressable,
  Alert,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { supabase } from '../lib/supabase';
import { trackScreen } from '../lib/analytics';
import Aurora from '../components/Aurora';
import GlassCard from '../components/GlassCard';
import CategoryPickerSheet, { type PickerCategory } from '../components/CategoryPickerSheet';
import { t, fonts } from '../theme/tokens';

// ── Types ─────────────────────────────────────────────────────────────────────
type Transaction = {
  id: string;
  user_id: string;
  date: string;
  withdrawal?: number;
  deposit?: number;
  description: string | null;
  category_id?: string | null;
  type?: 'expense' | 'income';
  categories?: { id: string; name: string; emoji?: string } | null;
};

type FilterOption = 'all' | 'today' | 'week' | 'month';

// ── Helpers ────────────────────────────────────────────────────────────────────
function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const dNorm = new Date(d); dNorm.setHours(0, 0, 0, 0);
  if (dNorm.getTime() === today.getTime()) return 'Today';
  if (dNorm.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function formatAmount(amount: number, isExpense: boolean, sym: string): string {
  return `${isExpense ? '-' : '+'}${sym}${Math.abs(amount).toFixed(2)}`;
}

function getCategoryColor(name: string | null): string {
  const palette = [t.auraViolet, t.auraIndigo, t.auraRose, t.amber, t.green, t.auraBlue];
  if (!name) return palette[0];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function getStart(type: 'day' | 'week' | 'month', now: Date): Date {
  const x = new Date(now);
  if (type === 'day') { x.setHours(0, 0, 0, 0); return x; }
  if (type === 'week') {
    const day = x.getDay();
    x.setDate(x.getDate() - day + (day === 0 ? -6 : 1));
    x.setHours(0, 0, 0, 0);
    return x;
  }
  x.setDate(1); x.setHours(0, 0, 0, 0); return x;
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function TransactionsScreen() {
  const { user } = useAuth();
  const { currencySymbol } = useProfile();
  const { width, height } = useWindowDimensions();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [allCategories, setAllCategories] = useState<PickerCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterOption>('all');
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchTransactions = useCallback(async () => {
    if (!user?.id) { setLoading(false); setTransactions([]); return; }
    setLoading(true);
    const [txResult, catsResult] = await Promise.all([
      supabase
        .from('transactions')
        .select('*, categories(id, name, emoji)')
        .eq('user_id', user.id)
        .order('date', { ascending: false }),
      supabase
        .from('categories')
        .select('id, name, emoji')
        .eq('user_id', user.id),
    ]);
    setLoading(false);
    setTransactions((txResult.data as Transaction[]) ?? []);
    setAllCategories((catsResult.data as PickerCategory[]) ?? []);
  }, [user?.id]);

  const handleDeleteTransaction = useCallback((id: string) => {
    Alert.alert('Delete transaction?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const { error } = await supabase.from('transactions').delete().eq('id', id).eq('user_id', user?.id ?? '');
          if (!error) fetchTransactions();
        },
      },
    ]);
  }, [user?.id, fetchTransactions]);

  const handleCategoryChange = useCallback(async (categoryId: string) => {
    if (!selectedTx || !user?.id) return;
    await supabase
      .from('transactions')
      .update({ category_id: categoryId })
      .eq('id', selectedTx.id)
      .eq('user_id', user.id);
    setSelectedTx(null);
    fetchTransactions();
  }, [selectedTx, user?.id, fetchTransactions]);

  useFocusEffect(React.useCallback(() => {
    fetchTransactions();
    trackScreen('TransactionsScreen');
  }, [fetchTransactions]));

  // ── Derived ────────────────────────────────────────────────────────────────
  const filteredAndGrouped = useMemo(() => {
    const now = new Date();
    const startToday = getStart('day', now);
    const startWeek  = getStart('week', now);
    const startMonth = getStart('month', now);

    const list = transactions.filter(tx => {
      const desc = (tx.description ?? '').toLowerCase();
      const cat  = (tx.categories?.name ?? '').toLowerCase();
      const q    = searchQuery.toLowerCase().trim();
      if (q && !desc.includes(q) && !cat.includes(q)) return false;
      const d = new Date(tx.date);
      if (filter === 'today' && d < startToday) return false;
      if (filter === 'week'  && d < startWeek)  return false;
      if (filter === 'month' && d < startMonth) return false;
      return true;
    });

    const groups: { date: string; label: string; items: Transaction[] }[] = [];
    const seen = new Set<string>();
    for (const tx of list) {
      const d = new Date(tx.date); d.setHours(0, 0, 0, 0);
      const key = d.toISOString();
      if (!seen.has(key)) {
        seen.add(key);
        groups.push({
          date: key,
          label: formatDateHeader(tx.date),
          items: list.filter(x => { const xd = new Date(x.date); xd.setHours(0, 0, 0, 0); return xd.toISOString() === key; }),
        });
      }
    }
    return groups;
  }, [transactions, searchQuery, filter]);

  const summary = useMemo(() => {
    let spent = 0; let income = 0;
    for (const g of filteredAndGrouped) {
      for (const tx of g.items) {
        if (tx.type === 'expense') spent += Number(tx.withdrawal) || 0;
        else income += Number(tx.deposit) || 0;
      }
    }
    return { spent, income };
  }, [filteredAndGrouped]);

  const filterChips: { key: FilterOption; label: string }[] = [
    { key: 'all',   label: 'All' },
    { key: 'today', label: 'Today' },
    { key: 'week',  label: 'This Week' },
    { key: 'month', label: 'This Month' },
  ];

  // ── Transaction item ───────────────────────────────────────────────────────
  const renderTransaction = (tx: Transaction, isLast: boolean) => {
    const amt       = tx.type === 'expense' ? (Number(tx.withdrawal) || 0) : (Number(tx.deposit) || 0);
    const isExpense = tx.type === 'expense';
    const name      = tx.description?.trim() || 'Transaction';
    const cat       = tx.categories ?? null;
    const catLabel  = cat ? `${cat.emoji ?? '💰'} ${cat.name}` : 'Uncategorized';
    const dotColor  = getCategoryColor(cat?.name ?? null);

    return (
      <Pressable
        key={tx.id}
        style={[styles.txItem, isLast && styles.txItemLast]}
        onPress={() => { setSelectedTx(tx); setShowPicker(true); }}
        onLongPress={() => handleDeleteTransaction(tx.id)}
        android_ripple={{ color: 'rgba(255,255,255,0.04)' }}
      >
        <View style={[styles.txDot, { backgroundColor: dotColor }]} />
        <View style={styles.txInfo}>
          <Text style={[styles.txName, { fontFamily: fonts.semiBold }]} numberOfLines={1}>{name}</Text>
          <Text style={[styles.txCat, { fontFamily: fonts.regular }]}>{catLabel}</Text>
          <Text style={[styles.txTime, { fontFamily: fonts.regular }]}>{formatTime(tx.date)}</Text>
        </View>
        <Text style={[styles.txAmt, { fontFamily: fonts.bold }, isExpense ? styles.amtExpense : styles.amtIncome]}>
          {formatAmount(amt, isExpense, currencySymbol)}
        </Text>
      </Pressable>
    );
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.outer}>
        <Aurora width={width} height={height} />
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={t.auraAqua} />
            <Text style={[styles.loadingText, { fontFamily: fonts.medium }]}>Loading transactions…</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <View style={styles.outer}>
      <Aurora width={width} height={height} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Title */}
          <Text style={[styles.title, { fontFamily: fonts.extraBold }]}>Transactions</Text>
          <Text style={[styles.subtitle, { fontFamily: fonts.regular }]}>Tap a transaction to reclassify</Text>

          {/* Search */}
          <GlassCard style={styles.searchCard} borderRadius={t.rMd} intensity={18}>
            <Text style={styles.searchIcon}>🔍</Text>
            <TextInput
              style={[styles.searchInput, { fontFamily: fonts.regular }]}
              placeholder="Search transactions…"
              placeholderTextColor={t.text3}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
          </GlassCard>

          {/* Filter chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsContent}
            style={styles.chipsScroll}
          >
            {filterChips.map(chip => {
              const active = filter === chip.key;
              return (
                <TouchableOpacity
                  key={chip.key}
                  style={[styles.chip, active && styles.chipActive]}
                  onPress={() => setFilter(chip.key)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.chipText, { fontFamily: fonts.semiBold }, active && styles.chipTextActive]}>
                    {chip.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Summary panel */}
          <View style={styles.summaryRow}>
            <GlassCard style={styles.summaryCard} borderRadius={t.rLg} intensity={20}>
              <Text style={[styles.summaryLabel, { fontFamily: fonts.medium }]}>Spent</Text>
              <Text style={[styles.summaryAmt, { fontFamily: fonts.extraBold }, styles.summarySpent]}>
                {currencySymbol}{summary.spent.toFixed(2)}
              </Text>
            </GlassCard>
            <GlassCard style={styles.summaryCard} borderRadius={t.rLg} intensity={20}>
              <Text style={[styles.summaryLabel, { fontFamily: fonts.medium }]}>Income</Text>
              <Text style={[styles.summaryAmt, { fontFamily: fonts.extraBold }, styles.summaryIncome]}>
                {currencySymbol}{summary.income.toFixed(2)}
              </Text>
            </GlassCard>
          </View>

          {/* Timeline */}
          {filteredAndGrouped.length === 0 ? (
            <GlassCard style={styles.emptyCard} borderRadius={t.rXl}>
              <Text style={styles.emptyEmoji}>📭</Text>
              <Text style={[styles.emptyTitle, { fontFamily: fonts.bold }]}>No transactions yet</Text>
              <Text style={[styles.emptySubtitle, { fontFamily: fonts.regular }]}>
                Chat with Finni to log your first expense
              </Text>
            </GlassCard>
          ) : (
            filteredAndGrouped.map((group, gi) => (
              <View key={group.date} style={styles.timelineGroup}>
                {/* Thread + date label row */}
                <View style={styles.threadRow}>
                  <View style={styles.threadCol}>
                    <View style={styles.glowDot} />
                    {/* Thread line extends below date label into transactions */}
                    {group.items.length > 0 && <View style={styles.threadLine} />}
                  </View>
                  <Text style={[styles.dateLabel, { fontFamily: fonts.semiBold }]}>{group.label}</Text>
                </View>

                {/* Transaction cards, indented right of thread */}
                <View style={styles.txList}>
                  {group.items.map((tx, ti) => renderTransaction(tx, ti === group.items.length - 1))}
                </View>

                {/* Gap between groups — thread continues via next group's threadLine */}
                {gi < filteredAndGrouped.length - 1 && <View style={styles.groupGap} />}
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>

      {/* Category picker */}
      <CategoryPickerSheet
        visible={showPicker}
        onClose={() => { setShowPicker(false); setSelectedTx(null); }}
        categories={allCategories}
        currentCategoryId={selectedTx?.category_id}
        onSelect={handleCategoryChange}
      />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  outer: {
    flex: 1,
    backgroundColor: t.auraBg,
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  loadingWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: t.text2,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 32,
  },
  title: {
    fontSize: 28,
    color: t.text,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    color: t.text3,
    marginBottom: 20,
  },

  // Search
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 13,
    gap: 10,
    marginBottom: 14,
  },
  searchIcon: {
    fontSize: 18,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: t.text,
    padding: 0,
  },

  // Filter chips
  chipsScroll: {
    maxHeight: 44,
    marginBottom: 20,
  },
  chipsContent: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 2,
  },
  chip: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: t.glassLine,
    borderRadius: t.rPill,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chipActive: {
    backgroundColor: t.indigoTint,
    borderColor: t.auraIndigo,
  },
  chipText: {
    fontSize: 13,
    color: t.text2,
  },
  chipTextActive: {
    color: t.indigoBright,
  },

  // Summary
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  summaryCard: {
    flex: 1,
    padding: 18,
    gap: 6,
  },
  summaryLabel: {
    fontSize: 12,
    color: t.text3,
  },
  summaryAmt: {
    fontSize: 22,
  },
  summarySpent: {
    color: t.red,
  },
  summaryIncome: {
    color: t.green,
  },

  // Timeline
  timelineGroup: {
    flexDirection: 'column',
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  threadCol: {
    width: 32,
    alignItems: 'center',
  },
  glowDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: t.auraIndigo,
    shadowColor: t.auraIndigo,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 6,
    elevation: 6,
  },
  threadLine: {
    width: 1,
    flex: 1,
    minHeight: 8,
    backgroundColor: t.lineIndigo,
    marginTop: 4,
  },
  dateLabel: {
    flex: 1,
    fontSize: 13,
    color: t.text2,
    marginLeft: 8,
  },
  txList: {
    marginLeft: 32,
    gap: 8,
  },
  groupGap: {
    height: 20,
    marginLeft: 16,
    borderLeftWidth: 1,
    borderLeftColor: t.lineIndigo,
  },

  // Transaction item
  txItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: t.glassLine,
    borderRadius: t.rMd,
    padding: 14,
  },
  txItemLast: {},
  txDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 12,
  },
  txInfo: {
    flex: 1,
    gap: 2,
  },
  txName: {
    fontSize: 15,
    color: t.text,
  },
  txCat: {
    fontSize: 12,
    color: t.text2,
  },
  txTime: {
    fontSize: 11,
    color: t.text3,
  },
  txAmt: {
    fontSize: 15,
    marginLeft: 10,
  },
  amtExpense: {
    color: t.red,
  },
  amtIncome: {
    color: t.green,
  },

  // Empty
  emptyCard: {
    padding: 40,
    alignItems: 'center',
    gap: 10,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyTitle: {
    fontSize: 18,
    color: t.text,
  },
  emptySubtitle: {
    fontSize: 14,
    color: t.text2,
    textAlign: 'center',
  },
});
