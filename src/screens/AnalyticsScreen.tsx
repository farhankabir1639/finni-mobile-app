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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCalendars } from 'expo-localization';
import Svg, { Path, Circle, Line, Polyline } from 'react-native-svg';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { supabase } from '../lib/supabase';
import {
  getDailyInsights,
  getWeeklySavingsRecommendations,
  clearAgentCache,
  type DailyInsight,
  type SavingsRecommendation,
} from '../lib/agents';
import { captureError } from '../lib/sentry';
import { trackScreen } from '../lib/analytics';
import { t, fonts } from '../theme/tokens';
import Aurora from '../components/Aurora';
import GlassCard from '../components/GlassCard';
import GlowDonut from '../components/GlowDonut';
import TrendArea from '../components/TrendArea';
import Orb from '../components/Orb';
import CatIconComponent from '../components/CatIcon';
import DateRangePicker, { type DateRange, fmtShort } from '../components/DateRangePicker';

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

// ── Category visual mapping ──
const CAT_COLORS: Record<string, string> = {
  food: t.catFood,
  transport: t.catTransport,
  shopping: t.catShopping,
  bills: t.catBills,
  income: t.catIncome,
  uncategorized: t.catUncat,
};

function getCatColor(name: string): string {
  const key = (name ?? '').toLowerCase().replace(/\s+/g, '');
  return CAT_COLORS[key] ?? t.catUncat;
}


// ── Types ──
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
type PeriodOption = 'week' | 'month' | '3months' | 'year' | 'custom';

// ── Helpers ──
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

function analyticsCacheKey(userId: string, date: string): string {
  return `analytics_cache_${userId}_${date}`;
}

function prepareChartData(categoryTotals: CategoryTotal[]): CategoryTotal[] {
  const sorted = [...categoryTotals].sort((a, b) => b.amount - a.amount);
  const top10 = sorted.slice(0, 10);
  const rest = sorted.slice(10);
  const miscTotal = rest.reduce((sum, c) => sum + c.amount, 0);
  if (miscTotal > 0) top10.push({ name: 'Misc', amount: miscTotal });
  return top10;
}

// ── Insight tone mapping ──
const INSIGHT_TONE: Record<string, string> = {
  warning: t.amber,
  tip: t.auraAqua,
  goal: t.auraViolet,
  income_alert: t.red,
};

// Keyword → icon key. Runs over the full insight text so the icon reflects
// the actual subject (e.g. "homeownership" → house) rather than just the type tag.
function resolveInsightIcon(title: string, body: string, type: string): string {
  const text = `${title} ${body}`.toLowerCase();
  if (/home|house|rent|mortgage|homeown|property/.test(text)) return 'home';
  if (/health|doctor|medicine|pharma|gym|fitness|medical/.test(text)) return 'health';
  if (/food|dining|restaurant|coffee|grocer|meal|lunch|dinner|snack/.test(text)) return 'food';
  if (/transport|uber|grab|taxi|fuel|petrol|car|bus|train|commut/.test(text)) return 'transport';
  if (/shop|amazon|cloth|mall|retail/.test(text)) return 'shopping';
  if (/entertain|netflix|spotify|cinema|movie|stream/.test(text)) return 'entertainment';
  if (/income|salary|earn|wage|revenue/.test(text) && type !== 'income_alert') return 'trending_up';
  if (/bill|electric|water|utility|internet|subscri/.test(text)) return 'bills';
  return type; // fallback: warning | tip | goal | income_alert
}

function InsightIcon({ iconKey, color }: { iconKey: string; color: string }) {
  const sw = 1.8;
  const lc = 'round' as const;
  const lj = 'round' as const;
  const base = { stroke: color, strokeWidth: sw, strokeLinecap: lc, strokeLinejoin: lj, fill: 'none' } as const;

  switch (iconKey) {
    case 'warning': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path {...base} d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <Line x1="12" y1="9" x2="12" y2="13" stroke={color} strokeWidth={sw} strokeLinecap={lc} />
        <Line x1="12" y1="17" x2="12.01" y2="17" stroke={color} strokeWidth={2.5} strokeLinecap={lc} />
      </Svg>
    );
    case 'goal': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={sw} fill="none" />
        <Circle cx="12" cy="12" r="6"  stroke={color} strokeWidth={sw} fill="none" />
        <Circle cx="12" cy="12" r="2"  stroke={color} strokeWidth={sw} fill={color} />
      </Svg>
    );
    case 'income_alert': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Polyline points="23,18 13.5,8.5 8.5,13.5 1,6" {...base} />
        <Polyline points="17,18 23,18 23,12" {...base} />
      </Svg>
    );
    case 'home': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path {...base} d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        <Polyline points="9,22 9,12 15,12 15,22" {...base} />
      </Svg>
    );
    case 'health': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path {...base} d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
      </Svg>
    );
    case 'food': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path {...base} d="M18 8h1a4 4 0 0 1 0 8h-1" />
        <Path {...base} d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
        <Line x1="6" y1="1" x2="6" y2="4" stroke={color} strokeWidth={sw} strokeLinecap={lc} />
        <Line x1="10" y1="1" x2="10" y2="4" stroke={color} strokeWidth={sw} strokeLinecap={lc} />
        <Line x1="14" y1="1" x2="14" y2="4" stroke={color} strokeWidth={sw} strokeLinecap={lc} />
      </Svg>
    );
    case 'transport': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path {...base} d="M5 17H3a2 2 0 0 1-2-2V9l2.5-6h15L21 9v6a2 2 0 0 1-2 2h-2" />
        <Circle cx="7.5" cy="17.5" r="2.5" stroke={color} strokeWidth={sw} fill="none" />
        <Circle cx="16.5" cy="17.5" r="2.5" stroke={color} strokeWidth={sw} fill="none" />
      </Svg>
    );
    case 'shopping': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path {...base} d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <Line x1="3" y1="6" x2="21" y2="6" stroke={color} strokeWidth={sw} strokeLinecap={lc} />
        <Path {...base} d="M16 10a4 4 0 0 1-8 0" />
      </Svg>
    );
    case 'entertainment': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="10" stroke={color} strokeWidth={sw} fill="none" />
        <Polyline points="10,8 16,12 10,16 10,8" {...base} />
      </Svg>
    );
    case 'trending_up': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Polyline points="23,6 13.5,15.5 8.5,10.5 1,18" {...base} />
        <Polyline points="17,6 23,6 23,12" {...base} />
      </Svg>
    );
    case 'bills': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path {...base} d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <Polyline points="14,2 14,8 20,8" {...base} />
        <Line x1="9" y1="13" x2="15" y2="13" stroke={color} strokeWidth={sw} strokeLinecap={lc} />
        <Line x1="9" y1="17" x2="15" y2="17" stroke={color} strokeWidth={sw} strokeLinecap={lc} />
      </Svg>
    );
    case 'savings': return (
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={sw} fill="none" />
        <Path d="M12 7v10M9 11l3-3 3 3" {...base} />
      </Svg>
    );
    default: return ( // tip — zap bolt
      <Svg width={18} height={18} viewBox="0 0 24 24">
        <Path {...base} d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </Svg>
    );
  }
}

function SavingsIcon({ color }: { color: string }) {
  const sw = 1.8;
  const lc = 'round' as const;
  const lj = 'round' as const;
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={sw} fill="none" />
      <Path d="M12 7v10M9 11l3-3 3 3"
        stroke={color} strokeWidth={sw} strokeLinecap={lc} strokeLinejoin={lj} fill="none" />
    </Svg>
  );
}

// ── Chart Insight component (mini-insight below charts) ──
function ChartInsight({ text, tone }: { text: string; tone: string }) {
  const color = tone === 'amber' ? t.amber : tone === 'rose' ? t.auraRose : tone === 'aqua' ? t.auraAqua : tone === 'violet' ? t.auraViolet : t.auraBlue;
  return (
    <View style={[s.chartInsight, { borderTopColor: t.glassLine }]}>
      <View style={[s.chartInsightBadge, { backgroundColor: color + '2E' }]}>
        <Orb size={16} rings={false} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[s.chartInsightLabel, { color }]}>FINNI INSIGHT</Text>
        <Text style={s.chartInsightText}>{text}</Text>
      </View>
    </View>
  );
}


// ── GChip ──
function GChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[s.chip, active && s.chipActive]}
    >
      <Text allowFontScaling={false} style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Bar component with glow ──
function Bar({ pct, color, height = 6 }: { pct: number; color: string; height?: number; delay?: number }) {
  return (
    <View style={[s.barTrack, { height }]}>
      <View
        style={[
          s.barFill,
          {
            width: `${Math.min(100, pct)}%`,
            height,
            backgroundColor: color,
            shadowColor: color,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.85,
            shadowRadius: 6,
            elevation: 6,
          },
        ]}
      />
    </View>
  );
}

// ══════════════ MAIN SCREEN ══════════════
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
  const [customRange, setCustomRange] = useState<DateRange | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedInsight, setSelectedInsight] = useState<{
    title: string; body: string; color: string; iconKey: string; insType: string; potentialSavings?: string;
  } | null>(null);
  const [insightFeedback, setInsightFeedback] = useState<Record<string, 'like' | 'dislike' | 'report'>>({});
  const [refreshedToday, setRefreshedToday] = useState(false);
  const syncAttemptedRef = useRef(false);

  const USER_PROMPT_KEY = user?.id ? `insights_user_prompt_${user.id}` : null;
  const USER_PROMPT_MAX = 250;
  const REFRESH_DATE_KEY = user?.id ? `insights_manual_refresh_date_${user.id}` : null;

  useEffect(() => {
    if (!USER_PROMPT_KEY) return;
    AsyncStorage.getItem(USER_PROMPT_KEY).then((val) => {
      if (val) { setUserInsightPrompt(val); setPromptDraft(val); }
    });
  }, [USER_PROMPT_KEY]);

  useEffect(() => {
    if (!REFRESH_DATE_KEY) return;
    const tz = getCalendars()[0]?.timeZone ?? 'UTC';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    AsyncStorage.getItem(REFRESH_DATE_KEY).then((val) => setRefreshedToday(val === today));
  }, [REFRESH_DATE_KEY]);

  // Load persisted feedback so icons reflect prior ratings after reload
  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from('insight_feedback')
      .select('insight_title, feedback_type')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, 'like' | 'dislike' | 'report'> = {};
        data.forEach((r) => { map[r.insight_title] = r.feedback_type as 'like' | 'dislike' | 'report'; });
        setInsightFeedback(map);
      });
  }, [user?.id]);

  const saveUserPrompt = async () => {
    if (!USER_PROMPT_KEY) return;
    const trimmed = promptDraft.trim();
    setUserInsightPrompt(trimmed);
    if (trimmed) await AsyncStorage.setItem(USER_PROMPT_KEY, trimmed);
    else await AsyncStorage.removeItem(USER_PROMPT_KEY);
    setShowPromptEditor(false);
  };

  const submitFeedback = useCallback(async (insightTitle: string, feedbackType: 'like' | 'dislike' | 'report') => {
    if (!user?.id) return;
    setInsightFeedback((prev) => ({ ...prev, [insightTitle]: feedbackType }));
    await supabase.from('insight_feedback').upsert(
      { user_id: user.id, insight_title: insightTitle, feedback_type: feedbackType },
      { onConflict: 'user_id,insight_title' }
    );
  }, [user?.id]);

  const fetchAndCacheInsights = useCallback(async (isManual = false) => {
    if (!user?.id) return;
    const tz = getCalendars()[0]?.timeZone ?? 'UTC';
    const localDate = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const cacheKey = analyticsCacheKey(user.id, localDate);

    // Daily rate limit on manual refreshes
    if (isManual && REFRESH_DATE_KEY) {
      const lastDate = await AsyncStorage.getItem(REFRESH_DATE_KEY);
      if (lastDate === localDate) {
        setInsightsError("You've already refreshed today. Come back tomorrow for fresh insights!");
        setTimeout(() => setInsightsError(''), 4000);
        return;
      }
    }

    setInsightsLoading(true);
    setInsightsError('');

    try {
      await clearAgentCache(user.id);
      const now = new Date();
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 89);
      const monthTx = transactions
        .filter((tx) => new Date(tx.date) >= ninetyDaysAgo)
        .map((tx) => ({ ...tx, category: tx.category ?? null }));

      // Fetch feedback to personalise prompt — no RAG needed, plain context injection
      const { data: feedbackRows } = await supabase
        .from('insight_feedback')
        .select('insight_title, feedback_type')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(15);

      const liked = (feedbackRows ?? []).filter((r) => r.feedback_type === 'like').map((r) => r.insight_title);
      const disliked = (feedbackRows ?? []).filter((r) => r.feedback_type === 'dislike').map((r) => r.insight_title);
      const feedbackCtx = [
        liked.length ? `User previously found these useful: ${liked.join('; ')}.` : '',
        disliked.length ? `User found these unhelpful — avoid similar topics: ${disliked.join('; ')}.` : '',
      ].filter(Boolean).join(' ');

      const combinedPrompt = [userInsightPrompt, feedbackCtx].filter(Boolean).join(' ');

      const [freshInsights, freshSavings] = await Promise.all([
        getDailyInsights(user.id, monthTx, combinedPrompt || undefined),
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

      if (isManual && REFRESH_DATE_KEY) {
        await AsyncStorage.setItem(REFRESH_DATE_KEY, localDate);
        setRefreshedToday(true);
      }

      await AsyncStorage.setItem(
        cacheKey,
        JSON.stringify({ insights: insightsList, savings: savingsList, updatedAt: updatedAt.toISOString() })
      );
    } catch (e) {
      if (__DEV__) console.error('[Analytics] Insights error:', e);
      captureError(e, { context: 'fetchInsights' });
      setInsightsError('Failed to load insights. Tap Refresh to try again.');
      setShowRefreshButton(true);
    } finally {
      setInsightsLoading(false);
    }
  }, [user?.id, transactions, userInsightPrompt, REFRESH_DATE_KEY]);

  const syncInsights = useCallback(async () => {
    if (!user?.id || transactions.length < 1) return;
    const tz = getCalendars()[0]?.timeZone ?? 'UTC';
    const localDate = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const cacheKey = analyticsCacheKey(user.id, localDate);

    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      const { insights: ci, savings: cs, updatedAt } = JSON.parse(cached);
      setInsights(ci ?? []);
      setSavingsRecs(cs ?? []);
      setLastUpdated(updatedAt ? new Date(updatedAt) : null);
      setShowRefreshButton(false);
      return;
    }

    const hasTodayTx = transactions.some(
      (tx) => new Date(tx.date).toLocaleDateString('en-CA', { timeZone: tz }) === localDate
    );
    if (hasTodayTx) { await fetchAndCacheInsights(); return; }

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
    if (!user?.id) { setLoading(false); setTransactions([]); return; }
    setLoading(true);
    syncAttemptedRef.current = false;

    const [txRes, catRes, incomeRes] = await Promise.all([
      supabase.from('transactions').select('*').eq('user_id', user.id).order('date', { ascending: false }),
      supabase.from('categories').select('id, name, emoji, budget').eq('user_id', user.id),
      supabase.from('income').select('amount, frequency').eq('user_id', user.id),
    ]);

    setLoading(false);
    if (txRes.error) { setTransactions([]); }
    else { setTransactions((txRes.data as Transaction[]) ?? []); }
    if (!catRes.error) setCategories(catRes.data ?? []);
    if (!incomeRes.error) {
      const total = (incomeRes.data ?? []).reduce((sum, r) => {
        const amt = Number(r.amount) || 0;
        if (r.frequency === 'weekly') return sum + amt * (52 / 12);
        if (r.frequency === 'annual') return sum + amt / 12;
        return sum + amt;
      }, 0);
      setMonthlyIncome(total);
    }
  }, [user?.id]);

  useFocusEffect(useCallback(() => { fetchAll(); trackScreen('AnalyticsScreen'); }, [fetchAll]));

  useEffect(() => {
    if (transactions.length >= 1 && user?.id && !syncAttemptedRef.current) {
      syncAttemptedRef.current = true;
      syncInsights();
    }
  }, [transactions.length, user?.id, syncInsights]);

  const periodStart = useMemo(() => getPeriodStart(period), [period]);

  const filteredTransactions = useMemo(() => {
    if (period === 'custom' && customRange) {
      const s = new Date(customRange.start);
      const e = new Date(customRange.end); e.setHours(23, 59, 59, 999);
      return transactions.filter((tx) => { const d = new Date(tx.date); return d >= s && d <= e; });
    }
    return transactions.filter((tx) => new Date(tx.date) >= periodStart);
  }, [transactions, periodStart, period, customRange]);

  const { totalSpent, totalIncome, byCategory, trendData } = useMemo(() => {
    let spent = 0;
    let income = 0;
    const categoryMap: Record<string, number> = {};
    const monthMap: Record<string, number> = {};

    for (const tx of filteredTransactions) {
      if (tx.type === 'expense') {
        const w = Number(tx.withdrawal) || 0;
        spent += w;
        const catObj = categories.find((c) => c.id === tx.category_id);
        const cat = catObj?.name ?? 'Uncategorized';
        categoryMap[cat] = (categoryMap[cat] ?? 0) + w;
        const d = new Date(tx.date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthMap[key] = (monthMap[key] ?? 0) + w;
      } else {
        income += Number(tx.deposit) || 0;
      }
    }

    const byCategory: CategoryTotal[] = Object.entries(categoryMap)
      .map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount);

    const now = new Date();
    const trendData = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      trendData.push({
        label: d.toLocaleDateString('en-US', { month: 'short' }),
        value: monthMap[key] ?? 0,
        isCurrent: i === 0,
      });
    }

    return { totalSpent: spent, totalIncome: income, byCategory, trendData };
  }, [filteredTransactions, categories]);

  // Compute donut data with percentages
  const donutData = useMemo(() => {
    const prepared = prepareChartData(byCategory);
    return prepared.map((cat) => ({
      name: cat.name,
      pct: totalSpent > 0 ? Math.round((cat.amount / totalSpent) * 100) : 0,
      amt: cat.amount,
      color: getCatColor(cat.name),
    }));
  }, [byCategory, totalSpent]);

  // Compute trend change %
  const trendChange = useMemo(() => {
    if (trendData.length < 2) return null;
    const current = trendData[trendData.length - 1].value;
    const prev = trendData[trendData.length - 2].value;
    if (prev === 0) return null;
    return ((current - prev) / prev * 100).toFixed(1);
  }, [trendData]);

  // Generate chart insights from data
  const chartInsights = useMemo(() => {
    const distribution = donutData.length > 0
      ? { tone: 'amber', text: `${donutData[0].name} is your biggest category at ${donutData[0].pct}% (${currencySymbol}${donutData[0].amt.toFixed(0)}). ${donutData.length > 1 ? `${donutData[1].name} follows at ${donutData[1].pct}%.` : ''}` }
      : null;

    const trend = trendChange
      ? { tone: Number(trendChange) > 0 ? 'rose' : 'aqua', text: `Spending ${Number(trendChange) > 0 ? 'climbed' : 'dropped'} ${Math.abs(Number(trendChange))}% compared to last month.` }
      : null;

    const topCat = byCategory[0];
    const catObj = topCat ? categories.find((c) => c.name === topCat.name) : null;
    const budget = catObj?.budget ?? 0;
    let category = null;
    if (topCat) {
      if (budget > 0) {
        const overBudget = topCat.amount > budget;
        const remaining = budget - topCat.amount;
        const pct = (topCat.amount / budget * 100).toFixed(0);
        category = {
          tone: overBudget ? 'rose' : 'aqua',
          text: `${topCat.name} is at ${pct}% of its ${currencySymbol}${budget.toFixed(0)} budget${overBudget ? ` — over by ${currencySymbol}${(topCat.amount - budget).toFixed(0)}!` : `. ${currencySymbol}${remaining.toFixed(0)} to spare.`}`,
        };
      } else {
        const topPct = totalSpent > 0 ? Math.round(topCat.amount / totalSpent * 100) : 0;
        const second = byCategory[1];
        const secondPct = second && totalSpent > 0 ? Math.round(second.amount / totalSpent * 100) : null;
        const secondText = second && secondPct ? ` ${second.name} follows at ${secondPct}%.` : '';
        category = {
          tone: 'amber',
          text: `${topCat.name} leads at ${topPct}% of spending (${currencySymbol}${topCat.amount.toFixed(0)}).${secondText}`,
        };
      }
    }

    return { distribution, trend, category };
  }, [donutData, trendChange, byCategory, categories, currencySymbol]);

  const customChipLabel = customRange
    ? `${fmtShort(customRange.start)} – ${fmtShort(customRange.end)}`
    : '📅 Custom';

  const donutCenterSub = (() => {
    if (period === 'custom' && customRange) return `${fmtShort(customRange.start)} – ${fmtShort(customRange.end)}`;
    if (period === 'week') return 'this week';
    if (period === '3months') return 'last 3 months';
    if (period === 'year') return 'this year';
    return 'this month';
  })();

  const periodChips: { key: PeriodOption; label: string }[] = [
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
    { key: '3months', label: '3 Months' },
    { key: 'year', label: 'This Year' },
  ];

  if (loading) {
    return (
      <View style={s.loadingWrap}>
        <Aurora width={SCREEN_WIDTH} height={SCREEN_HEIGHT} />
        <ActivityIndicator size="large" color={t.auraAqua} />
        <Text style={s.loadingText}>Loading insights...</Text>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Aurora width={SCREEN_WIDTH} height={SCREEN_HEIGHT} />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Text style={s.title}>Insights</Text>
        <Text style={s.subtitle}>How your money flows</Text>

        {/* Period chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={s.chipsRow}
          contentContainerStyle={{ gap: 8 }}
        >
          {periodChips.map((chip) => (
            <GChip
              key={chip.key}
              label={chip.label}
              active={period === chip.key}
              onPress={() => setPeriod(chip.key)}
            />
          ))}
          <GChip
            label={customChipLabel}
            active={period === 'custom'}
            onPress={() => setShowDatePicker(true)}
          />
        </ScrollView>

        {/* ── AI Insights (TOP) ── */}
        <View style={s.insightsHeader}>
          <Orb size={26} rings={false} />
          <Text style={s.insightsTitle}>Finni noticed</Text>
          <View style={{ flex: 1 }} />
          {lastUpdated && (
            <View style={s.updatedBadge}>
              <View style={s.updatedDot} />
              <Text style={s.updatedText}>Updated today</Text>
            </View>
          )}
        </View>

        {transactions.length < 1 ? (
          <GlassCard style={s.insightCard}>
            <Text style={[s.insightTitle, { color: t.auraAqua }]}>Building your insights...</Text>
            <Text style={s.insightBody}>
              Add your first transaction and Finni will start analyzing your spending patterns.
            </Text>
          </GlassCard>
        ) : insightsLoading && insights.length === 0 ? (
          <GlassCard style={s.insightCard}>
            <ActivityIndicator size="small" color={t.auraAqua} />
            <Text style={[s.insightBody, { marginTop: 8 }]}>Analyzing your spending...</Text>
          </GlassCard>
        ) : (
          <>
            {insights.map((ins, i) => {
              const insType = ins.type ?? 'tip';
              const color = INSIGHT_TONE[insType] ?? t.auraAqua;
              const title = ins.title || ins.summary || 'Insight';
              const body = ins.description || ins.suggestion || ins.topCategory || '';
              const iconKey = resolveInsightIcon(title, body, insType);
              const fb = insightFeedback[title];
              return (
                <TouchableOpacity
                  key={i}
                  activeOpacity={0.85}
                  onPress={() => setSelectedInsight({ title, body, color, iconKey, insType })}
                >
                  <GlassCard style={s.insightCard}>
                    <View style={s.insightStrip}>
                      <View style={[s.insightStripBar, { backgroundColor: color }]} />
                    </View>
                    <View style={s.insightIconRow}>
                      <View style={[s.insightIconBadge, { backgroundColor: color + '2E' }]}>
                        <InsightIcon iconKey={iconKey} color={color} />
                      </View>
                      <Text style={[s.insightTitle, { color }]}>{title}</Text>
                    </View>
                    <Text style={s.insightBody} numberOfLines={3} ellipsizeMode="tail">{body}</Text>
                    <View style={s.feedbackRow}>
                      {(['like', 'dislike', 'report'] as const).map((type) => (
                        <TouchableOpacity
                          key={type}
                          style={[s.feedbackBtn, fb === type && { backgroundColor: color + '30' }]}
                          onPress={(e) => { e.stopPropagation?.(); submitFeedback(title, type); }}
                          activeOpacity={0.7}
                        >
                          <Text style={[s.feedbackBtnText, fb === type && { color }]}>
                            {type === 'like' ? '👍' : type === 'dislike' ? '👎' : '🚩'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                      <Text style={s.tapHint}>Tap to read more</Text>
                    </View>
                  </GlassCard>
                </TouchableOpacity>
              );
            })}
            {savingsRecs.map((rec, i) => {
              const fb = insightFeedback[rec.title];
              return (
                <TouchableOpacity
                  key={`sav-${i}`}
                  activeOpacity={0.85}
                  onPress={() => setSelectedInsight({ title: rec.title, body: rec.description, color: t.auraBlue, iconKey: 'savings', insType: 'tip', potentialSavings: rec.potentialSavings })}
                >
                  <GlassCard style={s.insightCard}>
                    <View style={s.insightStrip}>
                      <View style={[s.insightStripBar, { backgroundColor: t.auraBlue }]} />
                    </View>
                    <View style={s.insightIconRow}>
                      <View style={[s.insightIconBadge, { backgroundColor: t.auraBlue + '2E' }]}>
                        <SavingsIcon color={t.auraBlue} />
                      </View>
                      <Text style={[s.insightTitle, { color: t.auraBlue }]}>{rec.title}</Text>
                    </View>
                    <Text style={s.insightBody} numberOfLines={3} ellipsizeMode="tail">{rec.description}</Text>
                    <View style={s.feedbackRow}>
                      {(['like', 'dislike', 'report'] as const).map((type) => (
                        <TouchableOpacity
                          key={type}
                          style={[s.feedbackBtn, fb === type && { backgroundColor: t.auraBlue + '30' }]}
                          onPress={(e) => { e.stopPropagation?.(); submitFeedback(rec.title, type); }}
                          activeOpacity={0.7}
                        >
                          <Text style={[s.feedbackBtnText, fb === type && { color: t.auraBlue }]}>
                            {type === 'like' ? '👍' : type === 'dislike' ? '👎' : '🚩'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                      <Text style={s.tapHint}>Tap to read more</Text>
                    </View>
                  </GlassCard>
                </TouchableOpacity>
              );
            })}
          </>
        )}

        {/* Refresh / Customize row */}
        {transactions.length >= 1 && (
          <View style={s.actionRow}>
            <TouchableOpacity
              style={s.ghostBtn}
              onPress={() => { setPromptDraft(userInsightPrompt); setShowPromptEditor((v) => !v); }}
              activeOpacity={0.8}
            >
              <Text style={s.ghostBtnText}>✏️ Customize</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.ghostBtn, (insightsLoading || refreshCooldown || refreshedToday) && { opacity: 0.5 }]}
              onPress={() => fetchAndCacheInsights(true)}
              disabled={insightsLoading || refreshCooldown || refreshedToday}
              activeOpacity={0.8}
            >
              {insightsLoading ? (
                <ActivityIndicator size="small" color={t.auraAqua} />
              ) : (
                <Text style={s.ghostBtnText}>
                  {refreshedToday ? '✓ Refreshed today' : refreshCooldown ? 'Wait 5 min...' : '↻ Refresh'}
                </Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        {/* Prompt editor */}
        {showPromptEditor && (
          <GlassCard style={s.promptCard}>
            <Text style={s.promptLabel}>
              Add custom instructions for your insights (e.g. "Focus on food spending")
            </Text>
            <TextInput
              style={s.promptInput}
              value={promptDraft}
              onChangeText={(v) => setPromptDraft(v.slice(0, USER_PROMPT_MAX))}
              placeholder="e.g. Focus on food and transport..."
              placeholderTextColor={t.text3}
              multiline
              maxLength={USER_PROMPT_MAX}
            />
            <View style={s.promptActions}>
              <Text style={s.promptCount}>{promptDraft.length}/{USER_PROMPT_MAX}</Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={() => setShowPromptEditor(false)} style={s.promptCancelBtn}>
                  <Text style={s.promptCancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={saveUserPrompt} style={s.promptSaveBtn}>
                  <Text style={s.promptSaveText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </GlassCard>
        )}

        {insightsError ? <Text style={s.errorText}>{insightsError}</Text> : null}

        {/* ── Spending Distribution — glowing donut ── */}
        {byCategory.length >= 2 && (
          <GlassCard style={s.chartCard}>
            <Text style={s.eyebrow}>Spending Distribution</Text>
            <View style={s.donutWrap}>
              <GlowDonut
                data={donutData}
                size={180}
                centerLabel={`${currencySymbol}${totalSpent.toFixed(0)}`}
                centerSub={donutCenterSub}
              />
            </View>
            {/* Legend */}
            <View style={s.legendGrid}>
              {donutData.map((c) => (
                <View key={c.name} style={s.legendItem}>
                  <View style={[s.legendDot, { backgroundColor: c.color }]} />
                  <Text style={s.legendPct}>{c.pct}%</Text>
                  <Text style={s.legendName} numberOfLines={1}>{c.name}</Text>
                </View>
              ))}
            </View>
            {chartInsights.distribution && (
              <ChartInsight text={chartInsights.distribution.text} tone={chartInsights.distribution.tone} />
            )}
          </GlassCard>
        )}

        {/* ── Monthly Trend — area chart ── */}
        <GlassCard style={s.chartCard}>
          <View style={s.trendHeader}>
            <Text style={s.eyebrow}>Monthly Trend</Text>
            {trendChange && (
              <Text style={[s.trendChange, { color: Number(trendChange) > 0 ? t.auraRose : t.auraAqua }]}>
                {Number(trendChange) > 0 ? '↑' : '↓'} {Number(trendChange) > 0 ? '+' : ''}{trendChange}%
              </Text>
            )}
          </View>
          <TrendArea data={trendData} width={SCREEN_WIDTH - 84} height={110} />
          {chartInsights.trend && (
            <ChartInsight text={chartInsights.trend.text} tone={chartInsights.trend.tone} />
          )}
        </GlassCard>

        {/* ── Totals ── */}
        <View style={s.totalsRow}>
          <GlassCard style={s.totalCard}>
            <Text allowFontScaling={false} style={s.eyebrow}>Total Spent</Text>
            <Text allowFontScaling={false} style={[s.totalValue, { color: t.auraRose }]}>
              {currencySymbol}{totalSpent.toFixed(0)}
            </Text>
          </GlassCard>
          <GlassCard style={s.totalCard}>
            <Text allowFontScaling={false} style={s.eyebrow}>Income</Text>
            <Text allowFontScaling={false} style={[s.totalValue, { color: t.auraAqua }]}>
              {currencySymbol}{(monthlyIncome || totalIncome).toFixed(0)}
            </Text>
          </GlassCard>
        </View>

        {/* ── By Category ── */}
        <Text style={s.sectionTitle}>By category</Text>
        <GlassCard style={s.catListCard}>
          {byCategory.length === 0 ? (
            <Text style={s.emptyText}>No spending data yet for this period.</Text>
          ) : (
            byCategory.map((cat, i) => {
              const catObj = categories.find((c) => c.name === cat.name);
              const budget = catObj?.budget ?? 0;
              const hasBudget = budget > 0;
              const pct = hasBudget
                ? Math.min(100, (cat.amount / budget) * 100)
                : totalSpent > 0 ? (cat.amount / totalSpent) * 100 : 0;
              const color = getCatColor(cat.name);
              return (
                <View
                  key={cat.name}
                  style={[
                    s.catRow,
                    i < byCategory.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.glassLine },
                  ]}
                >
                  <CatIconComponent name={cat.name} size={38} radius={12} />
                  <View style={s.catInfo}>
                    <Text allowFontScaling={false} style={s.catName}>{cat.name}</Text>
                    <View style={{ marginTop: 8 }}>
                      <Bar pct={Math.min(100, pct * 2.2)} color={color} height={5} />
                    </View>
                  </View>
                  <Text allowFontScaling={false} style={s.catAmount}>{currencySymbol}{cat.amount.toFixed(0)}</Text>
                </View>
              );
            })
          )}
          {chartInsights.category && (
            <ChartInsight text={chartInsights.category.text} tone={chartInsights.category.tone} />
          )}
        </GlassCard>

        {/* Footer */}
        <Text style={s.footnote}>
          AI-generated insights are for informational purposes only and do not constitute financial advice.
        </Text>
      </ScrollView>

      <DateRangePicker
        visible={showDatePicker}
        value={customRange}
        onApply={(range) => {
          setCustomRange(range);
          setPeriod('custom');
          setShowDatePicker(false);
        }}
        onClose={() => setShowDatePicker(false)}
      />

      {/* Insight detail bottom sheet */}
      <Modal
        visible={selectedInsight !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedInsight(null)}
      >
        <TouchableOpacity
          style={s.sheetOverlay}
          activeOpacity={1}
          onPress={() => setSelectedInsight(null)}
        />
        {selectedInsight && (
          <View style={s.sheetContainer}>
            <View style={s.sheetHandle} />
            <View style={[s.sheetIconRow]}>
              <View style={[s.insightIconBadge, { backgroundColor: selectedInsight.color + '22' }]}>
                <InsightIcon iconKey={selectedInsight.iconKey} color={selectedInsight.color} />
              </View>
              <Text style={[s.sheetTitle, { color: selectedInsight.color }]} numberOfLines={2}>
                {selectedInsight.title}
              </Text>
            </View>
            <ScrollView style={s.sheetScroll} showsVerticalScrollIndicator={false}>
              <Text style={s.sheetBody}>{selectedInsight.body}</Text>
              {selectedInsight.potentialSavings ? (
                <Text style={s.sheetSavings}>Potential savings: {selectedInsight.potentialSavings}</Text>
              ) : null}
            </ScrollView>
            <View style={s.sheetFeedbackRow}>
              {(['like', 'dislike', 'report'] as const).map((type) => {
                const fb = insightFeedback[selectedInsight.title];
                const icons = { like: '👍', dislike: '👎', report: '🚩' };
                return (
                  <TouchableOpacity
                    key={type}
                    style={[s.sheetFeedbackBtn, fb === type && { backgroundColor: selectedInsight.color + '25' }]}
                    onPress={() => submitFeedback(selectedInsight.title, type)}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.sheetFeedbackText, fb === type && { color: selectedInsight.color }]}>
                      {icons[type]}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              <TouchableOpacity style={s.sheetCloseBtn} onPress={() => setSelectedInsight(null)} activeOpacity={0.8}>
                <Text style={s.sheetCloseBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

// ══════════════ STYLES ══════════════
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.auraBg,
  },
  loadingWrap: {
    flex: 1,
    backgroundColor: t.auraBg,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 16,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: fonts.medium,
    color: t.text3,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 62,
    paddingHorizontal: 22,
    paddingBottom: 120,
  },
  title: {
    fontSize: 30,
    fontFamily: fonts.extraBold,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.6,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: fonts.regular,
    color: t.text2,
    marginTop: 4,
    lineHeight: 23,
  },
  chipsRow: {
    marginTop: 18,
    maxHeight: 44,
  },

  // ── Chips ──
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: t.rPill,
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.glassLine,
  },
  chipActive: {
    backgroundColor: t.auraIndigo,
    borderColor: 'transparent',
  },
  chipText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text2,
  },
  chipTextActive: {
    color: '#fff',
    fontWeight: '700',
  },

  // ── Insights section ──
  insightsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 22,
    marginBottom: 12,
  },
  insightsTitle: {
    fontSize: 17,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text,
    letterSpacing: -0.3,
  },
  updatedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  updatedDot: {
    width: 6,
    height: 6,
    borderRadius: 99,
    backgroundColor: t.green,
  },
  updatedText: {
    fontSize: 11.5,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text3,
  },

  // ── Insight cards ──
  insightCard: {
    padding: 16,
    marginBottom: 12,
    overflow: 'hidden',
  },
  insightStrip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: 3,
  },
  insightStripBar: {
    flex: 1,
    width: 3,
  },
  insightIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  insightIconBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightTitle: {
    flex: 1,
    fontSize: 15.5,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
  },
  insightBody: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: t.text2,
    lineHeight: 21.5,
  },
  insightCTA: {
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  insightCTAText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
  },
  potentialSavings: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.green,
    marginTop: 4,
  },

  // ── Action row ──
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  ghostBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: t.rSm,
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.glassLine,
  },
  ghostBtnText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text2,
  },

  // ── Prompt editor ──
  promptCard: {
    padding: 14,
    marginBottom: 12,
  },
  promptLabel: {
    fontSize: 12,
    fontFamily: fonts.regular,
    color: t.text3,
    marginBottom: 8,
    lineHeight: 18,
  },
  promptInput: {
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.glassLine,
    borderRadius: t.rSm,
    padding: 10,
    fontSize: 14,
    fontFamily: fonts.regular,
    color: t.text,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  promptActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  promptCount: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: t.text3,
  },
  promptCancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: t.glassLine,
  },
  promptCancelText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text2,
  },
  promptSaveBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: t.auraIndigo,
  },
  promptSaveText: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: '#fff',
  },
  errorText: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: t.red,
    marginBottom: 10,
  },

  // ── Chart cards ──
  chartCard: {
    padding: 22,
    marginTop: 16,
  },
  eyebrow: {
    fontSize: 11,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: t.text3,
  },
  donutWrap: {
    alignItems: 'center',
    marginVertical: 18,
  },
  legendGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 11,
    marginTop: 14,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    width: '46%',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 4,
  },
  legendPct: {
    fontSize: 13,
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: t.text,
  },
  legendName: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: t.text2,
    flex: 1,
  },

  // ── Trend ──
  trendHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  trendChange: {
    fontSize: 13,
    fontFamily: fonts.bold,
    fontWeight: '700',
  },

  // ── Totals ──
  totalsRow: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 16,
  },
  totalCard: {
    flex: 1,
    padding: 18,
  },
  totalValue: {
    fontSize: 22,
    fontFamily: fonts.extraBold,
    fontWeight: '800',
    marginTop: 9,
  },

  // ── Category list ──
  sectionTitle: {
    fontSize: 17,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text,
    marginTop: 26,
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  catListCard: {
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 18,
  },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 13,
  },
  catInfo: {
    flex: 1,
    minWidth: 0,
  },
  catName: {
    fontSize: 14.5,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text,
  },
  catAmount: {
    fontSize: 14.5,
    fontFamily: fonts.bold,
    fontWeight: '700',
    color: t.text,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: fonts.regular,
    color: t.text3,
    textAlign: 'center',
    paddingVertical: 20,
  },

  // ── Bar ──
  barTrack: {
    borderRadius: 99,
    backgroundColor: t.surface3,
  },
  barFill: {
    borderRadius: 99,
  },

  // ── Chart insight ──
  chartInsight: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: t.glassLine,
  },
  chartInsightBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartInsightLabel: {
    fontSize: 10.5,
    fontFamily: fonts.bold,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  chartInsightText: {
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: t.text2,
    lineHeight: 20,
  },

  // ── Footer ──
  footnote: {
    fontSize: 10,
    fontFamily: fonts.regular,
    color: t.text4,
    textAlign: 'center',
    marginTop: 16,
    paddingHorizontal: 8,
    lineHeight: 14,
  },

  // ── Insight card feedback row ──
  feedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    gap: 6,
  },
  feedbackBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  feedbackBtnText: {
    fontSize: 15,
    color: t.text3,
  },
  tapHint: {
    flex: 1,
    fontSize: 11,
    fontFamily: fonts.regular,
    color: t.text4,
    textAlign: 'right',
  },

  // ── Insight detail bottom sheet ──
  sheetOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheetContainer: {
    backgroundColor: '#12152A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 12,
    paddingHorizontal: 22,
    paddingBottom: 36,
    maxHeight: '75%',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    borderRadius: 99,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignSelf: 'center',
    marginBottom: 18,
  },
  sheetIconRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  sheetTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    lineHeight: 24,
  },
  sheetScroll: {
    maxHeight: 300,
  },
  sheetBody: {
    fontSize: 15,
    fontFamily: fonts.regular,
    color: t.text2,
    lineHeight: 23,
  },
  sheetSavings: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.green,
    marginTop: 12,
  },
  sheetFeedbackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 20,
    gap: 8,
  },
  sheetFeedbackBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  sheetFeedbackText: {
    fontSize: 18,
    color: t.text3,
  },
  sheetCloseBtn: {
    flex: 1,
    alignItems: 'flex-end',
  },
  sheetCloseBtnText: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    fontWeight: '600',
    color: t.text3,
  },
});
