import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { chatAgent } from '../lib/agents';
import { seedDefaultCategories } from '../lib/seedCategories';
import { captureError } from '../lib/sentry';
import { trackEvent, trackScreen } from '../lib/analytics';
import {
  loadTodaySession,
  saveSession,
  loadAllSessions,
  formatSessionDate,
  formatMessageTime,
  todayDateStr,
  type SessionMessage,
  type ChatSession,
} from '../lib/chatSessions';

type Message = { id: string; role: 'user' | 'assistant'; content: string; timestamp?: string };

function getGreetingBase(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getFirstName(fullName: string | null | undefined): string | null {
  if (!fullName?.trim()) return null;
  return fullName.trim().split(/\s+/)[0] ?? null;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

const QUICK_CHIPS = [
  "💰 How's my budget?",
  '📊 Show spending',
  '💡 Save money tips',
  '📝 Log expense',
];

export default function HomeScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { currencySymbol } = useProfile();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingDots, setTypingDots] = useState('.');
  const [todaySpent, setTodaySpent] = useState(0);
  const [monthUsedPct, setMonthUsedPct] = useState(0);
  const [budgetLeft, setBudgetLeft] = useState(0);
  const [chatContext, setChatContext] = useState<{
    profile?: { name?: string; currency?: string } | null;
    categories?: { id: string; name: string; emoji?: string; budget?: number; spent?: number }[] | null;
    recentTransactions?: { withdrawal?: number; deposit?: number; description: string | null; category_id?: string | null; date: string; type?: string }[] | null;
    goals?: { name: string; target_amount?: number; current_amount?: number }[] | null;
  }>({});
  const [showHistory, setShowHistory] = useState(false);
  const [historySessions, setHistorySessions] = useState<ChatSession[]>([]);
  const [activeSessionDate, setActiveSessionDate] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const welcomeAddedRef = useRef(false);
  const isSendingRef = useRef(false);

  const fetchChatContext = useCallback(async () => {
    if (!user?.id) return;
    try {
      const [profileRes, categoriesRes, txRes, goalsRes] = await Promise.all([
        supabase.from('profiles').select('name, currency').eq('id', user.id).maybeSingle(),
        supabase.from('categories').select('id, name, emoji, budget, spent').eq('user_id', user.id),
        supabase.from('transactions').select('withdrawal, deposit, description, category_id, date, type').eq('user_id', user.id).order('date', { ascending: false }).limit(10),
        supabase.from('financial_goals').select('name, target_amount, current_amount').eq('user_id', user.id),
      ]);
      if (profileRes.error) { console.error('[HomeScreen] Profile fetch error:', profileRes.error); captureError(profileRes.error, { context: 'fetchChatContext.profile' }); }
      if (categoriesRes.error) { console.error('[HomeScreen] Categories fetch error:', categoriesRes.error); captureError(categoriesRes.error, { context: 'fetchChatContext.categories' }); }
      if (txRes.error) { console.error('[HomeScreen] Transactions fetch error:', txRes.error); captureError(txRes.error, { context: 'fetchChatContext.transactions' }); }
      if (goalsRes.error) { console.error('[HomeScreen] Goals fetch error:', goalsRes.error); captureError(goalsRes.error, { context: 'fetchChatContext.goals' }); }
      setChatContext({
        profile: profileRes.data ? { name: profileRes.data.name, currency: profileRes.data.currency } : null,
        categories: (categoriesRes.data as { id: string; name: string; emoji?: string; budget?: number; spent?: number }[]) ?? [],
        recentTransactions: (txRes.data as { withdrawal?: number; deposit?: number; description: string | null; category_id?: string | null; date: string; type?: string }[]) ?? [],
        goals: (goalsRes.data as { name: string; target_amount?: number; current_amount?: number }[]) ?? [],
      });
    } catch (e) {
      console.error('[HomeScreen] fetchChatContext error:', e);
      captureError(e, { context: 'fetchChatContext' });
      setChatContext({});
    }
  }, [user?.id]);

  useFocusEffect(
    React.useCallback(() => {
      fetchChatContext();
    }, [fetchChatContext])
  );

  const fetchStats = useCallback(async () => {
    if (!user?.id) return;
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      const [{ data: txData }, { data: profileData }, { data: incomeData }] = await Promise.all([
        supabase.from('transactions').select('withdrawal, deposit, date, type').eq('user_id', user.id).gte('date', monthStart),
        Promise.resolve({ data: null }),
        supabase.from('income').select('amount, frequency').eq('user_id', user.id),
      ]);
      let todayTotal = 0;
      let monthTotal = 0;
      (txData ?? []).forEach((t) => {
        if (t.type === 'expense') {
          const w = Number(t.withdrawal) || 0;
          if (t.date >= todayStart) todayTotal += w;
          monthTotal += w;
        }
      });
      setTodaySpent(todayTotal);

      const monthlyIncome = (incomeData ?? []).reduce((sum, r) => {
        const amt = Number(r.amount) || 0;
        if (r.frequency === 'weekly') return sum + amt * 4.33;
        if (r.frequency === 'annual') return sum + amt / 12;
        return sum + amt;
      }, 0);

      const base = monthlyIncome;
      setMonthUsedPct(base > 0 ? Math.min(100, Math.round((monthTotal / base) * 100)) : 0);
      setBudgetLeft(Math.max(0, base - monthTotal));
    } catch (e) {
      console.error('[HomeScreen] fetchStats error:', e);
      captureError(e, { context: 'fetchStats' });
    }
  }, [user?.id]);

  useFocusEffect(
    React.useCallback(() => {
      fetchStats();
    }, [fetchStats])
  );

  const today = new Date();
  const greeting = (() => {
    const base = getGreetingBase();
    return firstName ? `${base}, ${firstName}! 👋` : `${base}! 👋`;
  })();

  useEffect(() => {
    if (!user?.id) {
      setProfileLoaded(true);
      return;
    }
    const loadProfile = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('name')
          .eq('id', user.id)
          .maybeSingle();
        if (error?.code === 'PGRST116') {
          const defaultName = user.email?.split('@')[0] ?? 'User';
          await supabase.from('profiles').upsert({ id: user.id, name: defaultName });
          await seedDefaultCategories(user.id);
          setFirstName(getFirstName(defaultName));
        } else {
          setFirstName(getFirstName(data?.name));
        }
      } catch {
        setFirstName(null);
      } finally {
        setProfileLoaded(true);
      }
    };
    loadProfile();
  }, [user?.id]);

  useEffect(() => {
    if (!welcomeAddedRef.current && profileLoaded && user?.id) {
      welcomeAddedRef.current = true;
      const name = firstName ?? 'there';
      loadTodaySession(user.id).then((saved) => {
        if (saved && saved.length > 0) {
          setMessages(saved as Message[]);
        } else {
          setMessages([
            {
              id: 'welcome',
              role: 'assistant',
              content: `Hi ${name}! 👋 I'm Finni. Ask me anything about your finances or just say 'spent $X on Y' to log expenses`,
            },
          ]);
        }
      });
    }
  }, [profileLoaded, firstName, user?.id]);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, isTyping]);

  useEffect(() => {
    if (!isTyping) return;
    const id = setInterval(() => {
      setTypingDots((d) => (d.length >= 3 ? '.' : d + '.'));
    }, 400);
    return () => clearInterval(id);
  }, [isTyping]);

  const handleSend = async (text: string) => {
    const trimmed = text.trim().replace(/[\x00-\x1F\x7F]/g, '');
    if (!trimmed || !user?.id || isSendingRef.current) return;
    isSendingRef.current = true;

    const now = new Date().toISOString();
    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
      timestamp: now,
    };
    setMessages((m) => [...m, userMsg]);
    setInputText('');
    setIsTyping(true);

    const sessionDate = activeSessionDate ?? undefined;

    try {
      const { response, transaction } = await chatAgent(trimmed, user.id, [...messages, userMsg], chatContext, sessionDate);
      setIsTyping(false);

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date().toISOString(),
      };
      const updatedMessages = [...messages, userMsg, aiMsg];
      setMessages(updatedMessages);
      saveSession(user.id, updatedMessages as SessionMessage[], sessionDate);

      if (transaction) {
        fetchStats();
        fetchChatContext();
        trackEvent('transaction_logged', { category: transaction.category, amount: transaction.amount });
      }
      trackEvent('chat_message_sent');
    } catch (e) {
      captureError(e, { context: 'handleSend', userId: user?.id });
      setIsTyping(false);
      const errMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having trouble connecting. Please try again 🔄",
      };
      setMessages((m) => [...m, errMsg]);
    } finally {
      isSendingRef.current = false;
    }
  };

  const handleChipPress = (chip: string) => {
    const text = chip.replace(/^[^\s]+\s/, '').trim();
    handleSend(text);
  };

  const openHistory = async () => {
    if (!user?.id) return;
    const sessions = await loadAllSessions(user.id);
    setHistorySessions(sessions);
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
    if (saved && saved.length > 0) {
      setMessages(saved as Message[]);
    } else {
      const name = firstName ?? 'there';
      setMessages([{
        id: 'welcome',
        role: 'assistant',
        content: `Hi ${name}! 👋 I'm Finni. Ask me anything about your finances or just say 'spent $X on Y' to log expenses`,
      }]);
    }
  };

  const isConversationEmpty = messages.length <= 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* TOP SECTION - fixed, not scrollable */}
        <View style={styles.topSection}>
          <View style={styles.header}>
            <Text style={styles.greeting}>{greeting}</Text>
            <View style={styles.headerIcons}>
              <Pressable style={styles.headerIconButton} hitSlop={12} onPress={openHistory}>
                <Text style={styles.headerIcon}>🕐</Text>
              </Pressable>
              <Pressable
                style={styles.headerIconButton}
                hitSlop={12}
                onPress={() => navigation.navigate('Settings' as never)}
              >
                <Text style={styles.headerIcon}>⚙️</Text>
              </Pressable>
            </View>
          </View>
          <Text style={styles.date}>{formatDate(today)}</Text>

          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Today</Text>
              <Text style={styles.statValue}>{currencySymbol}{todaySpent.toFixed(2)}</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Month</Text>
              <Text style={styles.statValue}>{monthUsedPct}% used</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statLabel}>Left</Text>
              <Text style={styles.statValue}>{currencySymbol}{budgetLeft.toFixed(2)}</Text>
            </View>
          </View>

          <View style={styles.divider} />
          {activeSessionDate && (
            <View style={styles.sessionBanner}>
              <Text style={styles.sessionBannerText}>📅 {formatSessionDate(activeSessionDate)}</Text>
              <TouchableOpacity onPress={returnToToday} hitSlop={8}>
                <Text style={styles.sessionBannerBack}>Back to Today →</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* CHAT SECTION - flex 1, scrollable */}
        <ScrollView
          ref={scrollRef}
          style={styles.chatScroll}
          contentContainerStyle={styles.chatContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {messages.map((msg) =>
            msg.role === 'assistant' ? (
              <View key={msg.id} style={styles.assistantRow}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>F</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.assistantBubble}>
                    <Text style={styles.bubbleText}>{msg.content}</Text>
                  </View>
                  {msg.timestamp && (
                    <Text style={styles.messageTime}>{formatMessageTime(msg.timestamp)}</Text>
                  )}
                </View>
              </View>
            ) : (
              <View key={msg.id} style={styles.userRow}>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={styles.userBubble}>
                    <Text style={styles.bubbleText}>{msg.content}</Text>
                  </View>
                  {msg.timestamp && (
                    <Text style={[styles.messageTime, { textAlign: 'right' }]}>{formatMessageTime(msg.timestamp)}</Text>
                  )}
                </View>
              </View>
            )
          )}
          {isTyping && (
            <View style={styles.assistantRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>F</Text>
              </View>
              <View style={styles.typingBubble}>
                <Text style={styles.typingText}>{typingDots}</Text>
              </View>
            </View>
          )}
        </ScrollView>

        {/* Suggestion chips - only when chat is empty */}
        {isConversationEmpty && (
          <ScrollView
            horizontal
            style={styles.chipsScroll}
            contentContainerStyle={styles.chipsContent}
            showsHorizontalScrollIndicator={false}
          >
            {QUICK_CHIPS.map((chip) => (
              <TouchableOpacity
                key={chip}
                style={styles.chip}
                onPress={() => handleChipPress(chip)}
                activeOpacity={0.8}
              >
                <Text style={styles.chipText}>{chip}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* BOTTOM INPUT BAR - fixed */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Message Finni..."
            placeholderTextColor={colors.textSecondary}
            value={inputText}
            onChangeText={setInputText}
            onSubmitEditing={() => handleSend(inputText)}
            multiline
            maxLength={500}
            editable={!isTyping}
          />
          <TouchableOpacity
            style={[styles.sendButton, !inputText.trim() && styles.sendDisabled]}
            onPress={() => handleSend(inputText)}
            disabled={!inputText.trim()}
            activeOpacity={0.8}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Chat History Modal */}
      <Modal visible={showHistory} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowHistory(false)}>
        <SafeAreaView style={styles.historyModal} edges={['top', 'bottom']}>
          <View style={styles.historyHeader}>
            <Text style={styles.historyTitle}>Chat History</Text>
            <TouchableOpacity onPress={() => setShowHistory(false)} hitSlop={12}>
              <Text style={styles.historyClose}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.historySubtitle}>You can review and continue your last 20 days of conversations.</Text>
          <ScrollView style={styles.historyScroll} contentContainerStyle={styles.historyContent} showsVerticalScrollIndicator={false}>
            {historySessions.length === 0 ? (
              <Text style={styles.historyEmpty}>No past sessions yet. Start chatting and your threads will appear here.</Text>
            ) : (
              historySessions.map((session) => (
                <TouchableOpacity
                  key={session.id}
                  style={[styles.historyItem, session.date === (activeSessionDate ?? todayDateStr()) && styles.historyItemActive]}
                  onPress={() => loadHistorySession(session)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.historyItemDate}>{formatSessionDate(session.date)}</Text>
                  <Text style={styles.historyItemPreview} numberOfLines={1}>{session.preview}</Text>
                  <Text style={styles.historyItemMeta}>{session.messages.length} messages · tap to open</Text>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
    flexDirection: 'column',
  },
  topSection: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  greeting: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  headerIconButton: {
    padding: 4,
  },
  headerIcon: {
    fontSize: 24,
  },
  date: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 16,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  statCard: {
    flex: 1,
    height: 70,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    justifyContent: 'center',
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    paddingBottom: 24,
  },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 12,
    maxWidth: '85%',
    alignSelf: 'flex-start',
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  avatarText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  assistantBubble: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    maxWidth: '85%',
  },
  typingBubble: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    minWidth: 48,
  },
  typingText: {
    fontSize: 16,
    color: colors.primary,
    fontWeight: '600',
  },
  userRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 12,
  },
  userBubble: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 12,
    maxWidth: '85%',
  },
  bubbleText: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  chipsScroll: {
    flexShrink: 0,
    marginBottom: 8,
  },
  chipsContent: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    flexShrink: 0,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  chipText: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: colors.cardBackground,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    padding: 12,
    gap: 8,
  },
  input: {
    flex: 1,
    backgroundColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
    maxHeight: 100,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendDisabled: {
    opacity: 0.4,
  },
  sendIcon: {
    fontSize: 18,
    color: colors.textPrimary,
    fontWeight: '700',
  },
  headerIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  historyModal: {
    flex: 1,
    backgroundColor: colors.background,
  },
  historyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  historyClose: {
    fontSize: 20,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  historyScroll: {
    flex: 1,
  },
  historyContent: {
    padding: 16,
    gap: 10,
  },
  historySubtitle: {
    fontSize: 13,
    color: colors.textSecondary,
    paddingHorizontal: 20,
    paddingBottom: 12,
    lineHeight: 18,
  },
  historyEmpty: {
    textAlign: 'center',
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 40,
    lineHeight: 22,
    paddingHorizontal: 16,
  },
  historyItem: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
  },
  historyItemActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(99, 102, 241, 0.08)',
  },
  historyItemDate: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
    marginBottom: 4,
  },
  historyItemPreview: {
    fontSize: 14,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  historyItemMeta: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  sessionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 8,
  },
  sessionBannerText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  sessionBannerBack: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  messageTime: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 3,
    marginLeft: 4,
  },
});
