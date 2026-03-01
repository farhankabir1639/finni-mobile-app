import React, { useCallback, useState, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

type Transaction = {
  id: string;
  user_id: string;
  date: string;
  withdrawal?: number;
  deposit?: number;
  description: string | null;
  category: string | null;
  category_id?: string | null;
  type?: 'expense' | 'income';
};

type CategoryRow = { id: string; name: string; emoji?: string };

type FilterOption = 'all' | 'today' | 'week' | 'month';

const CATEGORY_EMOJI: Record<string, string> = {
  food: '🍔',
  transport: '🚗',
  shopping: '🛒',
  entertainment: '🎬',
  bills: '📄',
  groceries: '🛒',
  dining: '🍽️',
  coffee: '☕',
  travel: '✈️',
  health: '💊',
  default: '💰',
};

function getCategoryEmoji(category: string | null): string {
  if (!category) return CATEGORY_EMOJI.default;
  const key = category.toLowerCase().replace(/\s+/g, '');
  return CATEGORY_EMOJI[key] ?? CATEGORY_EMOJI.default;
}

function getCategoryColor(category: string | null): string {
  const palette = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6'];
  if (!category) return palette[0];
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = category.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

function formatDateHeader(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const dNorm = new Date(d);
  dNorm.setHours(0, 0, 0, 0);

  if (dNorm.getTime() === today.getTime()) return 'Today';
  if (dNorm.getTime() === yesterday.getTime()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatAmount(amount: number, isExpense: boolean): string {
  const abs = Math.abs(amount);
  return `${isExpense ? '-' : '+'}$${abs.toFixed(2)}`;
}

function getStartOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getStartOfWeek(d: Date): Date {
  const x = new Date(d);
  const day = x.getDay();
  const diff = x.getDate() - day + (day === 0 ? -6 : 1);
  x.setDate(diff);
  x.setHours(0, 0, 0, 0);
  return x;
}

function getStartOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

export default function TransactionsScreen() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categoriesData, setCategoriesData] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<FilterOption>('all');

  const fetchTransactions = useCallback(() => {
    if (!user?.id) {
      setLoading(false);
      setTransactions([]);
      setCategoriesData([]);
      return;
    }
    setLoading(true);
    Promise.all([
      supabase.from('transactions').select('*').eq('user_id', user.id).order('date', { ascending: false }),
      supabase.from('categories').select('id, name, emoji').eq('user_id', user.id),
    ])
      .then(([txRes, catRes]) => {
        setLoading(false);
        if (txRes.error) {
          console.warn('Transactions fetch error:', txRes.error);
          setTransactions([]);
        } else {
          setTransactions((txRes.data as Transaction[]) ?? []);
        }
        if (catRes.error) {
          console.warn('Categories fetch error:', catRes.error);
          setCategoriesData([]);
        } else {
          setCategoriesData((catRes.data as CategoryRow[]) ?? []);
        }
      })
      .catch((err) => {
        console.warn('Transactions fetch exception:', err);
        setLoading(false);
        setTransactions([]);
      });
  }, [user?.id]);

  useFocusEffect(
    React.useCallback(() => {
      fetchTransactions();
    }, [fetchTransactions])
  );

  const filteredAndGrouped = useMemo(() => {
    const now = new Date();
    const startToday = getStartOfDay(now);
    const startWeek = getStartOfWeek(now);
    const startMonth = getStartOfMonth(now);

    let list = transactions.filter((t) => {
      const desc = (t.description ?? '').toLowerCase();
      const cat = categoriesData?.find((c) => c.id === t.category_id)?.name ?? (t.category ?? '');
      const catLower = (cat ?? '').toLowerCase();
      const q = searchQuery.toLowerCase().trim();
      if (q && !desc.includes(q) && !catLower.includes(q)) return false;

      const tDate = new Date(t.date);
      if (filter === 'today' && tDate < startToday) return false;
      if (filter === 'week' && tDate < startWeek) return false;
      if (filter === 'month' && tDate < startMonth) return false;
      return true;
    });

    const groups: { date: string; label: string; items: Transaction[] }[] = [];
    const seen = new Set<string>();
    for (const t of list) {
      const d = new Date(t.date);
      d.setHours(0, 0, 0, 0);
      const key = d.toISOString();
      if (!seen.has(key)) {
        seen.add(key);
        groups.push({
          date: key,
          label: formatDateHeader(t.date),
          items: list.filter((x) => {
            const xd = new Date(x.date);
            xd.setHours(0, 0, 0, 0);
            return xd.toISOString() === key;
          }),
        });
      }
    }
    return groups;
  }, [transactions, categoriesData, searchQuery, filter]);

  const summary = useMemo(() => {
    let spent = 0;
    let income = 0;
    for (const g of filteredAndGrouped) {
      for (const t of g.items) {
        if (t.type === 'expense') spent += Number(t.withdrawal) || 0;
        else income += Number(t.deposit) || 0;
      }
    }
    return { spent, income };
  }, [filteredAndGrouped]);

  const filterChips: { key: FilterOption; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
  ];

  const renderTransaction = (t: Transaction) => {
    const amt = t.type === 'expense' ? (Number(t.withdrawal) || 0) : (Number(t.deposit) || 0);
    const isExpense = t.type === 'expense';
    const name = t.description ?? 'Transaction';
    const cat = categoriesData?.find((c) => c.id === t.category_id);
    const categoryLabel = cat ? `${cat.emoji ?? '💰'} ${cat.name}` : 'Uncategorized';
    const emoji = cat?.emoji ?? getCategoryEmoji(cat?.name ?? t.category);
    const circleColor = getCategoryColor(cat?.name ?? t.category);

    return (
      <View key={t.id} style={styles.transactionItem}>
        <View style={styles.transactionLeft}>
          <View style={[styles.emojiCircle, { backgroundColor: circleColor }]}>
            <Text style={styles.emojiText}>{emoji}</Text>
          </View>
          <View style={styles.transactionInfo}>
            <Text style={styles.transactionName}>{name}</Text>
            <Text style={styles.transactionCategory}>{categoryLabel}</Text>
            <Text style={styles.transactionTime}>
              {formatDateHeader(t.date)} · {formatTime(t.date)}
            </Text>
          </View>
        </View>
        <Text style={[styles.transactionAmount, isExpense ? styles.amountExpense : styles.amountIncome]}>
          {formatAmount(amt, isExpense)}
        </Text>
      </View>
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading transactions...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Transactions</Text>
        <Text style={styles.subtitle}>Your spending history</Text>

        {/* Search bar */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Search transactions..."
            placeholderTextColor={colors.textSecondary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsContent}
          showsHorizontalScrollIndicator={false}
        >
          {filterChips.map((chip) => {
            const active = filter === chip.key;
            return (
              <TouchableOpacity
                key={chip.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setFilter(chip.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Summary row */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Spent</Text>
            <Text style={[styles.summaryAmount, styles.summarySpent]}>
              ${summary.spent.toFixed(2)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Income</Text>
            <Text style={[styles.summaryAmount, styles.summaryIncome]}>
              ${summary.income.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Transactions list or empty state */}
        {filteredAndGrouped.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyEmoji}>📭</Text>
            <Text style={styles.emptyTitle}>No transactions yet</Text>
            <Text style={styles.emptySubtitle}>
              Chat with Finni to log your first expense
            </Text>
          </View>
        ) : (
          filteredAndGrouped.map((group) => (
            <View key={group.date} style={styles.dateGroup}>
              <Text style={styles.dateHeader}>{group.label}</Text>
              {group.items.map((t) => renderTransaction(t))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 20,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 16,
    gap: 10,
  },
  searchIcon: {
    fontSize: 18,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
    padding: 0,
  },
  chipsScroll: {
    maxHeight: 44,
    marginBottom: 20,
  },
  chipsContent: {
    flexDirection: 'row',
    paddingVertical: 4,
  },
  chip: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.textPrimary,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
  },
  summaryLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  summaryAmount: {
    fontSize: 20,
    fontWeight: '700',
  },
  summarySpent: {
    color: colors.error,
  },
  summaryIncome: {
    color: colors.success,
  },
  dateGroup: {
    marginBottom: 20,
  },
  dateHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 10,
    marginLeft: 4,
  },
  transactionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  transactionLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  emojiCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  emojiText: {
    fontSize: 20,
  },
  transactionInfo: {
    flex: 1,
  },
  transactionName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  transactionCategory: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  transactionTime: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  transactionAmount: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 12,
  },
  amountExpense: {
    color: colors.error,
  },
  amountIncome: {
    color: colors.success,
  },
  emptyState: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 40,
    alignItems: 'center',
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
