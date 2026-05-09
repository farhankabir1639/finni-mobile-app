import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCalendars } from 'expo-localization';
import { PieChart } from 'react-native-chart-kit';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import {
  getDailyInsights,
  getWeeklySavingsRecommendations,
  clearAgentCache,
  type DailyInsight,
  type SavingsRecommendation,
} from '../lib/agents';

const SCREEN_WIDTH = Dimensions.get('window').width;

const PIE_COLORS = [
  '#6366F1',
  '#8B5CF6',
  '#EC4899',
  '#F59E0B',
  '#10B981',
  '#3B82F6',
  '#EF4444',
  '#F97316',
  '#14B8A6',
  '#84CC16',
  '#6B7280',
];

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

type CategoryTotal = { name: string; amount: number };

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
  if (!category) return PIE_COLORS[0];
  let hash = 0;
  for (let i = 0; i < category.length; i++) hash = category.charCodeAt(i) + ((hash << 5) - hash);
  return PIE_COLORS[Math.abs(hash) % PIE_COLORS.length];
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

function prepareChartData(categoryTotals: CategoryTotal[]): CategoryTotal[] {
  const sorted = [...categoryTotals].sort((a, b) => b.amount - a.amount);
  const top10 = sorted.slice(0, 10);
  const rest = sorted.slice(10);
  const miscTotal = rest.reduce((sum, c) => sum + c.amount, 0);
  if (miscTotal > 0) top10.push({ name: 'Misc', amount: miscTotal });
  return top10;
}

function analyticsCacheKey(userId: string, date: string): string {
  return `analytics_cache_${userId}_${date}`;
}

const INSIGHT_TYPE_CONFIG: Record<string, { color: string; icon: string }> = {
  warning: { color: '#F59E0B', icon: '⚠️' },
  tip: { color: '#3B82F6', icon: '💡' },
  goal: { color: '#10B981', icon: '🎯' },
  income_alert: { color: '#EF4444', icon: '🚨' },
};

export default function AnalyticsScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { currencySymbol } = useProfile();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<PeriodOption>('month');
  const [monthlyIncome, setMonthlyIncome] = useState(0);
  const [categories, setCategories] = useState<{ id: string; name: string; emoji: string; budget?: number }[]>([]);
  const [insights, setInsights] = useState<DailyInsight[]>([]);
  const [savingsRecs, setSavingsRecs] = useState<SavingsRecommendation[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [showRefreshButton, setShowRefreshButton] = useState(false);
  const [insightsError, setInsightsError] = useState('');
  const [refreshCooldown, setRefreshCooldown] = useState(false);
  const [userInsightPrompt, setUserInsightPrompt] = useState('');
  const [promptDraft, setPromptDraft] = useState('');
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const syncAttemptedRef = useRef(false);

  const USER_PROMPT_KEY = user?.id ? `insights_user_prompt_${user.id}` : null;
  const USER_PROMPT_MAX = 250;

  useEffect(() => {
    if (!USER_PROMPT_KEY) return;
    AsyncStorage.getItem(USER_PROMPT_KEY).then((val) => {
      if (val) { setUserInsightPrompt(val); setPromptDraft(val); }
    });
  }, [USER_PROMPT_KEY]);

  const saveUserPrompt = async () => {
    if (!USER_PROMPT_KEY) return;
    const trimmed = promptDraft.trim();
    setUserInsightPrompt(trimmed);
    if (trimmed) await AsyncStorage.setItem(USER_PROMPT_KEY, trimmed);
    else await AsyncStorage.removeItem(USER_PROMPT_KEY);
    setShowPromptEditor(false);
  };

  // Fetch fresh insights from Gemini, cache result with today's local-date key
  const fetchAndCacheInsights = useCallback(async () => {
    if (!user?.id) return;
    const tz = getCalendars()[0]?.timeZone ?? 'UTC';
    const localDate = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const cacheKey = analyticsCacheKey(user.id, localDate);

    setInsightsLoading(true);
    setInsightsError('');

    try {
      await clearAgentCache(user.id);

      const now = new Date();
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthTx = transactions
        .filter((t) => new Date(t.date) >= startOfMonth)
        .map((t) => ({ ...t, category: t.category ?? null }));

      const [freshInsights, freshSavings] = await Promise.all([
        getDailyInsights(user.id, monthTx, userInsightPrompt || undefined),
        getWeeklySavingsRecommendations(user.id, monthTx),
      ]);

      const insightsList = Array.isArray(freshInsights) ? freshInsights : [];
      const savingsList = Array.isArray(freshSavings) ? freshSavings : [];
      const updatedAt = new Date();

      setInsights(insightsList);
      setSavingsRecs(savingsList);
      setLastUpdated(updatedAt);
      setShowRefreshButton(false);
      setRefreshCooldown(true);
      setTimeout(() => setRefreshCooldown(false), 5 * 60 * 1000);

      await AsyncStorage.setItem(
        cacheKey,
        JSON.stringify({ insights: insightsList, savings: savingsList, updatedAt: updatedAt.toISOString() })
      );
    } catch (e) {
      console.error('[Analytics] Insights error:', e);
      setInsightsError('Failed to load insights. Tap Refresh to try again.');
      setShowRefreshButton(true);
    } finally {
      setInsightsLoading(false);
    }
  }, [user?.id, transactions, userInsightPrompt]);

  // On load: check today's cache → auto-fetch if transactions today → fall back to yesterday
  const syncInsights = useCallback(async () => {
    if (!user?.id || transactions.length < 1) return;

    const tz = getCalendars()[0]?.timeZone ?? 'UTC';
    const localDate = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const cacheKey = analyticsCacheKey(user.id, localDate);

    // 1. Today's cache exists → show it, no Refresh button
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const { insights: ci, savings: cs, updatedAt } = JSON.parse(cached);
      setInsights(ci ?? []);
      setSavingsRecs(cs ?? []);
      setLastUpdated(updatedAt ? new Date(updatedAt) : null);
      setShowRefreshButton(false);
      return;
    }

    // 2. Has transactions logged today → auto-fetch fresh insights
    const hasTodayTx = transactions.some(
      (t) => new Date(t.date).toLocaleDateString('en-CA', { timeZone: tz }) === localDate
    );
    if (hasTodayTx) {
      await fetchAndCacheInsights();
      return;
    }

    // 3. No transactions today → load yesterday's cached insights + show Refresh
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayDate = yesterday.toLocaleDateString('en-CA', { timeZone: tz });
    const yesterdayCached = await AsyncStorage.getItem(analyticsCacheKey(user.id, yesterdayDate));
    if (yesterdayCached) {
      const { insights: ci, savings: cs, updatedAt } = JSON.parse(yesterdayCached);
      setInsights(ci ?? []);
      setSavingsRecs(cs ?? []);
      setLastUpdated(updatedAt ? new Date(updatedAt) : null);
    }
    setShowRefreshButton(true);
  }, [user?.id, transactions, fetchAndCacheInsights]);

  const fetchAll = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      setTransactions([]);
      return;
    }
    setLoading(true);
    syncAttemptedRef.current = false;

    const [txRes, catRes, incomeRes] = await Promise.all([
      supabase.from('transactions').select('*').eq('user_id', user.id).order('date', { ascending: false }),
      supabase.from('categories').select('id, name, emoji, budget').eq('user_id', user.id),
      supabase.from('income').select('amount, frequency').eq('user_id', user.id),
    ]);

    setLoading(false);

    if (txRes.error) {
      console.warn('[Analytics] Transactions fetch error:', txRes.error);
      setTransactions([]);
    } else {
      setTransactions((txRes.data as Transaction[]) ?? []);
    }

    if (!catRes.error) setCategories(catRes.data ?? []);

    if (!incomeRes.error) {
      const total = (incomeRes.data ?? []).reduce((sum, r) => {
        const amt = Number(r.amount) || 0;
        if (r.frequency === 'weekly') return sum + amt * 4.33;
        if (r.frequency === 'annual') return sum + amt / 12;
        return sum + amt;
      }, 0);
      setMonthlyIncome(total);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      fetchAll();
    }, [fetchAll])
  );

  // Run sync once per focus after transactions are loaded
  useEffect(() => {
    if (transactions.length >= 50 && user?.id && !syncAttemptedRef.current) {
      syncAttemptedRef.current = true;
      syncInsights();
    }
  }, [transactions.length, user?.id, syncInsights]);

  const periodStart = useMemo(() => getPeriodStart(period), [period]);

  const filteredTransactions = useMemo(
    () => transactions.filter((t) => new Date(t.date) >= periodStart),
    [transactions, periodStart]
  );

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

    const byCategory: CategoryTotal[] = Object.entries(categoryMap)
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
      monthlyData: last6Months.map((m) => ({
        ...m,
        pct: maxMonthly > 0 ? (m.amount / maxMonthly) * 100 : 0,
      })),
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

  const pieData = prepareChartData(byCategory);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.disclaimerBanner}>
        <Text style={styles.disclaimerBannerText}>
          ⚠️ For informational purposes only. Not financial advice. Consult a qualified professional before making financial decisions.
        </Text>
      </View>
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
              {currencySymbol}{totalSpent.toFixed(2)}
            </Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>
              {monthlyIncome > 0 ? 'Monthly Income' : 'Total Saved'}
            </Text>
            <Text style={[styles.summaryAmount, styles.summarySaved]}>
              {monthlyIncome > 0
                ? `${currencySymbol}${(() => {
                    if (period === 'week') return (monthlyIncome / 4.33).toFixed(2);
                    if (period === '3months') return (monthlyIncome * 3).toFixed(2);
                    if (period === 'year') return (monthlyIncome * 12).toFixed(2);
                    return monthlyIncome.toFixed(2);
                  })()}`
                : `${currencySymbol}${totalSaved.toFixed(2)}`}
            </Text>
          </View>
        </View>

        {/* Spending by Category — bar list */}
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
                  <Text style={styles.placeholderAmount}>{currencySymbol}0.00</Text>
                </View>
              ))}
            </>
          ) : (
            byCategory.map((cat) => {
              const catObj = categories.find((c) => c.name === cat.name);
              const budget = catObj?.budget ?? 0;
              const hasBudget = budget > 0;
              const pct = hasBudget
                ? Math.min(100, (cat.amount / budget) * 100)
                : totalSpent > 0 ? (cat.amount / totalSpent) * 100 : 0;
              const overBudget = hasBudget && cat.amount > budget;
              const catColor = overBudget ? '#EF4444' : getCategoryColor(cat.name);
              const emoji = catObj?.emoji ?? getCategoryEmoji(cat.name);
              return (
                <View key={cat.name} style={styles.categoryRow}>
                  <View style={styles.categoryRowLeft}>
                    <Text style={styles.categoryEmoji}>{emoji}</Text>
                    <Text style={styles.categoryName}>{cat.name}</Text>
                  </View>
                  <View style={styles.categoryRowMiddle}>
                    <View style={styles.progressTrack}>
                      <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: catColor }]} />
                    </View>
                    {hasBudget && (
                      <Text style={{ fontSize: 10, color: overBudget ? '#EF4444' : colors.textSecondary, marginTop: 2 }}>
                        {overBudget ? '⚠ ' : ''}{currencySymbol}{cat.amount.toFixed(0)} / {currencySymbol}{budget.toFixed(0)}
                      </Text>
                    )}
                  </View>
                  <Text style={[styles.categoryAmount, overBudget && { color: '#EF4444' }]}>
                    {currencySymbol}{cat.amount.toFixed(2)}
                  </Text>
                </View>
              );
            })
          )}
        </View>

        {/* Spending Distribution — pie chart */}
        {byCategory.length >= 2 ? (
          <>
            <Text style={styles.sectionTitle}>Spending Distribution</Text>
            <View style={styles.pieSection}>
              <PieChart
                data={pieData.map((cat, i) => ({
                  name: cat.name.length > 13 ? cat.name.slice(0, 13) + '…' : cat.name,
                  population: cat.amount,
                  color: PIE_COLORS[i % PIE_COLORS.length],
                  legendFontColor: '#94A3B8',
                  legendFontSize: 11,
                }))}
                width={SCREEN_WIDTH - 40}
                height={200}
                chartConfig={{
                  color: (opacity = 1) => `rgba(148, 163, 184, ${opacity})`,
                }}
                accessor="population"
                backgroundColor="transparent"
                paddingLeft="10"
                absolute={false}
              />
            </View>
          </>
        ) : byCategory.length === 1 ? (
          <>
            <Text style={styles.sectionTitle}>Spending Distribution</Text>
            <View style={styles.pieEmptyState}>
              <Text style={styles.pieEmptyText}>
                Add transactions in more categories to see the distribution chart
              </Text>
            </View>
          </>
        ) : null}

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
                      {
                        height: `${m.pct}%`,
                        backgroundColor: m.pct > 0 ? colors.primary : colors.border,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.barLabel}>{m.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* AI Insights */}
        {transactions.length < 50 ? (
          <View style={[styles.aiInsightCard, { borderColor: colors.border }]}>
            <Text style={[styles.aiInsightTitle, { color: colors.textSecondary }]}>📊 Insights</Text>
            <Text style={styles.aiInsightSubtitle}>
              Finni needs at least 50 real transactions to generate accurate, personalized insights.{'\n\n'}
              {transactions.length > 0
                ? `You have ${transactions.length} so far — ${50 - transactions.length} more to go!`
                : 'Start by logging your first expense in the chat.'}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.aiInsightsHeader}>
              <Text style={styles.sectionTitle}>AI Insights</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  style={styles.refreshButton}
                  onPress={() => { setPromptDraft(userInsightPrompt); setShowPromptEditor((v) => !v); }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.refreshButtonText}>✏️ Customize</Text>
                </TouchableOpacity>
                {showRefreshButton && (
                  <TouchableOpacity
                    style={[styles.refreshButton, (insightsLoading || refreshCooldown) && { opacity: 0.5 }]}
                    onPress={fetchAndCacheInsights}
                    disabled={insightsLoading || refreshCooldown}
                    activeOpacity={0.8}
                  >
                    {insightsLoading ? (
                      <ActivityIndicator size="small" color="#6366F1" />
                    ) : (
                      <Text style={styles.refreshButtonText}>{refreshCooldown ? 'Wait 5 min' : 'Refresh'}</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </View>
            {showPromptEditor && (
              <View style={styles.promptEditor}>
                <Text style={styles.promptEditorLabel}>
                  Add custom instructions for your insights (e.g. "Focus on food spending" or "Be more encouraging")
                </Text>
                <TextInput
                  style={styles.promptEditorInput}
                  value={promptDraft}
                  onChangeText={(t) => setPromptDraft(t.slice(0, USER_PROMPT_MAX))}
                  placeholder="e.g. Focus on food and transport. Be very concise."
                  placeholderTextColor={colors.textSecondary}
                  multiline
                  maxLength={USER_PROMPT_MAX}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <Text style={styles.promptCharCount}>{promptDraft.length}/{USER_PROMPT_MAX}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity onPress={() => setShowPromptEditor(false)} style={styles.promptCancelBtn}>
                      <Text style={styles.promptCancelText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={saveUserPrompt} style={styles.promptSaveBtn}>
                      <Text style={styles.promptSaveText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
            {lastUpdated && (
              <Text style={styles.lastUpdatedText}>{formatLastUpdated(lastUpdated)}</Text>
            )}
            {insightsError ? (
              <Text style={styles.insightsError}>{insightsError}</Text>
            ) : null}
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
                  {insights.map((insight, i) => {
                    const insightType = insight.type ?? 'tip';
                    const typeConfig = INSIGHT_TYPE_CONFIG[insightType] ?? INSIGHT_TYPE_CONFIG.tip;
                    const title = insight.title || insight.summary || 'Insight';
                    const description = insight.description || insight.suggestion || insight.topCategory || '—';
                    return (
                      <View
                        key={i}
                        style={[styles.aiInsightCard, { borderColor: typeConfig.color }]}
                      >
                        <Text style={[styles.aiInsightTitle, { color: typeConfig.color }]}>
                          {typeConfig.icon} {title}
                        </Text>
                        <Text style={styles.aiInsightSubtitle}>{description}</Text>
                        {insightType === 'income_alert' && (
                          <TouchableOpacity
                            style={[styles.insightCTA, { borderColor: typeConfig.color }]}
                            onPress={() => navigation.navigate('Settings' as never)}
                            activeOpacity={0.8}
                          >
                            <Text style={[styles.insightCTAText, { color: typeConfig.color }]}>
                              💡 Add income sources →
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                  {savingsRecs.map((rec, i) => (
                    <View key={`savings-${i}`} style={[styles.aiInsightCard, { borderColor: '#3B82F6' }]}>
                      <Text style={[styles.aiInsightTitle, { color: '#3B82F6' }]}>💰 {rec.title}</Text>
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
  pieSection: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    overflow: 'hidden',
    paddingVertical: 8,
    marginBottom: 24,
  },
  pieEmptyState: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 28,
    alignItems: 'center',
    marginBottom: 24,
  },
  pieEmptyText: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
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
    minWidth: 80,
    alignItems: 'center',
  },
  refreshButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6366F1',
  },
  lastUpdatedText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 8,
  },
  insightsError: {
    fontSize: 13,
    color: colors.error,
    marginBottom: 10,
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
  insightCTA: {
    marginTop: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  insightCTAText: {
    fontSize: 13,
    fontWeight: '600',
  },
  promptEditor: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  promptEditorLabel: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 8,
    lineHeight: 18,
  },
  promptEditorInput: {
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  promptCharCount: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  promptCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  promptCancelText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  promptSaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  promptSaveText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  disclaimerBanner: {
    backgroundColor: 'rgba(245, 158, 11, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(245, 158, 11, 0.2)',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  disclaimerBannerText: {
    fontSize: 11,
    color: '#94A3B8',
    lineHeight: 16,
    textAlign: 'center',
  },
});
