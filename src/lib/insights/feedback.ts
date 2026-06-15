// ── Feedback + shown-history store ──────────────────────────────────────────
//
// Per-user 👍/👎 tallies per taxonomy category drive the Thompson-sampling
// personalization term in the ranker. Shown-history timestamps drive novelty
// decay (don't repeat the same insight day after day).
//
// AsyncStorage for the thin slice; this is the seam where a server-side store
// (so personalization survives reinstalls and feeds cohort models) would slot in.

import AsyncStorage from '@react-native-async-storage/async-storage';

export type FeedbackStats = Record<string, { up: number; down: number }>;
type ShownMap = Record<string, string>; // dedupeKey -> ISO timestamp

const fbKey = (userId: string) => `insight_feedback_${userId}`;
const shownKey = (userId: string) => `insight_shown_${userId}`;

export async function getFeedbackStats(userId: string): Promise<FeedbackStats> {
  try {
    const raw = await AsyncStorage.getItem(fbKey(userId));
    return raw ? (JSON.parse(raw) as FeedbackStats) : {};
  } catch {
    return {};
  }
}

export async function recordFeedback(
  userId: string,
  category: string,
  vote: 'up' | 'down'
): Promise<void> {
  try {
    const stats = await getFeedbackStats(userId);
    const cur = stats[category] ?? { up: 0, down: 0 };
    if (vote === 'up') cur.up += 1;
    else cur.down += 1;
    stats[category] = cur;
    await AsyncStorage.setItem(fbKey(userId), JSON.stringify(stats));
  } catch {
    // best-effort; a lost vote just means slightly slower personalization
  }
}

export async function getShownMap(userId: string): Promise<ShownMap> {
  try {
    const raw = await AsyncStorage.getItem(shownKey(userId));
    return raw ? (JSON.parse(raw) as ShownMap) : {};
  } catch {
    return {};
  }
}

export async function recordShown(userId: string, dedupeKey: string, nowIso: string): Promise<void> {
  try {
    const map = await getShownMap(userId);
    map[dedupeKey] = nowIso;
    await AsyncStorage.setItem(shownKey(userId), JSON.stringify(map));
  } catch {
    // ignore
  }
}
