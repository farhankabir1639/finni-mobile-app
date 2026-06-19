import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Pressable, KeyboardAvoidingView, Platform, Modal, Alert,
  Linking, Animated, useWindowDimensions, Keyboard, AppState,
} from 'react-native';
// expo-audio is loaded lazily inside recording functions so a native-module
// failure on certain devices doesn't crash the entire app on startup.
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path, Circle as SvgCircle } from 'react-native-svg';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { supabase } from '../lib/supabase';
import { chatAgent, transcribeAudio, AiCapError } from '../lib/agents';
import type { ParsedTransaction, CategoryProposal } from '../lib/agents';
import { addPendingProposals, resolvePendingProposals } from '../lib/categoryProposals';
import { materializeDueRecurring } from '../lib/recurring';
import { getPendingCount } from '../lib/emailCapture';
import { EMAIL_CAPTURE_ENABLED } from '../lib/featureFlags';
import { seedDefaultCategories } from '../lib/seedCategories';
import { captureError } from '../lib/sentry';
import { trackEvent, trackScreen } from '../lib/analytics';
import {
  loadTodaySession, saveSession, loadAllSessions, formatSessionDate,
  formatMessageTime, todayDateStr, type SessionMessage, type ChatSession,
} from '../lib/chatSessions';
import Aurora from '../components/Aurora';
import Orb from '../components/Orb';
import ArcMeter from '../components/ArcMeter';
import GlassCard from '../components/GlassCard';
import TransactionCard from '../components/TransactionCard';
import CategoryProposalCard from '../components/CategoryProposalCard';
import FinniInsightCard from '../components/FinniInsightCard';
import ReviewModal from '../components/ReviewModal';
import type { InsightContext } from '../lib/insights';
import { t, fonts } from '../theme/tokens';

// ── Types ─────────────────────────────────────────────────────────────────────
type Message = { id: string; role: 'user' | 'assistant'; content: string; timestamp?: string; transaction?: ParsedTransaction; transactions?: ParsedTransaction[]; categoryProposals?: CategoryProposal[] };

// ── Helpers ───────────────────────────────────────────────────────────────────
function getGreetingBase(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}
function getFirstName(n: string | null | undefined): string | null {
  if (!n?.trim()) return null;
  return n.trim().split(/\s+/)[0] ?? null;
}
function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}
function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function fmtRecTime(s: number): string {
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const QUICK_CHIPS = [
  "💰 How's my budget?",
  '📊 Show spending',
  '💡 Save money tips',
  '📝 Log expense',
];

// ── SVG Icons ─────────────────────────────────────────────────────────────────
const InboxIcon = ({ color = t.text2 }: { color?: string }) => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Path d="M22 12h-6l-2 3h-4l-2-3H2" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const ClockIcon = ({ color = t.text2 }: { color?: string }) => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <SvgCircle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
    <Path d="M12 7v5l3 3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);
const MicIcon = ({ color = t.text2 }: { color?: string }) => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" stroke={color} strokeWidth="1.7" />
    <Path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
  </Svg>
);
const SendIcon = ({ active }: { active: boolean }) => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
    <Path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" stroke={active ? t.auraBg : t.text3} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const ThumbUpIcon  = ({ active }: { active: boolean }) => (
  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
    <Path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" stroke={active ? t.green : t.text3} strokeWidth="1.7" strokeLinecap="round" />
    <Path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3" stroke={active ? t.green : t.text3} strokeWidth="1.7" strokeLinecap="round" />
  </Svg>
);
const ThumbDownIcon = ({ active }: { active: boolean }) => (
  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
    <Path d="M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3H10z" stroke={active ? t.red : t.text3} strokeWidth="1.7" strokeLinecap="round" />
    <Path d="M17 2h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17" stroke={active ? t.red : t.text3} strokeWidth="1.7" strokeLinecap="round" />
  </Svg>
);
const RetryIcon = () => (
  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
    <Path d="M3 2v6h6M21 12A9 9 0 0 0 6 5.3L3 8M21 22v-6h-6M3 12a9 9 0 0 0 15 6.7l3-2.7" stroke={t.text3} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);
const FlagIcon = () => (
  <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
    <Path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7" stroke={t.text3} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// ── AI Action Row ─────────────────────────────────────────────────────────────
function AIActionRow({ msg, onRegenerate, onReport }: {
  msg: Message; onRegenerate: () => void; onReport: () => void;
}) {
  const [thumbed, setThumbed] = useState<'up' | 'down' | null>(null);
  return (
    <View style={aiStyles.row}>
      <TouchableOpacity style={aiStyles.btn} hitSlop={8} activeOpacity={0.7}
        onPress={() => { setThumbed('up'); trackEvent('ai_thumbs_up', { msgId: msg.id }); }}>
        <ThumbUpIcon active={thumbed === 'up'} />
      </TouchableOpacity>
      <TouchableOpacity style={aiStyles.btn} hitSlop={8} activeOpacity={0.7}
        onPress={() => { setThumbed('down'); trackEvent('ai_thumbs_down', { msgId: msg.id }); }}>
        <ThumbDownIcon active={thumbed === 'down'} />
      </TouchableOpacity>
      <TouchableOpacity style={aiStyles.btn} hitSlop={8} activeOpacity={0.7}
        onPress={() => { onRegenerate(); trackEvent('ai_regenerate', { msgId: msg.id }); }}>
        <RetryIcon />
      </TouchableOpacity>
      <TouchableOpacity style={aiStyles.btn} hitSlop={8} activeOpacity={0.7} onPress={onReport}>
        <FlagIcon />
      </TouchableOpacity>
    </View>
  );
}
const aiStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 6, marginLeft: 2 },
  btn: { padding: 4 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
// GlassDock: inner paddingVertical(10*2=20) + active tab (54px pill + 4*2 padding = 62px) = 82px
const DOCK_CONTENT_H = 82;

export default function HomeScreen() {
  const navigation = useNavigation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { currencySymbol } = useProfile();

  const [firstName, setFirstName]         = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [messages, setMessages]           = useState<Message[]>([]);
  const [inputText, setInputText]         = useState('');
  const [isTyping, setIsTyping]           = useState(false);
  const [typingDots, setTypingDots]       = useState('.');
  const [monthUsedPct, setMonthUsedPct]   = useState(0);
  const [budgetLeft, setBudgetLeft]       = useState(0);
  const [monthlyBudget, setMonthlyBudget] = useState(0);
  const [monthSpent, setMonthSpent]       = useState(0);
  const [chatContext, setChatContext]     = useState<{
    profile?: { name?: string; currency?: string } | null;
    categories?: { id: string; name: string; emoji?: string; budget?: number; spent?: number }[] | null;
    recentTransactions?: { withdrawal?: number; deposit?: number; description: string | null; category_id?: string | null; date: string; type?: string }[] | null;
    goals?: { name: string; target_amount?: number; current_amount?: number }[] | null;
  }>({});
  const [showHistory, setShowHistory]           = useState(false);
  const [historySessions, setHistorySessions]   = useState<ChatSession[]>([]);
  const [activeSessionDate, setActiveSessionDate] = useState<string | null>(null);
  const [isRecording, setIsRecording]           = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [reviewVisible, setReviewVisible]       = useState(false);
  const [pendingCount, setPendingCount]         = useState(0);

  const scrollRef         = useRef<ScrollView>(null);
  const welcomeAddedRef   = useRef(false);
  const isSendingRef      = useRef(false);
  const isFetchingCtxRef  = useRef(false);
  const recordingTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRecorderRef  = useRef<any>(null);
  const waveAnims         = useRef([...Array(5)].map(() => new Animated.Value(0.4))).current;
  const waveLoopsRef      = useRef<Animated.CompositeAnimation[]>([]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const today           = new Date();
  const monthElapsedPct = Math.round((today.getDate() / daysInMonth(today)) * 100);
  const monthName       = today.toLocaleString('en-US', { month: 'long' });
  const onTrack         = monthUsedPct <= monthElapsedPct;
  const paceDelta       = monthUsedPct - monthElapsedPct; // <0 = ahead of pace (good)
  const paceLabel       = monthlyBudget <= 0
    ? (onTrack ? 'On track' : 'Over pace')
    : Math.abs(paceDelta) <= 1 ? 'Right on pace'
    : paceDelta < 0 ? `${Math.abs(paceDelta)}% under pace`
    : `${paceDelta}% over pace`;
  const greeting        = firstName ? `${getGreetingBase()}, ${firstName}` : getGreetingBase();

  const finnisNoticed = useMemo(() => {
    const cats = chatContext.categories;
    if (!cats?.length) return null;
    const top = cats
      .filter(c => c.budget && c.budget > 0 && c.spent && c.spent > 0)
      .map(c => ({ ...c, ratio: (c.spent ?? 0) / c.budget! }))
      .sort((a, b) => b.ratio - a.ratio)[0];
    if (!top || top.ratio < 0.7) return null;
    const pct = Math.round(top.ratio * 100);
    if (pct >= 100) return `${top.emoji ?? ''} ${top.name} exceeded budget this month`.trim();
    return `${top.emoji ?? ''} ${top.name} is at ${pct}% of budget this month`.trim();
  }, [chatContext.categories]);

  // Context the grounded insights pipeline reasons over (data we already hold).
  const insightCtx = useMemo<InsightContext | null>(() => {
    if (!user?.id) return null;
    return {
      userId: user.id,
      region: null, // TODO: wire onboarding city once it's on the profile row
      currency: chatContext.profile?.currency ?? 'USD',
      currencySymbol,
      monthlyIncome: monthlyBudget,
      monthSpent,
      monthElapsedPct,
      monthName,
      categories: chatContext.categories ?? [],
      goals: chatContext.goals ?? [],
      transactionCount: chatContext.recentTransactions?.length ?? 0,
    };
  }, [user?.id, chatContext, currencySymbol, monthlyBudget, monthSpent, monthElapsedPct, monthName]);

  // ── Waveform ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isRecording) {
      const peaks     = [0.9, 0.5, 1.0, 0.6, 0.8];
      const troughs   = [0.25, 0.35, 0.2, 0.3, 0.35];
      const durations = [280, 350, 220, 310, 260];
      waveLoopsRef.current = waveAnims.map((anim, i) =>
        Animated.loop(Animated.sequence([
          Animated.timing(anim, { toValue: peaks[i],   duration: durations[i],      useNativeDriver: true }),
          Animated.timing(anim, { toValue: troughs[i], duration: durations[i] + 40, useNativeDriver: true }),
        ]))
      );
      waveLoopsRef.current.forEach((loop, i) => setTimeout(() => loop.start(), i * 55));
    } else {
      waveLoopsRef.current.forEach(l => l.stop());
      waveAnims.forEach(a => a.setValue(0.4));
    }
    return () => waveLoopsRef.current.forEach(l => l.stop());
  }, [isRecording]);

  // Cleanup recording resources on unmount
  useEffect(() => {
    return () => {
      if (recordingTimer.current) { clearInterval(recordingTimer.current); recordingTimer.current = null; }
      audioRecorderRef.current?.stop?.().catch(() => {});
      audioRecorderRef.current?.release?.();
      audioRecorderRef.current = null;
    };
  }, []);

  const startRecording = async () => {
    try {
      // Lazy-load expo-audio so a native-module failure on this device doesn't
      // crash the app on startup — only the mic button is affected.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { AudioModule, RecordingPresets, setAudioModeAsync, requestRecordingPermissionsAsync } = require('expo-audio') as typeof import('expo-audio');
      // createRecordingOptions flattens the platform-specific sub-object (android/ios/web)
      // into a single object the native AudioRecorder constructor expects.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createRecordingOptions } = require('expo-audio/build/utils/options') as { createRecordingOptions: (o: any) => any };

      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone Access', 'Please allow microphone access in Settings to use voice input.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });

      // Release any previous recorder before creating a new one
      audioRecorderRef.current?.release?.();
      const recorder = new AudioModule.AudioRecorder(createRecordingOptions(RecordingPresets.HIGH_QUALITY));
      audioRecorderRef.current = recorder;

      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimer.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
      trackEvent('voice_input_started');
    } catch (e) {
      audioRecorderRef.current?.release?.();
      audioRecorderRef.current = null;
      try { const { setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio'); await setAudioModeAsync({ allowsRecording: false }); } catch {}
      if (__DEV__) console.error('[Voice] Start recording error:', e);
      captureError(e, { context: 'startRecording' });
      Alert.alert('Error', 'Could not start recording. Please try again.');
    }
  };

  const cancelRecording = async () => {
    setIsRecording(false);
    setRecordingSeconds(0);
    if (recordingTimer.current) { clearInterval(recordingTimer.current); recordingTimer.current = null; }
    try { await audioRecorderRef.current?.stop(); } catch {}
    audioRecorderRef.current?.release?.();
    audioRecorderRef.current = null;
    try { const { setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio'); await setAudioModeAsync({ allowsRecording: false }); } catch {}
  };

  const stopRecording = async () => {
    if (!isRecording) { cancelRecording(); return; }
    setIsRecording(false);
    if (recordingTimer.current) { clearInterval(recordingTimer.current); recordingTimer.current = null; }

    try {
      const recorder = audioRecorderRef.current;
      if (!recorder) { Alert.alert('Error', 'No active recording.'); return; }
      await recorder.stop();
      const uri = recorder.uri;
      audioRecorderRef.current?.release?.();
      audioRecorderRef.current = null;
      try { const { setAudioModeAsync } = require('expo-audio') as typeof import('expo-audio'); await setAudioModeAsync({ allowsRecording: false }); } catch {}

      if (!uri) { Alert.alert('Error', 'No audio recorded.'); return; }

      // Read audio as base64 via fetch + FileReader (no expo-file-system needed)
      const response = await fetch(uri);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          resolve(dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      if (!base64 || base64.length < 100) {
        Alert.alert('Too Short', 'Recording was too short. Please try again.');
        return;
      }

      setIsTyping(true);
      const transcribed = await transcribeAudio(base64, 'audio/mp4');
      setIsTyping(false);

      if (!transcribed.trim()) {
        Alert.alert('Could Not Transcribe', "I couldn't understand the audio. Please try again or type your message.");
        return;
      }

      trackEvent('voice_input_transcribed', { length: transcribed.length });
      if (!isSendingRef.current) {
        handleSend(transcribed);
      } else {
        setInputText(transcribed);
      }
    } catch (e) {
      setIsTyping(false);
      if (__DEV__) console.error('[Voice] Transcription error:', e);
      captureError(e, { context: 'stopRecording' });
      Alert.alert('Error', 'Could not process voice message. Please try typing instead.');
    }
  };

  // ── Data fetching ──────────────────────────────────────────────────────────
  const fetchChatContext = useCallback(async () => {
    if (!user?.id || isFetchingCtxRef.current) return;
    isFetchingCtxRef.current = true;
    try {
      const [pr, cr, tr, gr] = await Promise.all([
        supabase.from('profiles').select('name, currency').eq('id', user.id).maybeSingle(),
        supabase.from('categories').select('id, name, emoji, budget, spent').eq('user_id', user.id),
        supabase.from('transactions').select('withdrawal, deposit, description, category_id, date, type').eq('user_id', user.id).order('date', { ascending: false }).limit(10),
        supabase.from('financial_goals').select('name, target_amount, current_amount').eq('user_id', user.id),
      ]);
      // Each query is independent and the UI degrades gracefully (empty section),
      // so a single transient failure is a warning, not an error-level event.
      if (pr.error) captureError(pr.error, { context: 'fetchCtx.profile' }, 'warning');
      if (cr.error) captureError(cr.error, { context: 'fetchCtx.categories' }, 'warning');
      if (tr.error) captureError(tr.error, { context: 'fetchCtx.transactions' }, 'warning');
      if (gr.error) captureError(gr.error, { context: 'fetchCtx.goals' }, 'warning');
      setChatContext({
        profile: pr.data ? { name: pr.data.name, currency: pr.data.currency } : null,
        categories: (cr.data as { id: string; name: string; emoji?: string; budget?: number; spent?: number }[]) ?? [],
        recentTransactions: (tr.data as { withdrawal?: number; deposit?: number; description: string | null; category_id?: string | null; date: string; type?: string }[]) ?? [],
        goals: (gr.data as { name: string; target_amount?: number; current_amount?: number }[]) ?? [],
      });
    } catch (e) {
      captureError(e, { context: 'fetchChatContext' });
      setChatContext({});
    } finally { isFetchingCtxRef.current = false; }
  }, [user?.id]);

  useFocusEffect(React.useCallback(() => {
    fetchChatContext();
    if (EMAIL_CAPTURE_ENABLED && user?.id) getPendingCount(user.id).then(setPendingCount);
    // Leaving the chat tab = session end: auto-create any category proposals the
    // user never responded to, then their transactions get re-tagged.
    return () => { if (user?.id) resolvePendingProposals(user.id); };
  }, [fetchChatContext, user?.id]));

  // Backgrounding the app also ends the session → resolve pending proposals.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if ((state === 'background' || state === 'inactive') && user?.id) {
        resolvePendingProposals(user.id);
      }
    });
    return () => sub.remove();
  }, [user?.id]);

  // On launch, auto-create any proposals left pending from a prior session that
  // ended without the handlers firing (e.g. the app was force-killed).
  useEffect(() => {
    if (user?.id) resolvePendingProposals(user.id).then((n) => { if (n) fetchChatContext(); });
  }, [user?.id]);

  // On launch, materialize any recurring transactions due since last open
  // (once-per-day guarded inside the engine). Refresh stats if any were created.
  useEffect(() => {
    if (user?.id) materializeDueRecurring(user.id).then((n) => { if (n) { fetchStats(); fetchChatContext(); } });
  }, [user?.id]);

  const fetchStats = useCallback(async () => {
    if (!user?.id) return;
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const [{ data: txData }, { data: incomeData }] = await Promise.all([
        supabase.from('transactions').select('withdrawal, type').eq('user_id', user.id).gte('date', monthStart),
        supabase.from('income').select('amount, frequency').eq('user_id', user.id),
      ]);
      let monthTotal = 0;
      (txData ?? []).forEach(tx => { if (tx.type === 'expense') monthTotal += Number(tx.withdrawal) || 0; });
      const monthlyIncome = (incomeData ?? []).reduce((sum, r) => {
        const a = Number(r.amount) || 0;
        if (r.frequency === 'weekly') return sum + a * (52 / 12);
        if (r.frequency === 'annual') return sum + a / 12;
        return sum + a;
      }, 0);
      setMonthUsedPct(monthlyIncome > 0 ? Math.min(100, Math.round((monthTotal / monthlyIncome) * 100)) : 0);
      setBudgetLeft(Math.max(0, monthlyIncome - monthTotal));
      setMonthlyBudget(monthlyIncome);
      setMonthSpent(monthTotal);
    } catch (e) { captureError(e, { context: 'fetchStats' }); }
  }, [user?.id]);

  useFocusEffect(React.useCallback(() => { fetchStats(); trackScreen('HomeScreen'); }, [fetchStats]));

  // ── Profile / welcome ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) { setProfileLoaded(true); return; }
    (async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('name').eq('id', user.id).maybeSingle();
        if (error?.code === 'PGRST116') {
          const name = user.email?.split('@')[0] ?? 'User';
          await supabase.from('profiles').upsert({ id: user.id, name });
          await seedDefaultCategories(user.id);
          setFirstName(getFirstName(name));
        } else {
          setFirstName(getFirstName(data?.name));
        }
      } catch { setFirstName(null); }
      finally { setProfileLoaded(true); }
    })();
  }, [user?.id]);

  useEffect(() => {
    if (!welcomeAddedRef.current && profileLoaded && user?.id) {
      welcomeAddedRef.current = true;
      const name = firstName ?? 'there';
      loadTodaySession(user.id).then(saved => {
        if (saved?.length) setMessages(saved as Message[]);
        else setMessages([{ id: 'welcome', role: 'assistant', content: `Hi ${name}! 👋 I'm Finni. Ask me anything about your finances or just say 'spent $X on Y' to log expenses` }]);
      });
    }
  }, [profileLoaded, firstName, user?.id]);

  useEffect(() => { scrollRef.current?.scrollToEnd({ animated: true }); }, [messages, isTyping]);

  useEffect(() => {
    if (!isTyping) return;
    const id = setInterval(() => setTypingDots(d => d.length >= 3 ? '.' : d + '.'), 400);
    return () => clearInterval(id);
  }, [isTyping]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSend = async (text: string) => {
    const trimmed = text.trim().replace(/[\x00-\x1F\x7F]/g, '');
    if (!trimmed || !user?.id || isSendingRef.current) return;
    isSendingRef.current = true;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: trimmed, timestamp: new Date().toISOString() };
    setMessages(m => [...m, userMsg]);
    setInputText('');
    setIsTyping(true);
    const sessionDate = activeSessionDate ?? undefined;
    try {
      const { response, transaction, transactions, categoryProposals } = await chatAgent(trimmed, user.id, [...messages, userMsg], chatContext, sessionDate);
      setIsTyping(false);
      const txList = (transactions ?? (transaction ? [transaction] : [])).filter(Boolean) as ParsedTransaction[];
      // Persist any new-category proposals so they auto-create at session end if
      // the user doesn't respond to the prompt.
      if (categoryProposals?.length) addPendingProposals(user.id, categoryProposals);
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: response, timestamp: new Date().toISOString(), transaction: transaction ?? undefined, transactions: txList.length ? txList : undefined, categoryProposals: categoryProposals?.length ? categoryProposals : undefined };
      const updated = [...messages, userMsg, aiMsg];
      setMessages(updated);
      saveSession(user.id, updated as SessionMessage[], sessionDate);
      if (transaction) { fetchStats(); fetchChatContext(); trackEvent('transaction_logged', { category: transaction.category }); }
      trackEvent('chat_message_sent');
    } catch (e) {
      setIsTyping(false);
      // Monthly AI-action cap reached → restore the draft, drop the echoed
      // message, and surface the paywall instead of an error bubble.
      if (e instanceof AiCapError) {
        setInputText(trimmed);
        setMessages(m => m.filter(x => x.id !== userMsg.id));
        trackEvent('ai_cap_reached', { plan: e.plan, limit: e.actionLimit });
        (navigation as any).navigate('Paywall');
        return;
      }
      captureError(e, { context: 'handleSend', userId: user?.id });
      setInputText(trimmed);
      setMessages(m => [...m, { id: (Date.now() + 1).toString(), role: 'assistant', content: "I'm having trouble connecting. Please try again 🔄" }]);
    } finally { isSendingRef.current = false; }
  };

  const handleRegenerate = useCallback(async (assistantMsg: Message) => {
    if (!user?.id || isSendingRef.current) return;
    isSendingRef.current = true;
    const idx = messages.findIndex(m => m.id === assistantMsg.id);
    const prev = [...messages.slice(0, idx)].reverse().find(m => m.role === 'user');
    if (!prev) { isSendingRef.current = false; return; }
    const without = messages.filter(m => m.id !== assistantMsg.id);
    setMessages(without);
    setIsTyping(true);
    try {
      const { response } = await chatAgent(prev.content, user.id, without, chatContext, activeSessionDate ?? undefined);
      const newAi: Message = { id: Date.now().toString(), role: 'assistant', content: response, timestamp: new Date().toISOString() };
      const updated = [...without, newAi];
      setMessages(updated);
      saveSession(user.id, updated as SessionMessage[], activeSessionDate ?? undefined);
    } catch (e) {
      if (e instanceof AiCapError) { (navigation as any).navigate('Paywall'); }
      else captureError(e, { context: 'handleRegenerate', userId: user.id });
    }
    finally { setIsTyping(false); isSendingRef.current = false; }
  }, [messages, user?.id, chatContext, activeSessionDate]);

  const handleReportMessage = (msg: Message) => {
    Alert.alert('Report AI Response', 'Flag this response as inappropriate, inaccurate, or offensive.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', style: 'destructive', onPress: () => {
        const sub  = encodeURIComponent('Finni AI Response Report');
        const body = encodeURIComponent(`I'd like to report:\n\n"${msg.content}"\n\nReason: [Please describe]\n\nTimestamp: ${msg.timestamp ?? 'N/A'}`);
        Linking.openURL(`mailto:support@heyfinni.com?subject=${sub}&body=${body}`);
        Alert.alert('Thank you', 'Your report helps us improve Finni.');
      }},
    ]);
  };

  const handleChipPress = (chip: string) => handleSend(chip.replace(/^[^\s]+\s/, '').trim());

  const openHistory = async () => {
    if (!user?.id) return;
    setHistorySessions(await loadAllSessions(user.id));
    setShowHistory(true);
  };

  const loadHistorySession = (session: ChatSession) => {
    setMessages(session.messages as Message[]);
    setActiveSessionDate(session.date);
    setShowHistory(false);
    welcomeAddedRef.current = true;
  };

  const returnToToday = async () => {
    setActiveSessionDate(null);
    welcomeAddedRef.current = true;
    if (!user?.id) return;
    const saved = await loadTodaySession(user.id);
    setMessages(saved?.length ? (saved as Message[]) : [{ id: 'welcome', role: 'assistant', content: `Hi ${firstName ?? 'there'}! 👋 I'm Finni. Ask me anything or say 'spent $X on Y' to log expenses` }]);
  };

  const isConversationEmpty = messages.length <= 1;
  const busy = isTyping;

  // Guard: user becomes null the moment signOut() fires. The navigator will
  // switch to the auth stack on the next tick, but React renders synchronously
  // first — returning null prevents any user!.id access from crashing.
  if (!user) return null;

  // ── Composer pieces ────────────────────────────────────────────────────────
  const composerInner = (
    <>
      <TextInput
        style={[styles.composerInput, { fontFamily: fonts.regular }]}
        placeholder="Message Finni…"
        placeholderTextColor={t.text3}
        value={inputText}
        onChangeText={setInputText}
        onSubmitEditing={() => handleSend(inputText)}
        multiline
        maxLength={500}
        editable={!busy}
      />
      <TouchableOpacity style={styles.composerBtn} onPress={startRecording} disabled={busy} activeOpacity={0.7}>
        <MicIcon color={busy ? t.text3 : t.text2} />
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.sendBtn, (!inputText.trim() || busy) ? styles.sendBtnOff : styles.sendBtnOn]}
        onPress={() => handleSend(inputText)}
        disabled={!inputText.trim() || busy}
        activeOpacity={0.8}
      >
        <SendIcon active={!!(inputText.trim() && !busy)} />
      </TouchableOpacity>
    </>
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={styles.outer}>
      <Aurora width={width} height={height} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <KeyboardAvoidingView
          style={styles.kav}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
          {/* ── TOP SECTION ── */}
          <Pressable style={styles.topSection} onPress={Keyboard.dismiss}>
            {/* Header row */}
            <View style={styles.headerRow}>
              <View>
                <Text style={[styles.greetingText, { fontFamily: fonts.bold }]}>{greeting}</Text>
                <Text style={[styles.dateText, { fontFamily: fonts.regular }]}>{formatDate(today)}</Text>
              </View>
              <View style={styles.headerActions}>
                {EMAIL_CAPTURE_ENABLED ? (
                  <Pressable style={styles.historyBtn} onPress={() => setReviewVisible(true)} hitSlop={12}>
                    <InboxIcon />
                    {pendingCount > 0 ? (
                      <View style={styles.inboxBadge}>
                        <Text style={styles.inboxBadgeTxt}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                ) : null}
                <Pressable style={styles.historyBtn} onPress={openHistory} hitSlop={12}>
                  <ClockIcon />
                </Pressable>
              </View>
            </View>


            {/* Session banner */}
            {activeSessionDate ? (
              <View style={styles.sessionBanner}>
                <Text style={[styles.sessionBannerTxt, { fontFamily: fonts.semiBold }]}>
                  📅 {formatSessionDate(activeSessionDate)}
                </Text>
                <TouchableOpacity onPress={returnToToday} hitSlop={8}>
                  <Text style={[styles.sessionBannerBack, { fontFamily: fonts.medium }]}>Back to Today →</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </Pressable>

          {/* ── CHAT SCROLL ── */}
          <ScrollView
            ref={scrollRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            {/* Hero — lives inside scroll so it naturally slides away as chat grows */}
            <View style={styles.heroSection}>
              <View style={styles.arcSection}>
                <ArcMeter size={244} stroke={13} pct={monthUsedPct} markerPct={monthElapsedPct}>
                  <Orb size={104} rings talking={isTyping} />
                </ArcMeter>

                {monthlyBudget > 0 ? (
                  <>
                    <Text allowFontScaling={false} style={[styles.heroAmount, { fontFamily: fonts.extraBold }]}>
                      {currencySymbol}{budgetLeft.toFixed(0)}
                    </Text>
                    <Text allowFontScaling={false} style={[styles.heroSub, { fontFamily: fonts.medium }]}>
                      left of your {currencySymbol}{monthlyBudget.toFixed(0)} budget
                    </Text>
                  </>
                ) : (
                  <Text allowFontScaling={false} style={[styles.heroSub, { fontFamily: fonts.medium }]}>
                    Add income in Settings to track budget
                  </Text>
                )}

                {monthlyBudget > 0 && (
                  <View style={styles.legendRow}>
                    <LinearGradient
                      colors={[t.auraAqua, '#a5b4fc']}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                      style={styles.legendSwatch}
                    />
                    <Text allowFontScaling={false} style={[styles.legendText, { fontFamily: fonts.medium }]}>{monthUsedPct}% spent</Text>
                    <View style={styles.legendWhiteDot} />
                    <Text allowFontScaling={false} style={[styles.legendText, { fontFamily: fonts.medium }]}>{monthElapsedPct}% of {monthName}</Text>
                  </View>
                )}

                <View style={[styles.pacePill, onTrack ? styles.pacePillGreen : styles.pacePillRed]}>
                  <View style={[styles.paceDot, { backgroundColor: onTrack ? t.green : t.red }]} />
                  <Text allowFontScaling={false} style={[styles.paceText, { fontFamily: fonts.semiBold, color: onTrack ? t.green : t.red }]}>
                    {paceLabel}
                  </Text>
                </View>
              </View>

              <FinniInsightCard
                ctx={insightCtx}
                fallbackText={finnisNoticed}
                onOpen={() => navigation.navigate('Analytics' as never)}
              />
            </View>

            {/* Inline chips — empty state */}
            {isConversationEmpty && (
              <View style={styles.chipsSection}>
                <Text style={[styles.tryAskLabel, { fontFamily: fonts.semiBold }]}>Try asking</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
                  {QUICK_CHIPS.map(chip => (
                    <TouchableOpacity key={chip} style={styles.chip} onPress={() => handleChipPress(chip)} activeOpacity={0.8}>
                      <Text style={[styles.chipText, { fontFamily: fonts.medium }]}>{chip}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}

            {/* Messages */}
            {messages.map(msg =>
              msg.role === 'assistant' ? (
                <View key={msg.id} style={styles.assistantRow}>
                  <View style={styles.orbAvatar}>
                    <Orb size={28} rings={false} />
                  </View>
                  <View style={styles.asMsgCol}>
                    {(() => {
                      // New messages carry `transactions[]`; older persisted ones
                      // carry a single `transaction`. Render one card per item.
                      const cards = (msg.transactions ?? (msg.transaction ? [msg.transaction] : []))
                        .filter(Boolean) as NonNullable<ParsedTransaction>[];
                      return cards.length ? (
                        cards.map((tx, i) => (
                          <View key={`${msg.id}-tx-${i}`} style={i > 0 ? styles.txCardSpacing : undefined}>
                            <TransactionCard
                              userId={user!.id}
                              amount={tx.amount}
                              category={tx.category}
                              type={tx.type}
                              categories={chatContext.categories ?? []}
                              currency={chatContext.profile?.currency ?? 'USD'}
                              description={tx.description}
                              date={tx.date}
                              allowRecurring
                            />
                          </View>
                        ))
                      ) : (
                        <GlassCard style={styles.asBubble} borderRadius={t.rMd} intensity={22}>
                          <Text style={[styles.bubbleText, { fontFamily: fonts.regular }]}>{msg.content}</Text>
                        </GlassCard>
                      );
                    })()}
                    {msg.categoryProposals?.length ? (
                      <View style={styles.txCardSpacing}>
                        <CategoryProposalCard
                          userId={user!.id}
                          proposals={msg.categoryProposals}
                          onResolved={fetchChatContext}
                        />
                      </View>
                    ) : null}
                    {msg.id !== 'welcome' && (
                      <AIActionRow
                        msg={msg}
                        onRegenerate={() => handleRegenerate(msg)}
                        onReport={() => handleReportMessage(msg)}
                      />
                    )}
                    {msg.timestamp ? (
                      <Text style={[styles.msgTime, { fontFamily: fonts.regular }]}>{formatMessageTime(msg.timestamp)}</Text>
                    ) : null}
                  </View>
                </View>
              ) : (
                <View key={msg.id} style={styles.userRow}>
                  <LinearGradient
                    colors={['#4f46e5', '#6366f1']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={styles.userBubble}
                  >
                    <Text style={[styles.bubbleText, { fontFamily: fonts.regular }]}>{msg.content}</Text>
                  </LinearGradient>
                  {msg.timestamp ? (
                    <Text style={[styles.msgTimeRight, { fontFamily: fonts.regular }]}>{formatMessageTime(msg.timestamp)}</Text>
                  ) : null}
                </View>
              )
            )}

            {/* Typing indicator */}
            {isTyping && (
              <View style={styles.assistantRow}>
                <View style={styles.orbAvatar}><Orb size={28} rings={false} /></View>
                <GlassCard style={styles.typingBubble} borderRadius={t.rMd} intensity={22}>
                  <Text style={[styles.typingText, { fontFamily: fonts.bold }]}>{typingDots}</Text>
                </GlassCard>
              </View>
            )}
          </ScrollView>

          {/* ── COMPOSER ── */}
          {isRecording ? (
            <View style={[styles.composerAndroid, styles.voiceBar, { paddingBottom: Math.max(insets.bottom, 8) + DOCK_CONTENT_H }]}>
              <TouchableOpacity style={styles.voiceCancelBtn} onPress={cancelRecording} hitSlop={12}>
                <Text style={[styles.voiceCancelTxt, { fontFamily: fonts.semiBold }]}>✕</Text>
              </TouchableOpacity>
              <View style={styles.waveRow}>
                {waveAnims.map((anim, i) => (
                  <Animated.View key={i} style={[styles.waveBar, { transform: [{ scaleY: anim }] }]} />
                ))}
              </View>
              <Text style={[styles.voiceTimer, { fontFamily: fonts.medium }]}>{fmtRecTime(recordingSeconds)}</Text>
              <TouchableOpacity style={styles.voiceSendBtn} onPress={stopRecording} activeOpacity={0.8}>
                <Text style={[styles.voiceSendTxt, { fontFamily: fonts.bold }]}>Send</Text>
              </TouchableOpacity>
            </View>
          ) : Platform.OS === 'ios' ? (
            <BlurView intensity={22} tint="dark" style={[styles.composerBlur, { paddingBottom: Math.max(insets.bottom, 8) + DOCK_CONTENT_H }]}>
              {composerInner}
            </BlurView>
          ) : (
            <View style={[styles.composerAndroid, { paddingBottom: Math.max(insets.bottom, 8) + DOCK_CONTENT_H }]}>
              {composerInner}
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Review (auto-captured transactions) — gated until email-capture ships */}
      {EMAIL_CAPTURE_ENABLED ? (
        <ReviewModal
          visible={reviewVisible}
          userId={user?.id ?? ''}
          categories={(chatContext.categories ?? []) as { id: string; name: string; emoji?: string }[]}
          currencySymbol={currencySymbol}
          onClose={() => setReviewVisible(false)}
          onChanged={() => { if (user?.id) getPendingCount(user.id).then(setPendingCount); }}
        />
      ) : null}

      {/* History Modal */}
      <Modal visible={showHistory} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowHistory(false)}>
        <SafeAreaView style={styles.historyModal} edges={['top', 'bottom']}>
          <View style={styles.historyHeader}>
            <Text style={[styles.historyTitle, { fontFamily: fonts.bold }]}>Chat History</Text>
            <TouchableOpacity onPress={() => setShowHistory(false)} hitSlop={12}>
              <Text style={styles.historyClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.historySub, { fontFamily: fonts.regular }]}>Review and continue your last 20 days.</Text>
          <ScrollView style={styles.historyScroll} contentContainerStyle={styles.historyContent} showsVerticalScrollIndicator={false}>
            {historySessions.length === 0 ? (
              <Text style={[styles.historyEmpty, { fontFamily: fonts.regular }]}>No past sessions yet. Start chatting and your threads will appear here.</Text>
            ) : historySessions.map(session => (
              <TouchableOpacity
                key={session.id}
                style={[styles.historyItem, session.date === (activeSessionDate ?? todayDateStr()) && styles.historyItemActive]}
                onPress={() => loadHistorySession(session)}
                activeOpacity={0.8}
              >
                <Text style={[styles.historyItemDate, { fontFamily: fonts.semiBold }]}>{formatSessionDate(session.date)}</Text>
                <Text style={[styles.historyItemPreview, { fontFamily: fonts.regular }]} numberOfLines={1}>{session.preview}</Text>
                <Text style={[styles.historyItemMeta, { fontFamily: fonts.regular }]}>{session.messages.length} messages · tap to open</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: t.auraBg },
  safeArea: { flex: 1, backgroundColor: 'transparent' },
  kav: { flex: 1 },

  // Top section
  topSection: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 10 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  greetingText: { fontSize: 22, color: t.text, letterSpacing: -0.3 },
  dateText: { fontSize: 13, color: t.text3, marginTop: 2 },
  historyBtn: { padding: 6 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  inboxBadge: { position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: t.auraIndigo, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  inboxBadgeTxt: { fontSize: 10, fontFamily: fonts.bold, color: '#fff' },

  arcSection: { alignItems: 'center', gap: 10, marginBottom: 12 },

  heroAmount: { fontSize: 33, color: t.text, letterSpacing: -0.8, lineHeight: 36 },
  heroSub: { fontSize: 13.5, color: t.text2, marginTop: -2 },

  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: -2 },
  legendSwatch: { width: 14, height: 14, borderRadius: 4 },
  legendWhiteDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', marginLeft: 4, shadowColor: '#fff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 4 },
  legendText: { fontSize: 12.5, color: t.text3 },

  pacePill: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingVertical: 7, borderRadius: t.rPill, borderWidth: 1 },
  pacePillGreen: { backgroundColor: t.greenTint, borderColor: 'rgba(52,211,153,0.3)' },
  pacePillRed: { backgroundColor: t.redTint, borderColor: 'rgba(251,113,133,0.3)' },
  paceDot: { width: 7, height: 7, borderRadius: 4 },
  paceText: { fontSize: 13 },

  noticedWrap: { marginTop: 8 },
  noticedCard: { padding: 14 },
  noticedTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  noticedBadge: { fontSize: 12, color: t.auraAqua },
  noticedArrow: { fontSize: 14, color: t.text3 },
  noticedText: { fontSize: 14, color: t.text2, lineHeight: 20 },

  sessionBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: t.indigoTint, borderRadius: t.rSm, paddingHorizontal: 12, paddingVertical: 8, marginTop: 8 },
  sessionBannerTxt: { fontSize: 13, color: t.indigoBright },
  sessionBannerBack: { fontSize: 12, color: t.text2 },

  // Hero inside scroll
  heroSection: { paddingHorizontal: 4, paddingBottom: 16 },

  // Chat
  chatScroll: { flex: 1 },
  chatContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 16 },

  chipsSection: { marginBottom: 20, gap: 10 },
  tryAskLabel: { fontSize: 12, color: t.text3, letterSpacing: 0.3, textTransform: 'uppercase' },
  chipsRow: { flexDirection: 'row', gap: 8 },
  chip: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: t.glassLine2, borderRadius: t.rPill, paddingHorizontal: 14, paddingVertical: 9 },
  chipText: { fontSize: 13, color: t.text2 },

  // Messages
  assistantRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16, maxWidth: '90%' },
  orbAvatar: { width: 28, height: 28, marginRight: 10, marginTop: 2 },
  asMsgCol: { flex: 1 },
  asBubble: { padding: 13 },
  txCardSpacing: { marginTop: 8 },
  typingBubble: { padding: 13, minWidth: 56 },
  typingText: { fontSize: 16, color: t.auraAqua },

  userRow: { flexDirection: 'column', alignItems: 'flex-end', marginBottom: 16, alignSelf: 'flex-end', maxWidth: '82%' },
  userBubble: { borderRadius: t.rMd, padding: 13 },

  bubbleText: { fontSize: 15, color: t.text, lineHeight: 22 },
  msgTime: { fontSize: 10, color: t.text3, marginTop: 4, marginLeft: 2 },
  msgTimeRight: { fontSize: 10, color: t.text3, marginTop: 4 },

  // Composer — glass pill
  composerBlur: {
    flexDirection: 'row', alignItems: 'flex-end',
    paddingHorizontal: 12, paddingVertical: 10, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: t.line,
    gap: 8,
  },
  composerAndroid: {
    flexDirection: 'row', alignItems: 'flex-end',
    backgroundColor: 'rgba(10,15,30,0.92)',
    paddingHorizontal: 12, paddingVertical: 10, paddingBottom: 14,
    borderTopWidth: 1, borderTopColor: t.line,
    gap: 8,
  },
  composerBtn: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  composerInput: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: t.glassLine, borderRadius: t.rMd,
    paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 15, color: t.text, maxHeight: 100,
  },
  sendBtn: { width: 40, height: 40, borderRadius: t.rMd, alignItems: 'center', justifyContent: 'center' },
  sendBtnOn: { backgroundColor: t.auraAqua },
  sendBtnOff: { backgroundColor: 'rgba(255,255,255,0.06)' },

  // Voice recording bar
  voiceBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 16,
  },
  voiceCancelBtn: { padding: 6 },
  voiceCancelTxt: { fontSize: 16, color: t.text2 },
  waveRow: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, height: 32 },
  waveBar: { width: 4, height: 28, borderRadius: 2, backgroundColor: t.auraAqua },
  voiceTimer: { fontSize: 13, color: t.text2, minWidth: 40, textAlign: 'center' },
  voiceSendBtn: { backgroundColor: t.auraAqua, borderRadius: t.rSm, paddingHorizontal: 16, paddingVertical: 8 },
  voiceSendTxt: { fontSize: 14, color: t.auraBg },

  // History modal
  historyModal: { flex: 1, backgroundColor: t.auraBg },
  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: t.line },
  historyTitle: { fontSize: 20, color: t.text },
  historyClose: { fontSize: 20, color: t.text2 },
  historySub: { fontSize: 13, color: t.text2, paddingHorizontal: 20, paddingBottom: 12, lineHeight: 18 },
  historyScroll: { flex: 1 },
  historyContent: { padding: 16, gap: 10 },
  historyEmpty: { textAlign: 'center', color: t.text2, fontSize: 14, marginTop: 40, lineHeight: 22, paddingHorizontal: 16 },
  historyItem: { backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: 1, borderColor: t.glassLine, borderRadius: t.rMd, padding: 16, gap: 4 },
  historyItemActive: { borderColor: t.auraIndigo, backgroundColor: t.indigoTint },
  historyItemDate: { fontSize: 13, color: t.indigoBright },
  historyItemPreview: { fontSize: 14, color: t.text },
  historyItemMeta: { fontSize: 11, color: t.text3 },
});
