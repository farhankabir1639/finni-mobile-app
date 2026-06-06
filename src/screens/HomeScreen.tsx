import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Pressable, KeyboardAvoidingView, Platform, Modal, Alert,
  ActionSheetIOS, Linking, Animated, useWindowDimensions, Keyboard,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Svg, { Path, Circle as SvgCircle } from 'react-native-svg';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { supabase } from '../lib/supabase';
import {
  chatAgent, parseTransactionsFromImage, saveImageTransactions,
  checkImageTxLimit, markImageTxUsed, transcribeAudio,
} from '../lib/agents';
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
import { t, fonts } from '../theme/tokens';

// ── Types ─────────────────────────────────────────────────────────────────────
type Message = { id: string; role: 'user' | 'assistant'; content: string; timestamp?: string };

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
const ClockIcon = ({ color = t.text2 }: { color?: string }) => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <SvgCircle cx="12" cy="12" r="9" stroke={color} strokeWidth="1.8" />
    <Path d="M12 7v5l3 3" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
  </Svg>
);
const CameraIcon = ({ color = t.text2 }: { color?: string }) => (
  <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
    <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke={color} strokeWidth="1.7" strokeLinecap="round" />
    <SvgCircle cx="12" cy="13" r="4" stroke={color} strokeWidth="1.7" />
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
// GlassDock content height: paddingVertical(10*2) + tabPadding(4*2) + icon(22) + gap(4) + label(12) ≈ 70px
const DOCK_CONTENT_H = 70;

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
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const [isRecording, setIsRecording]           = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const scrollRef         = useRef<ScrollView>(null);
  const welcomeAddedRef   = useRef(false);
  const isSendingRef      = useRef(false);
  const isFetchingCtxRef  = useRef(false);
  const recordingTimer    = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioRecording    = useRef<Audio.Recording | null>(null);
  const waveAnims         = useRef([...Array(5)].map(() => new Animated.Value(0.4))).current;
  const waveLoopsRef      = useRef<Animated.CompositeAnimation[]>([]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const today           = new Date();
  const monthElapsedPct = Math.round((today.getDate() / daysInMonth(today)) * 100);
  const monthName       = today.toLocaleString('en-US', { month: 'long' });
  const onTrack         = monthUsedPct <= monthElapsedPct;
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
      if (audioRecording.current) {
        audioRecording.current.stopAndUnloadAsync().catch(() => {});
        audioRecording.current = null;
      }
    };
  }, []);

  const startRecording = async () => {
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Microphone Access', 'Please allow microphone access in Settings to use voice input.');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      audioRecording.current = recording;
      setIsRecording(true);
      setRecordingSeconds(0);
      recordingTimer.current = setInterval(() => setRecordingSeconds(s => s + 1), 1000);
      trackEvent('voice_input_started');
    } catch (e) {
      // Reset audio mode if recording creation failed
      try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch {}
      if (__DEV__) console.error('[Voice] Start recording error:', e);
      captureError(e, { context: 'startRecording' });
      Alert.alert('Error', 'Could not start recording. Please try again.');
    }
  };

  const cancelRecording = async () => {
    setIsRecording(false);
    setRecordingSeconds(0);
    if (recordingTimer.current) { clearInterval(recordingTimer.current); recordingTimer.current = null; }
    if (audioRecording.current) {
      try { await audioRecording.current.stopAndUnloadAsync(); } catch {}
      audioRecording.current = null;
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  };

  const stopRecording = async () => {
    if (!audioRecording.current) { cancelRecording(); return; }
    setIsRecording(false);
    if (recordingTimer.current) { clearInterval(recordingTimer.current); recordingTimer.current = null; }

    try {
      await audioRecording.current.stopAndUnloadAsync();
      await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
      const uri = audioRecording.current.getURI();
      audioRecording.current = null;

      if (!uri) { Alert.alert('Error', 'No audio recorded.'); return; }

      // Read audio as base64
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
      if (!base64 || base64.length < 100) {
        Alert.alert('Too Short', 'Recording was too short. Please try again.');
        return;
      }

      // Transcribe via Gemini (M4A container uses AAC codec — send as audio/mp4)
      setIsTyping(true);
      const transcribed = await transcribeAudio(base64, 'audio/mp4');
      setIsTyping(false);

      if (!transcribed.trim()) {
        Alert.alert('Could Not Transcribe', "I couldn't understand the audio. Please try again or type your message.");
        return;
      }

      trackEvent('voice_input_transcribed', { length: transcribed.length });
      // Feed transcribed text into chat — guard against concurrent sends
      if (!isSendingRef.current) {
        handleSend(transcribed);
      } else {
        // A manual send is already in flight — show transcribed text for user to send manually
        setInputText(transcribed);
      }
    } catch (e) {
      setIsTyping(false);
      audioRecording.current = null;
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
      if (pr.error) captureError(pr.error, { context: 'fetchCtx.profile' });
      if (cr.error) captureError(cr.error, { context: 'fetchCtx.categories' });
      if (tr.error) captureError(tr.error, { context: 'fetchCtx.transactions' });
      if (gr.error) captureError(gr.error, { context: 'fetchCtx.goals' });
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

  useFocusEffect(React.useCallback(() => { fetchChatContext(); }, [fetchChatContext]));

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
      const { response, transaction } = await chatAgent(trimmed, user.id, [...messages, userMsg], chatContext, sessionDate);
      setIsTyping(false);
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: response, timestamp: new Date().toISOString() };
      const updated = [...messages, userMsg, aiMsg];
      setMessages(updated);
      saveSession(user.id, updated as SessionMessage[], sessionDate);
      if (transaction) { fetchStats(); fetchChatContext(); trackEvent('transaction_logged', { category: transaction.category, amount: transaction.amount }); }
      trackEvent('chat_message_sent');
    } catch (e) {
      captureError(e, { context: 'handleSend', userId: user?.id });
      setIsTyping(false);
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
    } catch (e) { captureError(e, { context: 'handleRegenerate', userId: user.id }); }
    finally { setIsTyping(false); isSendingRef.current = false; }
  }, [messages, user?.id, chatContext, activeSessionDate]);

  const handleImagePick = async (useCamera: boolean) => {
    if (!user?.id || isProcessingImage || isSendingRef.current) return;
    const used = await checkImageTxLimit(user.id);
    if (used) { Alert.alert('Daily limit reached', 'You can scan 1 image per day. Come back tomorrow!'); return; }
    if (useCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission required', 'Camera access is needed to take photos.'); return; }
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (result.canceled || !result.assets?.[0]) return;
    setIsProcessingImage(true);
    isSendingRef.current = true;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: '📷 Scanning image for transactions...', timestamp: new Date().toISOString() };
    setMessages(m => [...m, userMsg]);
    setIsTyping(true);
    try {
      const comp = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, [{ resize: { width: 1024 } }], { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      if (!comp.base64) throw new Error('Failed to process image');
      const parsed = await parseTransactionsFromImage(comp.base64, 'image/jpeg');
      if (parsed.length === 0) {
        const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: "I couldn't find any transactions in that image. Try a clearer photo.", timestamp: new Date().toISOString() };
        const updated = [...messages, userMsg, aiMsg];
        setMessages(updated);
        saveSession(user.id, updated as SessionMessage[], activeSessionDate ?? undefined);
        return;
      }
      setIsTyping(false);
      const lines = parsed.map(tx => `• ${tx.description}: ${tx.type === 'income' ? '+' : '-'}${currencySymbol}${tx.amount.toFixed(2)} (${tx.category ?? 'Other'})`).join('\n');
      const confirmed = await new Promise<boolean>(resolve => {
        Alert.alert(`Found ${parsed.length} transaction${parsed.length > 1 ? 's' : ''}`, `${lines}\n\nSave all to your account?`, [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Save All', onPress: () => resolve(true) },
        ], { cancelable: true, onDismiss: () => resolve(false) });
      });
      if (!confirmed) { setMessages(messages); return; }
      setIsTyping(true);
      const extraction = await saveImageTransactions(parsed, user.id, chatContext.profile?.currency ?? 'USD', activeSessionDate ?? undefined);
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: extraction.summary, timestamp: new Date().toISOString() };
      const updated = [...messages, userMsg, aiMsg];
      setMessages(updated);
      saveSession(user.id, updated as SessionMessage[], activeSessionDate ?? undefined);
      if (extraction.savedCount > 0) { await markImageTxUsed(user.id); fetchStats(); fetchChatContext(); trackEvent('image_transactions_logged', { count: extraction.savedCount }); }
    } catch (e) {
      captureError(e, { context: 'handleImagePick', userId: user.id });
      setMessages(m => [...m, { id: (Date.now() + 1).toString(), role: 'assistant', content: "I couldn't process that image. Please try again 🔄" }]);
    } finally { setIsTyping(false); setIsProcessingImage(false); isSendingRef.current = false; }
  };

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

  const showImageOptions = () => {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 }, i => {
        if (i === 1) handleImagePick(true);
        else if (i === 2) handleImagePick(false);
      });
    } else {
      Alert.alert('Scan Transactions', 'Choose an option', [
        { text: 'Take Photo', onPress: () => handleImagePick(true) },
        { text: 'Choose from Library', onPress: () => handleImagePick(false) },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
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
  const busy = isTyping || isProcessingImage;

  // ── Composer pieces ────────────────────────────────────────────────────────
  const composerInner = (
    <>
      <TouchableOpacity style={styles.composerBtn} onPress={showImageOptions} disabled={busy} activeOpacity={0.7}>
        <CameraIcon color={busy ? t.text3 : t.text2} />
      </TouchableOpacity>
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
              <Pressable style={styles.historyBtn} onPress={openHistory} hitSlop={12}>
                <ClockIcon />
              </Pressable>
            </View>

            {/* ArcMeter hero */}
            <View style={styles.arcSection}>
              <ArcMeter size={244} stroke={13} pct={monthUsedPct} markerPct={monthElapsedPct}>
                <Orb size={104} rings talking={isTyping} />
              </ArcMeter>

              {/* Big monetary hero */}
              {monthlyBudget > 0 ? (
                <>
                  <Text style={[styles.heroAmount, { fontFamily: fonts.extraBold }]}>
                    {currencySymbol}{budgetLeft.toFixed(0)}
                  </Text>
                  <Text style={[styles.heroSub, { fontFamily: fonts.medium }]}>
                    left of your {currencySymbol}{monthlyBudget.toFixed(0)} budget
                  </Text>
                </>
              ) : (
                <Text style={[styles.heroSub, { fontFamily: fonts.medium }]}>
                  Add income in Settings to track budget
                </Text>
              )}

              {/* Legend: % spent + % of month */}
              {monthlyBudget > 0 && (
                <View style={styles.legendRow}>
                  <LinearGradient
                    colors={[t.auraAqua, '#a5b4fc']}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                    style={styles.legendSwatch}
                  />
                  <Text style={[styles.legendText, { fontFamily: fonts.medium }]}>{monthUsedPct}% spent</Text>
                  <View style={styles.legendWhiteDot} />
                  <Text style={[styles.legendText, { fontFamily: fonts.medium }]}>{monthElapsedPct}% of {monthName}</Text>
                </View>
              )}

              {/* Pace pill */}
              <View style={[styles.pacePill, onTrack ? styles.pacePillGreen : styles.pacePillRed]}>
                <View style={[styles.paceDot, { backgroundColor: onTrack ? t.green : t.red }]} />
                <Text style={[styles.paceText, { fontFamily: fonts.semiBold, color: onTrack ? t.green : t.red }]}>
                  {onTrack ? 'On track' : 'Over pace'}
                </Text>
              </View>
            </View>

            {/* Finni noticed card */}
            {finnisNoticed ? (
              <TouchableOpacity
                style={styles.noticedWrap}
                onPress={() => navigation.navigate('Analytics' as never)}
                activeOpacity={0.85}
              >
                <GlassCard style={styles.noticedCard} borderRadius={t.rLg} intensity={22}>
                  <View style={styles.noticedTop}>
                    <Text style={[styles.noticedBadge, { fontFamily: fonts.semiBold }]}>✦ Finni noticed</Text>
                    <Text style={styles.noticedArrow}>→</Text>
                  </View>
                  <Text style={[styles.noticedText, { fontFamily: fonts.regular }]}>{finnisNoticed}</Text>
                </GlassCard>
              </TouchableOpacity>
            ) : null}

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

          <View style={styles.divider} />

          {/* ── CHAT SCROLL ── */}
          <ScrollView
            ref={scrollRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
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
                    <GlassCard style={styles.asBubble} borderRadius={t.rMd} intensity={22}>
                      <Text style={[styles.bubbleText, { fontFamily: fonts.regular }]}>{msg.content}</Text>
                    </GlassCard>
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

  divider: { height: 1, backgroundColor: t.line, marginHorizontal: 0 },

  // Chat
  chatScroll: { flex: 1 },
  chatContent: { padding: 16, paddingBottom: 24 },

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
