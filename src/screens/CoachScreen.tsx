import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { chatAgent } from '../lib/agents';

type Message = { id: string; role: 'user' | 'assistant'; content: string };

function getFirstName(fullName: string | null | undefined): string | null {
  if (!fullName?.trim()) return null;
  return fullName.trim().split(/\s+/)[0] ?? null;
}


const QUICK_CHIPS = [
  '💰 How\'s my budget?',
  '📊 Show spending',
  '💡 Save money tips',
  '📝 Log expense',
];

export default function CoachScreen() {
  const { user } = useAuth();
  const [firstName, setFirstName] = useState<string | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [typingDots, setTypingDots] = useState('.');
  const scrollRef = useRef<ScrollView>(null);
  const welcomeAddedRef = useRef(false);

  useEffect(() => {
    if (!user?.id) {
      setProfileLoaded(true);
      return;
    }
    supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single()
      .then(({ data, error }) => {
        setFirstName(error ? null : getFirstName(data?.name));
        setProfileLoaded(true);
      });
  }, [user?.id]);

  useEffect(() => {
    if (!welcomeAddedRef.current && profileLoaded) {
      welcomeAddedRef.current = true;
      const name = firstName ?? 'there';
      setMessages([
        {
          id: 'welcome',
          role: 'assistant',
          content: `Hi ${name}! 👋 I'm Finni, your AI finance coach. I can help you track expenses, analyze spending, and give personalized financial advice. Try saying: 'Spent $45 on lunch' or 'How's my budget?'`,
        },
      ]);
    }
  }, [profileLoaded, firstName]);

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

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !user?.id) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: trimmed,
    };
    setMessages((m) => [...m, userMsg]);
    setInputText('');
    setIsTyping(true);

    try {
      const { response } = await chatAgent(trimmed, user.id, [...messages, userMsg], {});
      setIsTyping(false);
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
      };
      setMessages((m) => [...m, assistantMsg]);
    } catch {
      setIsTyping(false);
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: "I'm having trouble connecting. Please try again 🔄",
      };
      setMessages((m) => [...m, assistantMsg]);
    }
  };

  const handleChipPress = (chip: string) => {
    const text = chip.replace(/^[^\s]+\s/, '').trim();
    sendMessage(text);
  };

  const isConversationEmpty = messages.length <= 1;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>✨ Finni AI</Text>
          <View style={styles.onlineRow}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>Online</Text>
          </View>
        </View>

        {/* Chat area */}
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
                <View style={styles.assistantBubble}>
                  <Text style={styles.bubbleText}>{msg.content}</Text>
                </View>
              </View>
            ) : (
              <View key={msg.id} style={styles.userRow}>
                <View style={styles.userBubble}>
                  <Text style={styles.bubbleText}>{msg.content}</Text>
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

        {/* Quick chips - only when empty */}
        {isConversationEmpty && (
          <ScrollView
            horizontal={true}
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

        {/* Input bar */}
        <View style={styles.inputBar}>
          <TextInput
            style={styles.input}
            placeholder="Message Finni..."
            placeholderTextColor={colors.textSecondary}
            value={inputText}
            onChangeText={setInputText}
            multiline
            maxLength={500}
            editable={!isTyping}
          />
          <TouchableOpacity
            style={[styles.sendButton, !inputText.trim() && styles.sendDisabled]}
            onPress={() => sendMessage(inputText)}
            disabled={!inputText.trim()}
            activeOpacity={0.8}
          >
            <Text style={styles.sendIcon}>➤</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
  },
  header: {
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  onlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.success,
  },
  onlineText: {
    fontSize: 13,
    color: colors.success,
    fontWeight: '500',
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
    maxHeight: 48,
    marginBottom: 8,
  },
  chipsContent: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  chip: {
    flexShrink: 0,
    marginRight: 8,
    backgroundColor: colors.cardBackground,
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
});
