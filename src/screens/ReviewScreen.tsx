import React from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import Aurora from '../components/Aurora';
import { t, fonts } from '../theme/tokens';
import { EMAIL_CAPTURE_ENABLED } from '../lib/featureFlags';

function InboxGlyph({ size = 40, color = t.auraAqua }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M22 12h-6l-2 3h-4l-2-3H2" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" stroke={color} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// The Review tab. Auto-capture (email/push) is gated behind EMAIL_CAPTURE_ENABLED;
// until it ships this shows a "coming soon" state. When the flag flips, this is
// where the captured-transaction review queue renders.
export default function ReviewScreen() {
  const { width, height } = useWindowDimensions();

  return (
    <View style={styles.outer}>
      <Aurora width={width} height={height} />
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <Text style={[styles.title, { fontFamily: fonts.bold }]}>Review</Text>
          <Text style={[styles.sub, { fontFamily: fonts.regular }]}>Confirm transactions Finni captures for you</Text>
        </View>

        <View style={styles.center}>
          <View style={styles.iconWrap}>
            <InboxGlyph />
          </View>
          <Text style={[styles.emptyTitle, { fontFamily: fonts.bold }]}>
            {EMAIL_CAPTURE_ENABLED ? 'Nothing to review yet' : 'Auto-import is coming soon'}
          </Text>
          <Text style={[styles.emptySub, { fontFamily: fonts.regular }]}>
            {EMAIL_CAPTURE_ENABLED
              ? 'Forward your bank emails to Finni and captured transactions will appear here to confirm.'
              : "Soon you'll be able to forward your bank & bKash/Nagad emails to Finni — it'll read each transaction for you to approve here. For now, just tell Finni in chat."}
          </Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1, backgroundColor: t.auraBg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 26, color: t.text, letterSpacing: -0.4 },
  sub: { fontSize: 13.5, color: t.text3, marginTop: 3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 14, marginTop: -40 },
  iconWrap: {
    width: 80, height: 80, borderRadius: 24, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(94,234,212,0.10)', borderWidth: 1, borderColor: 'rgba(94,234,212,0.22)',
  },
  emptyTitle: { fontSize: 18, color: t.text, textAlign: 'center' },
  emptySub: { fontSize: 14, color: t.text2, textAlign: 'center', lineHeight: 21 },
});
