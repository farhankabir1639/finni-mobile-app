import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import GlassCard from './GlassCard';
import { t, fonts, gradients } from '../theme/tokens';
import { useEntitlement, PRO_FEATURE_COPY, type ProFeature } from '../lib/entitlements';

// Imperative gate for buttons/handlers: `if (!requirePro('voice')) return;`
// Navigates a free user to the Paywall (with feature context) and returns false.
export function useRequirePro() {
  const { isPro } = useEntitlement();
  const navigation = useNavigation<any>();
  return (feature: ProFeature): boolean => {
    if (isPro) return true;
    navigation.navigate('Paywall', { feature });
    return false;
  };
}

// Wrapping gate for whole sections/screens: renders children for Pro users,
// otherwise a locked card with an upgrade CTA.
export default function ProGate({
  feature,
  children,
}: {
  feature: ProFeature;
  children: React.ReactNode;
}) {
  const { isPro } = useEntitlement();
  const navigation = useNavigation<any>();
  if (isPro) return <>{children}</>;

  const copy = PRO_FEATURE_COPY[feature];
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('Paywall', { feature })}>
      <GlassCard style={s.card} borderRadius={t.rLg} intensity={22}>
        <View style={s.lockRow}>
          <Text style={s.lock}>🔒</Text>
          <Text style={[s.badge, { fontFamily: fonts.semiBold }]}>Pro</Text>
        </View>
        <Text style={[s.title, { fontFamily: fonts.bold }]}>{copy.title}</Text>
        <Text style={[s.blurb, { fontFamily: fonts.regular }]}>{copy.blurb}</Text>
        <LinearGradient
          colors={gradients.cta}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={s.cta}
        >
          <Text style={[s.ctaText, { fontFamily: fonts.bold }]}>Unlock with Pro</Text>
        </LinearGradient>
      </GlassCard>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: { padding: 18, alignItems: 'center', gap: 6 },
  lockRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lock: { fontSize: 13 },
  badge: { fontSize: 12, color: t.auraAqua, letterSpacing: 0.5 },
  title: { fontSize: 17, color: t.text, marginTop: 2 },
  blurb: { fontSize: 13, color: t.text2, textAlign: 'center', lineHeight: 19 },
  cta: { borderRadius: t.rMd, paddingVertical: 12, paddingHorizontal: 28, marginTop: 10 },
  ctaText: { fontSize: 14, color: '#0b0a1a' },
});
