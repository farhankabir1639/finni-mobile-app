import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import {
  getDailyInsights,
  getWeeklySavingsRecommendations,
  clearAgentCache,
  type DailyInsight,
  type SavingsRecommendation,
} from '../lib/agents';

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

type PeriodOption = 'week' | 'month' | '3months' | 'year';

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

function getPeriodStart(period: PeriodOption): Date {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (period === 'week') {
    const day = start.getDay();
    const diff = start.getDate() - day + (day === 0 ? -6 : 1);
    start.setDate(diff);
  } else if (period === 'month') {
    start.setDate(1);
  } else if (period === '3months') {
    start.setMonth(start.getMonth() - 2);
    start.setDate(1);
  } else if (period === 'year') {
    start.setMonth(0);
    start.setDate(1);
  }
  return start;
}

function formatLastUpdated(date: Date | null): string {
  if (!date) return '';
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) return 'Last updated: today';
  if (diffDays === 1) return 'Last updated: 1 day ago';
  return `Last updated: ${diffDays} days ago`;
}

export default function AnalyticsScreen() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodOption>('month');
  const [insights, setInsights] = useState<DailyInsight[]>([]);
  const [savingsRecs, setSavingsRecs] = useState<SavingsRecommendation[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);

  const runAgents = useCallback(async (forceRefresh = false) => {
    if (!user?.id || transactions.length < 1) return;
    if (forceRefresh) {
      await clearAgentCache(user.id);
      setInsights([]);
      setSavingsRecs([]);
    }
    setInsightsLoading(true);
    console.log('[Analytics] Calling agents...');
    try {
      const [dailyInsights, weeklySavings] = await Promise.all([
        getDailyInsights(user.id, transactions),
        getWeeklySavingsRecommendations(user.id, transactions),
      ]);
      console.log('[Analytics] Insights result:', dailyInsights);
      console.log('[Analytics] Savings result:', weeklySavings);
      setInsights(Array.isArray(dailyInsights) ? dailyInsights : []);
      setSavingsRecs(Array.isArray(weeklySavings) ? weeklySavings : []);
      setLastUpdated(new Date());
    } catch (e) {
      console.error('[Analytics] Agents error:', e);
    } finally {
      setInsightsLoading(false);
    }
  }, [user?.id, transactions]);

  useEffect(() => {
    if (!user?.id) {
      setLoading(false);
      setTransactions([]);
      return;
    }
    setLoading(true);
    supabase
      .from('transactions')
      .select('*')
      .eq('user_id', user.id)
      .order('date', { ascending: false })
      .then(({ data, error }) => {
        setLoading(false);
        if (error) {
          console.warn('Analytics fetch error:', error);
          setTransactions([]);
          return;
        }
        setTransactions((data as Transaction[]) ?? []);
      })
      .catch((err) => {
        console.warn('Analytics fetch exception:', err);
        setLoading(false);
        setTransactions([]);
      });
  }, [user?.id]);

  const [categories, setCategories] = useState<{ id: string; name: string; emoji: string }[]>([]);
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('categories')
      .select('id, name, emoji')
      .eq('user_id', user.id)
      .then(({ data }) => setCategories(data ?? []));
  }, [user?.id]);

  useEffect(() => {
    if (transactions.length >= 1 && user?.id) {
      runAgents(false);
    }
  }, [user?.id, transactions.length, runAgents]);

  const periodStart = useMemo(() => getPeriodStart(period), [period]);

  const filteredTransactions = useMemo(() => {
    return transactions.filter((t) => new Date(t.date) >= periodStart);
  }, [transactions, periodStart]);

  const { totalSpent, totalSaved, byCategory, monthlyData } = useMemo(() => {
    let spent = 0;
    let saved = 0;
    const categoryMap: Record<string, number> = {};
    const monthMap: Record<string, number> = {};

    for (const t of filteredTransactions) {
      if (t.type === 'expense') {
        const w = Number(t.withdrawal) || 0;
        spent += w;
        const categoryObj = categories.find((c) => c.id === t.category_id);
        const cat = categoryObj?.name ?? 'Uncategorized';
        categoryMap[cat] = (categoryMap[cat] ?? 0) + w;
        const d = new Date(t.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthMap[key] = (monthMap[key] ?? 0) + w;
      } else {
        saved += Number(t.deposit) || 0;
      }
    }

    const byCategory = Object.entries(categoryMap)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    const now = new Date();
    const last6Months: { key: string; label: string; amount: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      last6Months.push({
        key,
        label: d.toLocaleDateString('en-US', { month: 'short' }),
        amount: monthMap[key] ?? 0,
      });
    }

    const maxMonthly = Math.max(...last6Months.map((m) => m.amount), 1);

    return {
      totalSpent: spent,
      totalSaved: saved,
      byCategory,
      monthlyData: last6Months.map((m) => ({ ...m, pct: maxMonthly > 0 ? (m.amount / maxMonthly) * 100 : 0 })),
    };
  }, [filteredTransactions, categories]);

  const periodChips: { key: PeriodOption; label: string }[] = [
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: '3months', label: '3 Months' },
    { key: 'year', label: 'This Year' },
  ];

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.loadingText}>Loading analytics...</Text>
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
      >
        <Text style={styles.title}>Analytics</Text>
        <Text style={styles.subtitle}>Your financial insights</Text>

        {/* Time period filter */}
        <ScrollView
          horizontal
          style={styles.chipsScroll}
          contentContainerStyle={styles.chipsContent}
          showsHorizontalScrollIndicator={false}
        >
          {periodChips.map((chip) => {
            const active = period === chip.key;
            return (
              <TouchableOpacity
                key={chip.key}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setPeriod(chip.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Summary cards */}
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Spent</Text>
            <Text style={[styles.summaryAmount, styles.summarySpent]}>
              ${totalSpent.toFixed(2)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Total Saved</Text>
            <Text style={[styles.summaryAmount, styles.summarySaved]}>
              ${totalSaved.toFixed(2)}
            </Text>
          </View>
        </View>

        {/* Spending by Category */}
        <Text style={styles.sectionTitle}>Spending by Category</Text>
        <View style={styles.categorySection}>
          {byCategory.length === 0 ? (
            <>
              {[1, 2, 3, 4].map((i) => (
                <View key={i} style={styles.categoryPlaceholder}>
                  <View style={styles.categoryPlaceholderLeft}>
                    <Text style={styles.placeholderEmoji}>💰</Text>
                    <Text style={styles.placeholderText}>Category {i}</Text>
                  </View>
                  <View style={styles.categoryRowMiddle}>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: '0%', backgroundColor: colors.border }]} />
                    </View>
                  </View>
                  <Text style={styles.placeholderAmount}>$0.00</Text>
                </View>
              ))}
            </>
          ) : (
            byCategory.map((cat) => {
              const pct = totalSpent > 0 ? (cat.amount / totalSpent) * 100 : 0;
              const catColor = getCategoryColor(cat.name);
              const emoji = categories.find((c) => c.name === cat.name)?.emoji ?? getCategoryEmoji(cat.name);
              return (
                <View key={cat.name} style={styles.categoryRow}>
                  <View style={styles.categoryRowLeft}>
                    <Text style={styles.categoryEmoji}>{emoji}</Text>
                    <Text style={styles.categoryName}>{cat.name}</Text>
                  </View>
                  <View style={styles.categoryRowMiddle}>
                    <View style={styles.progressTrack}>
                      <View
                        style={[
                          styles.progressFill,
                          { width: `${pct}%`, backgroundColor: catColor },
                        ]}
                      />
                    </View>
                  </View>
                  <Text style={styles.categoryAmount}>${cat.amount.toFixed(2)}</Text>
                </View>
              );
            })
          )}
        </View>

        {/* Monthly Trend */}
        <Text style={styles.sectionTitle}>Monthly Trend</Text>
        <View style={styles.monthlySection}>
          <View style={styles.chartRow}>
            {monthlyData.map((m) => (
              <View key={m.key} style={styles.barContainer}>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { height: `${m.pct}%`, backgroundColor: m.pct > 0 ? colors.primary : colors.border },
                    ]}
                  />
                </View>
                <Text style={styles.barLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* AI Insights section - only when user has transactions */}
        {transactions.length >= 1 && (
          <>
            <View style={styles.aiInsightsHeader}>
              <Text style={styles.sectionTitle}>AI Insights</Text>
              <TouchableOpacity
                style={styles.refreshButton}
                onPress={() => runAgents(true)}
                disabled={insightsLoading}
                activeOpacity={0.8}
              >
                <Text style={styles.refreshButtonText}>
                  {insightsLoading ? 'Refreshing...' : 'Refresh'}
                </Text>
              </TouchableOpacity>
            </View>
            {lastUpdated && (
              <Text style={styles.lastUpdatedText}>{formatLastUpdated(lastUpdated)}</Text>
            )}
            <View style={styles.aiInsightsSection}>
              {insightsLoading && insights.length === 0 ? (
                <View style={styles.aiInsightCard}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={[styles.aiInsightSubtitle, { marginTop: 8 }]}>
                    Analyzing your spending...
                  </Text>
                </View>
              ) : (
                <>
                  {insights.map((insight, i) => (
                    <View key={i} style={styles.aiInsightCard}>
                      <Text style={styles.aiInsightTitle}>📊 {insight.summary || 'Insight'}</Text>
                      <Text style={styles.aiInsightSubtitle}>
                        {insight.suggestion || insight.topCategory || '—'}
                      </Text>
                    </View>
                  ))}
                  {savingsRecs.map((rec, i) => (
                    <View key={`savings-${i}`} style={styles.aiInsightCard}>
                      <Text style={styles.aiInsightTitle}>💰 {rec.title}</Text>
                      <Text style={styles.aiInsightSubtitle}>{rec.description}</Text>
                      {rec.potentialSavings && (
                        <Text style={styles.potentialSavings}>{rec.potentialSavings}</Text>
                      )}
                    </View>
                  ))}
                  {!insightsLoading && insights.length === 0 && savingsRecs.length === 0 && (
                    <View style={styles.aiInsightCard}>
                      <Text style={styles.aiInsightTitle}>📊 Insights</Text>
                      <Text style={styles.aiInsightSubtitle}>
                        Add more transactions to get personalized insights.
                      </Text>
                    </View>
                  )}
                </>
              )}
            </View>
          </>
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
  chipsScroll: {
    maxHeight: 44,
    marginBottom: 20,
  },
  chipsContent: {
    flexDirection: 'row',
    paddingVertical: 4,
    gap: 8,
  },
  chip: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
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
  summarySaved: {
    color: colors.success,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  categorySection: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    marginBottom: 24,
  },
  categoryPlaceholder: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryPlaceholderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 100,
    gap: 8,
  },
  placeholderEmoji: {
    fontSize: 20,
  },
  placeholderText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 100,
    gap: 8,
  },
  categoryEmoji: {
    fontSize: 20,
  },
  categoryName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  categoryRowMiddle: {
    flex: 1,
    marginHorizontal: 12,
  },
  progressTrack: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 4,
  },
  categoryAmount: {
    fontSize: 13,
    color: colors.textSecondary,
    width: 60,
    textAlign: 'right',
  },
  placeholderAmount: {
    fontSize: 13,
    color: colors.textSecondary,
    width: 60,
    textAlign: 'right',
  },
  monthlySection: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
  },
  chartRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 120,
  },
  barContainer: {
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  barTrack: {
    flex: 1,
    width: '100%',
    maxWidth: 36,
    backgroundColor: colors.border,
    borderRadius: 6,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    marginBottom: 8,
  },
  barFill: {
    width: '100%',
    minHeight: 4,
    borderRadius: 6,
  },
  barLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  aiInsightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  refreshButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    borderWidth: 1,
    borderColor: '#6366F1',
  },
  refreshButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6366F1',
  },
  lastUpdatedText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 12,
  },
  aiInsightsSection: {
    gap: 12,
  },
  potentialSavings: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.success,
    marginTop: 4,
  },
  aiInsightCard: {
    backgroundColor: '#1a1f3a',
    borderWidth: 1,
    borderColor: '#6366F1',
    borderRadius: 12,
    padding: 16,
  },
  aiInsightTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  aiInsightSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  comingSoonBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
  },
  comingSoonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6366F1',
  },
});
