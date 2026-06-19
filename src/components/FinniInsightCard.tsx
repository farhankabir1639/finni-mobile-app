import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import GlassCard from './GlassCard';
import { t, fonts } from '../theme/tokens';
import { getTopInsight, recordFeedback, dismissInsight, type InsightContext, type GeneratedInsight } from '../lib/insights';
import { trackEvent } from '../lib/analytics';

// Why a 👎 — feeds tonality tuning, not hard-coded numbers.
const DOWN_REASONS = ['Wrong number', 'Not relevant', 'Already knew', 'Too vague'] as const;

interface Props {
  ctx: InsightContext | null;
  fallbackText: string | null;   // old heuristic, shown if the pipeline yields nothing
  onOpen: () => void;            // tap → open Analytics
}

// "Finni noticed" card backed by the grounded insights pipeline. Runs detection
// → rank → generate (number-validated) and renders the winner with 👍/👎 that
// feed the Thompson-sampling personalizer. Falls back to the heuristic string so
// the card is never empty for users where generation is gated or fails.
export default function FinniInsightCard({ ctx, fallbackText, onOpen }: Props) {
  const [insight, setInsight] = useState<GeneratedInsight | null>(null);
  const [voted, setVoted] = useState(false);
  const [askReason, setAskReason] = useState(false);
  // Re-run only when the underlying numbers change, not on every render.
  const sig = ctx ? `${ctx.userId}|${ctx.monthSpent}|${ctx.categories.length}|${ctx.goals.length}` : '';
  const lastSig = useRef('');

  useEffect(() => {
    if (!ctx?.userId || sig === lastSig.current) return;
    lastSig.current = sig;
    let alive = true;
    getTopInsight(ctx)
      .then((res) => { if (alive) { setInsight(res); setVoted(false); setAskReason(false); } })
      .catch(() => { /* card just falls back */ });
    return () => { alive = false; };
  }, [sig, ctx]);

  const onUp = () => {
    if (!ctx?.userId || !insight) return;
    recordFeedback(ctx.userId, insight.category, 'up');
    trackEvent('insight_feedback', { category: insight.category, vote: 'up' });
    setVoted(true);
  };
  // 👎 first reveals reason chips; we record the down-vote up front so the
  // personalizer reacts even if the user skips picking a reason.
  const onDown = () => {
    if (!ctx?.userId || !insight) return;
    recordFeedback(ctx.userId, insight.category, 'down');
    setAskReason(true);
  };
  const onReason = (reason: string) => {
    if (!ctx?.userId || !insight) return;
    trackEvent('insight_feedback', { category: insight.category, vote: 'down', reason });
    dismissInsight(ctx.userId, insight.category);
    setInsight(null);
  };

  // No AI insight → fall back to the heuristic string (old behavior).
  if (!insight) {
    if (!fallbackText) return null;
    return (
      <TouchableOpacity style={s.wrap} onPress={onOpen} activeOpacity={0.85}>
        <GlassCard style={s.card} borderRadius={t.rLg} intensity={22}>
          <View style={s.top}>
            <Text style={[s.badge, { fontFamily: fonts.semiBold }]}>✦ Finni noticed</Text>
            <Text style={s.arrow}>→</Text>
          </View>
          <Text style={[s.text, { fontFamily: fonts.regular }]}>{fallbackText}</Text>
        </GlassCard>
      </TouchableOpacity>
    );
  }

  return (
    <View style={s.wrap}>
      <GlassCard style={s.card} borderRadius={t.rLg} intensity={22}>
        <TouchableOpacity onPress={onOpen} activeOpacity={0.85}>
          <View style={s.top}>
            <Text style={[s.badge, { fontFamily: fonts.semiBold }]}>✦ Finni noticed</Text>
            <Text style={s.arrow}>→</Text>
          </View>
          <Text style={[s.text, { fontFamily: fonts.regular }]}>{insight.insight}</Text>
          {insight.action ? (
            <Text style={[s.action, { fontFamily: fonts.medium }]}>{insight.action}</Text>
          ) : null}
        </TouchableOpacity>

        {voted ? (
          <View style={s.feedbackRow}>
            <Text style={[s.thanks, { fontFamily: fonts.medium }]}>Thanks — I'll tune these for you 💜</Text>
          </View>
        ) : askReason ? (
          <View style={s.reasonWrap}>
            <Text style={[s.helpful, { fontFamily: fonts.regular }]}>What was off?</Text>
            <View style={s.chips}>
              {DOWN_REASONS.map((r) => (
                <TouchableOpacity key={r} onPress={() => onReason(r)} style={s.chip} activeOpacity={0.7}>
                  <Text style={[s.chipText, { fontFamily: fonts.medium }]}>{r}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ) : (
          <View style={s.feedbackRow}>
            <Text style={[s.helpful, { fontFamily: fonts.regular }]}>Helpful?</Text>
            <TouchableOpacity onPress={onUp} hitSlop={10} style={s.voteBtn} activeOpacity={0.7}>
              <Text style={s.voteEmoji}>👍</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onDown} hitSlop={10} style={s.voteBtn} activeOpacity={0.7}>
              <Text style={s.voteEmoji}>👎</Text>
            </TouchableOpacity>
          </View>
        )}
      </GlassCard>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: 8 },
  card: { padding: 14 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 },
  badge: { fontSize: 12, color: t.auraAqua },
  arrow: { fontSize: 14, color: t.text3 },
  text: { fontSize: 14, color: t.text2, lineHeight: 20 },
  action: { fontSize: 13, color: t.auraAqua, marginTop: 6 },
  feedbackRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  helpful: { fontSize: 12, color: t.text3 },
  voteBtn: { paddingVertical: 2, paddingHorizontal: 2 },
  voteEmoji: { fontSize: 16 },
  thanks: { fontSize: 12, color: t.text3 },
  reasonWrap: { marginTop: 12, gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: t.glassLine,
  },
  chipText: { fontSize: 12, color: t.text2 },
});
