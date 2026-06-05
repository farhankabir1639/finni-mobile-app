import AsyncStorage from '@react-native-async-storage/async-storage';

export type SessionMessage = { id: string; role: 'user' | 'assistant'; content: string; timestamp?: string };
export type ChatSession = { id: string; date: string; messages: SessionMessage[]; preview: string };

const MAX_SESSIONS = 20;

export function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function storageKey(userId: string): string {
  return `chat_sessions_${userId}`;
}

export async function loadAllSessions(userId: string): Promise<ChatSession[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(storageKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function loadTodaySession(userId: string): Promise<SessionMessage[] | null> {
  const sessions = await loadAllSessions(userId);
  const today = todayDateStr();
  return sessions.find((s) => s.date === today)?.messages ?? null;
}

export async function loadSessionByDate(userId: string, date: string): Promise<SessionMessage[] | null> {
  const sessions = await loadAllSessions(userId);
  return sessions.find((s) => s.date === date)?.messages ?? null;
}

export async function saveSession(userId: string, messages: SessionMessage[], date?: string): Promise<void> {
  if (!userId || !messages.length) return;
  try {
    const sessions = await loadAllSessions(userId);
    const targetDate = date ?? todayDateStr();
    const sessionId = `${userId}_${targetDate}`;
    const preview = messages.find((m) => m.role === 'user')?.content?.slice(0, 60) ?? 'No messages';
    const updated: ChatSession = { id: sessionId, date: targetDate, messages, preview };
    const idx = sessions.findIndex((s) => s.date === targetDate);
    if (idx >= 0) sessions[idx] = updated;
    else {
      // Insert in date-descending order
      const insertIdx = sessions.findIndex((s) => s.date < targetDate);
      if (insertIdx >= 0) sessions.splice(insertIdx, 0, updated);
      else sessions.push(updated);
    }
    await AsyncStorage.setItem(storageKey(userId), JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  } catch (e) {
    if (__DEV__) console.error('[ChatSessions] Save error:', e);
  }
}

export function formatSessionDate(dateStr: string): string {
  const today = todayDateStr();
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatMessageTime(timestamp?: string): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}
