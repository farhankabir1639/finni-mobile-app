import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert, ActivityIndicator, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import Aurora from '../components/Aurora';
import GlassCard from '../components/GlassCard';
import { t, fonts, gradients } from '../theme/tokens';
import { PRICING, PRO_FEATURE_COPY, FREE_AI_LIMIT, type ProFeature } from '../lib/entitlements';
import { purchasePlan, restorePurchases, type PlanId } from '../lib/purchases';
import { useProfile } from '../contexts/ProfileContext';

const BENEFITS = [
  'Unlimited AI chat with Finni',
  'Personalized AI insights & coaching',
  'Daily & weekly email reports',
  'Smart Budget (auto 50/30/20)',
  'Recurring transactions & bills',
  'Investments & net worth tracking',
  'Export to CSV / PDF & Google Sheets',
  'Multi-currency',
];

function Check() {
  return (
    <View style={s.check}>
      <Text style={s.checkMark}>✓</Text>
    </View>
  );
}

export default function PaywallScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { refreshProfile } = useProfile();
  const feature: ProFeature | undefined = route.params?.feature;
  const [plan, setPlan] = useState<PlanId>('annual');
  const [busy, setBusy] = useState(false);

  const close = () => (navigation.canGoBack() ? navigation.goBack() : null);

  const onSubscribe = async () => {
    setBusy(true);
    const res = await purchasePlan(plan);
    setBusy(false);
    if (res.ok && res.isPro) {
      await refreshProfile();
      close();
      return;
    }
    if (res.reason === 'cancelled') return;
    Alert.alert('Finni Pro', res.message ?? 'Could not complete the purchase. Please try again.');
  };

  const onRestore = async () => {
    setBusy(true);
    const res = await restorePurchases();
    setBusy(false);
    if (res.ok && res.isPro) {
      await refreshProfile();
      close();
      return;
    }
    Alert.alert('Restore purchases', res.message ?? 'No previous purchase found.');
  };

  return (
    <View style={s.container}>
      <Aurora width={width} height={height} />
      <ScrollView
        contentContainerStyle={[s.scroll, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 28 }]}
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity style={s.close} onPress={close} hitSlop={12}>
          <Text style={s.closeX}>✕</Text>
        </TouchableOpacity>

        <View style={s.hero}>
          <Text style={[s.badge, { fontFamily: fonts.bold }]}>FINNI PRO</Text>
          <Text style={[s.title, { fontFamily: fonts.extraBold }]}>
            {feature ? PRO_FEATURE_COPY[feature].title : 'Your money, on autopilot'}
          </Text>
          <Text style={[s.subtitle, { fontFamily: fonts.regular }]}>
            {feature ? PRO_FEATURE_COPY[feature].blurb : 'Unlock the full coach and every automation.'}
          </Text>
        </View>

        <GlassCard style={s.benefitsCard} borderRadius={t.rLg} intensity={22}>
          {BENEFITS.map((b) => (
            <View key={b} style={s.benefitRow}>
              <Check />
              <Text style={[s.benefitText, { fontFamily: fonts.medium }]}>{b}</Text>
            </View>
          ))}
        </GlassCard>

        {/* Plan selector */}
        <View style={s.plans}>
          <PlanCard
            selected={plan === 'annual'}
            onPress={() => setPlan('annual')}
            title="Annual"
            price={PRICING.annual.price}
            per="/year"
            note={PRICING.annual.note}
          />
          <PlanCard
            selected={plan === 'monthly'}
            onPress={() => setPlan('monthly')}
            title="Monthly"
            price={PRICING.monthly.price}
            per="/month"
          />
        </View>

        <TouchableOpacity activeOpacity={0.9} onPress={onSubscribe} disabled={busy}>
          <LinearGradient colors={gradients.cta} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.cta}>
            {busy ? (
              <ActivityIndicator color="#0b0a1a" />
            ) : (
              <Text style={[s.ctaText, { fontFamily: fonts.bold }]}>
                {plan === 'annual' ? `Start Pro · ${PRICING.annual.price}/yr` : `Start Pro · ${PRICING.monthly.price}/mo`}
              </Text>
            )}
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity onPress={onRestore} disabled={busy} style={s.restore}>
          <Text style={[s.restoreText, { fontFamily: fonts.medium }]}>Restore purchases</Text>
        </TouchableOpacity>

        <Text style={[s.fine, { fontFamily: fonts.regular }]}>
          Free includes {FREE_AI_LIMIT} AI actions/month. Cancel anytime. Subscriptions renew
          automatically unless turned off at least 24h before the period ends.
        </Text>
      </ScrollView>
    </View>
  );
}

function PlanCard({
  selected, onPress, title, price, per, note,
}: { selected: boolean; onPress: () => void; title: string; price: string; per: string; note?: string }) {
  return (
    <TouchableOpacity style={s.planWrap} onPress={onPress} activeOpacity={0.85}>
      <View style={[s.plan, selected && s.planActive]}>
        {note ? (
          <View style={s.planNote}>
            <Text style={[s.planNoteText, { fontFamily: fonts.bold }]}>{note}</Text>
          </View>
        ) : null}
        <Text style={[s.planTitle, { fontFamily: fonts.semiBold }]}>{title}</Text>
        <Text style={[s.planPrice, { fontFamily: fonts.extraBold }]}>{price}</Text>
        <Text style={[s.planPer, { fontFamily: fonts.regular }]}>{per}</Text>
      </View>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: t.auraBg },
  scroll: { paddingHorizontal: 22 },
  close: { alignSelf: 'flex-end', width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)' },
  closeX: { fontSize: 16, color: t.text2 },
  hero: { alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 20 },
  badge: { fontSize: 12, color: t.auraAqua, letterSpacing: 1.5 },
  title: { fontSize: 26, color: t.text, textAlign: 'center', letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: t.text2, textAlign: 'center', lineHeight: 21, paddingHorizontal: 8 },
  benefitsCard: { padding: 18, gap: 12 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  check: { width: 22, height: 22, borderRadius: 11, backgroundColor: t.greenTint, alignItems: 'center', justifyContent: 'center' },
  checkMark: { fontSize: 13, color: t.green, fontWeight: '700' },
  benefitText: { fontSize: 14, color: t.text, flex: 1 },
  plans: { flexDirection: 'row', gap: 12, marginTop: 20 },
  planWrap: { flex: 1 },
  plan: { borderRadius: t.rLg, borderWidth: 1.5, borderColor: t.glassLine, backgroundColor: 'rgba(255,255,255,0.04)', paddingVertical: 18, paddingHorizontal: 14, alignItems: 'center', gap: 2 },
  planActive: { borderColor: t.auraAqua, backgroundColor: 'rgba(94,234,212,0.10)' },
  planNote: { position: 'absolute', top: -10, backgroundColor: t.auraAqua, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  planNoteText: { fontSize: 10, color: '#06231f', letterSpacing: 0.3 },
  planTitle: { fontSize: 14, color: t.text2, marginTop: 4 },
  planPrice: { fontSize: 24, color: t.text, letterSpacing: -0.5 },
  planPer: { fontSize: 12, color: t.text3 },
  cta: { borderRadius: t.rMd, paddingVertical: 17, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  ctaText: { fontSize: 16, color: '#0b0a1a' },
  restore: { alignSelf: 'center', paddingVertical: 14 },
  restoreText: { fontSize: 13, color: t.text2 },
  fine: { fontSize: 11, color: t.text3, textAlign: 'center', lineHeight: 16, paddingHorizontal: 8 },
});
