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
import Svg, { Path } from 'react-native-svg';
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

const CATEGORY_EMOJI: Record<string, string> = {
  food: '🍔', transport: '🚗', shopping: '🛒', entertainment: '🎬',
  bills: '📄', groceries: '🛒', dining: '🍽️', coffee: '☕',
  travel: '✈️', health: '💊', default: '💰',
};

function getCategoryEmoji(category: string | null): string {
  if (!category) return CATEGORY_EMOJI.default;
  return CATEGORY_EMOJI[category.toLowerCase().replace(/\s+/g, '')] ?? CATEGORY_EMOJI.default;
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
type DateRange = { start: string; end: string };

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

const INSIGHT_ICON: Record<string, string> = {
  warning: 'alert',
  tip: 'wallet',
  goal: 'target',
  income_alert: 'alert',
};

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

// ── DateRangePicker ──
const MONTHS_LIST = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function fmtShort(iso: string) {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS_LIST[m - 1].slice(0, 3)} ${d}`;
}

function DateRangePicker({ visible, value, onApply, onClose }: {
  visible: boolean; value: DateRange | null;
  onApply: (r: DateRange) => void; onClose: () => void;
}) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);

  useEffect(() => {
    if (visible) { setStart(value?.start ?? null); setEnd(value?.end ?? null); }
  }, [visible]);

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMo = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMo; d++) cells.push(d);

  const shiftMonth = (n: number) => {
    let m = viewMonth + n, y = viewYear;
    if (m < 0) { m = 11; y--; } if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  };
  const pickDay = (iso: string) => {
    if (!start || (start && end)) { setStart(iso); setEnd(null); }
    else if (iso < start) { setEnd(start); setStart(iso); }
    else setEnd(iso);
  };
  const applyPreset = (days: number) => {
    const e = new Date(); const s = new Date(); s.setDate(s.getDate() - (days - 1));
    setStart(isoDate(s.getFullYear(), s.getMonth(), s.getDate()));
    setEnd(isoDate(e.getFullYear(), e.getMonth(), e.getDate()));
  };
  const inRange = (iso: string) => !!(start && end && iso > start && iso < end);
  const rangeLabel = !start ? 'Select a range' : !end ? fmtShort(start) : `${fmtShort(start)} – ${fmtShort(end)}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={dr.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={dr.sheet} onPress={() => {}}>
          <View style={dr.handle} />
          <View style={dr.header}>
            <Text style={dr.title}>Custom range</Text>
            <Text style={[dr.rangeLabel, { color: start ? t.auraAqua : t.text3 }]}>{rangeLabel}</Text>
          </View>
          <View style={dr.presets}>
            {[{ label: 'Last 7 days', days: 7 }, { label: 'Last 30 days', days: 30 }, { label: 'Last 90 days', days: 90 }].map(p => (
              <TouchableOpacity key={p.days} style={dr.presetChip} onPress={() => applyPreset(p.days)} activeOpacity={0.8}>
                <Text style={dr.presetText}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={dr.calHeader}>
            <TouchableOpacity style={dr.navBtn} onPress={() => shiftMonth(-1)} activeOpacity={0.7}>
              <Text style={dr.navArrow}>‹</Text>
            </TouchableOpacity>
            <Text style={dr.monthLabel}>{MONTHS_LIST[viewMonth]} {viewYear}</Text>
            <TouchableOpacity style={dr.navBtn} onPress={() => shiftMonth(1)} activeOpacity={0.7}>
              <Text style={dr.navArrow}>›</Text>
            </TouchableOpacity>
          </View>
          <View style={dr.dowRow}>
            {DOW_LABELS.map((d, i) => <Text key={i} style={dr.dowLabel}>{d}</Text>)}
          </View>
          <View style={dr.calGrid}>
            {cells.map((d, i) => {
              if (!d) return <View key={i} style={dr.dayCell} />;
              const iso = isoDate(viewYear, viewMonth, d);
              const edge = iso === start || iso === end;
              const mid = inRange(iso);
              return (
                <TouchableOpacity key={i} style={[dr.dayCell, edge && dr.dayCellEdge, mid && dr.dayCellMid]} onPress={() => pickDay(iso)} activeOpacity={0.75}>
                  <Text style={[dr.dayText, edge && dr.dayTextEdge]}>{d}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={dr.actions}>
            <TouchableOpacity style={dr.clearBtn} onPress={() => { setStart(null); setEnd(null); }} activeOpacity={0.8}>
              <Text style={dr.clearText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[dr.applyBtn, !start && { opacity: 0.45 }]} onPress={() => start && onApply({ start, end: end ?? start })} disabled={!start} activeOpacity={0.8}>
              <Text style={dr.applyText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}
const CELL_W: `${number}%` = '14.2857%';
const dr = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(2,3,8,0.72)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: 'rgba(14,12,26,0.97)', borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: t.glassLine2, padding: 20, paddingBottom: 40 },
  handle: { width: 40, height: 5, borderRadius: 99, backgroundColor: t.glassLine2, alignSelf: 'center', marginBottom: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 17, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text },
  rangeLabel: { fontSize: 13, fontFamily: fonts.bold, fontWeight: '700' },
  presets: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 18 },
  presetChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: t.rPill, backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine },
  presetText: { fontSize: 13, fontFamily: fonts.medium, color: t.text2 },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  navBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine },
  navArrow: { fontSize: 22, color: t.text2, lineHeight: 28, fontFamily: fonts.regular },
  monthLabel: { fontSize: 15, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text },
  dowRow: { flexDirection: 'row', marginBottom: 4 },
  dowLabel: { width: CELL_W, textAlign: 'center', fontSize: 11, fontFamily: fonts.bold, fontWeight: '700', color: t.text3, paddingVertical: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: CELL_W, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  dayCellEdge: { backgroundColor: t.auraAqua, borderRadius: 10 },
  dayCellMid: { backgroundColor: t.auraAqua + '28', borderRadius: 0 },
  dayText: { fontSize: 13.5, fontFamily: fonts.medium, color: t.text },
  dayTextEdge: { fontFamily: fonts.bold, fontWeight: '700', color: '#0b0a1a' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  clearBtn: { flex: 1, paddingVertical: 14, borderRadius: t.rMd, alignItems: 'center', backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine },
  clearText: { fontSize: 15, fontFamily: fonts.bold, fontWeight: '700', color: t.text2 },
  applyBtn: { flex: 1.5, paddingVertical: 14, borderRadius: t.rMd, alignItems: 'center', backgroundColor: t.auraIndigo },
  applyText: { fontSize: 15, fontFamily: fonts.bold, fontWeight: '700', color: '#fff' },
});

// ── GChip ──
function GChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.8}
      style={[s.chip, active && s.chipActive]}
    >
      <Text style={[s.chipText, active && s.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── Bar component ──
function Bar({ pct, color, height = 5, delay = 0 }: { pct: number; color: string; height?: number; delay?: number }) {
  return (
    <View style={[s.barTrack, { height }]}>
      <View
        style={[
          s.barFill,
          {
            width: `${Math.min(100, pct)}%`,
            height,
            backgroundColor: color,
          },
        ]}
      />
    </View>
  );
}

// ── CatIcon ──
function CatIcon({ name, size = 36, radius = 11 }: { name: string; size?: number; radius?: number }) {
  const color = getCatColor(name);
  const emoji = getCategoryEmoji(name);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: color + '28',
        borderWidth: 1,
        borderColor: color + '45',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: size * 0.44 }}>{emoji}</Text>
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
        .filter((tx) => new Date(tx.date) >= startOfMonth)
        .map((tx) => ({ ...tx, category: tx.category ?? null }));

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
      if (__DEV__) console.error('[Analytics] Insights error:', e);
      captureError(e, { context: 'fetchInsights' });
      setInsightsError('Failed to load insights. Tap Refresh to try again.');
      setShowRefreshButton(true);
    } finally {
      setInsightsLoading(false);
    }
  }, [user?.id, transactions, userInsightPrompt]);

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
    if (transactions.length >= 10 && user?.id && !syncAttemptedRef.current) {
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
    const category = topCat && budget > 0
      ? { tone: topCat.amount > budget ? 'rose' : 'aqua', text: `${topCat.name} is at ${currencySymbol}${topCat.amount.toFixed(0)} of ${currencySymbol}${budget.toFixed(0)} budget${topCat.amount > budget ? ' — over budget!' : '.'}` }
      : null;

    return { distribution, trend, category };
  }, [donutData, trendChange, byCategory, categories, currencySymbol]);

  const customChipLabel = customRange
    ? `${fmtShort(customRange.start)} – ${fmtShort(customRange.end)}`
    : 'Custom';

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

        {transactions.length < 10 ? (
          <GlassCard style={s.insightCard}>
            <Text style={[s.insightTitle, { color: t.auraAqua }]}>Building your insights...</Text>
            <Text style={s.insightBody}>
              Finni needs at least 10 transactions to generate personalized insights. You have {transactions.length} so far — keep logging!
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
              return (
                <GlassCard key={i} style={s.insightCard}>
                  <View style={s.insightStrip}>
                    <View style={[s.insightStripBar, { backgroundColor: color }]} />
                  </View>
                  <View style={s.insightIconRow}>
                    <View style={[s.insightIconBadge, { backgroundColor: color + '2E' }]}>
                      <Orb size={17} rings={false} />
                    </View>
                    <Text style={[s.insightTitle, { color }]}>{title}</Text>
                  </View>
                  <Text style={s.insightBody}>{body}</Text>
                  {insType === 'income_alert' && (
                    <TouchableOpacity
                      style={[s.insightCTA, { borderColor: color }]}
                      onPress={() => navigation.navigate('Settings' as never)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.insightCTAText, { color }]}>Add income sources →</Text>
                    </TouchableOpacity>
                  )}
                </GlassCard>
              );
            })}
            {savingsRecs.map((rec, i) => (
              <GlassCard key={`sav-${i}`} style={s.insightCard}>
                <View style={s.insightStrip}>
                  <View style={[s.insightStripBar, { backgroundColor: t.auraBlue }]} />
                </View>
                <View style={s.insightIconRow}>
                  <View style={[s.insightIconBadge, { backgroundColor: t.auraBlue + '2E' }]}>
                    <Orb size={17} rings={false} />
                  </View>
                  <Text style={[s.insightTitle, { color: t.auraBlue }]}>💰 {rec.title}</Text>
                </View>
                <Text style={s.insightBody}>{rec.description}</Text>
                {rec.potentialSavings && (
                  <Text style={s.potentialSavings}>{rec.potentialSavings}</Text>
                )}
              </GlassCard>
            ))}
          </>
        )}

        {/* Refresh / Customize row */}
        {transactions.length >= 10 && (
          <View style={s.actionRow}>
            <TouchableOpacity
              style={s.ghostBtn}
              onPress={() => { setPromptDraft(userInsightPrompt); setShowPromptEditor((v) => !v); }}
              activeOpacity={0.8}
            >
              <Text style={s.ghostBtnText}>✏️ Customize</Text>
            </TouchableOpacity>
            {showRefreshButton && (
              <TouchableOpacity
                style={[s.ghostBtn, (insightsLoading || refreshCooldown) && { opacity: 0.5 }]}
                onPress={fetchAndCacheInsights}
                disabled={insightsLoading || refreshCooldown}
                activeOpacity={0.8}
              >
                {insightsLoading ? (
                  <ActivityIndicator size="small" color={t.auraAqua} />
                ) : (
                  <Text style={s.ghostBtnText}>{refreshCooldown ? 'Wait 5 min' : '↻ Refresh'}</Text>
                )}
              </TouchableOpacity>
            )}
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
                centerSub="this month"
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
            <Text style={s.eyebrow}>Total Spent</Text>
            <Text style={[s.totalValue, { color: t.auraRose }]}>
              {currencySymbol}{totalSpent.toFixed(0)}
            </Text>
          </GlassCard>
          <GlassCard style={s.totalCard}>
            <Text style={s.eyebrow}>Income</Text>
            <Text style={[s.totalValue, { color: t.auraAqua }]}>
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
                  <CatIcon name={cat.name} size={36} radius={11} />
                  <View style={s.catInfo}>
                    <Text style={s.catName}>{cat.name}</Text>
                    <View style={{ marginTop: 8 }}>
                      <Bar pct={Math.min(100, pct * 2.2)} color={color} height={5} />
                    </View>
                  </View>
                  <Text style={s.catAmount}>{currencySymbol}{cat.amount.toFixed(0)}</Text>
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
    overflow: 'hidden',
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
});
