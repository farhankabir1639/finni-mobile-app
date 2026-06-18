import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Dimensions, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getOrCreateForwardingAlias } from '../../lib/emailCapture';
import { t, fonts } from '../../theme/tokens';
import { styles } from './settingsStyles';
import Aurora from '../../components/Aurora';
import GlassCard from '../../components/GlassCard';
import { StyleSheet } from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const Clipboard = await import('expo-clipboard');
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    return false; // expo-clipboard not installed — alias is still selectable on screen
  }
}

export default function AutoImportModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [alias, setAlias] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) return;
    getOrCreateForwardingAlias(userId).then((a) => { setAlias(a); setLoading(false); });
  }, [userId]);

  const onCopy = async () => {
    if (!alias) return;
    const done = await copyToClipboard(alias);
    Alert.alert(done ? 'Copied' : 'Your address', done ? 'Forwarding address copied to clipboard.' : alias);
  };

  return (
    <View style={styles.modalRoot}>
      <Aurora width={SW} height={SH} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Auto-import</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}><Text style={styles.closeBtnText}>✕</Text></TouchableOpacity>
        </View>

        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
          <Text style={s.lead}>
            Forward your bank or mobile-money (bKash, Nagad…) transaction emails to your private Finni address, and
            Finni will read the amount and category for you to confirm in the Review inbox.
          </Text>

          {loading ? (
            <View style={{ paddingVertical: 30 }}><ActivityIndicator size="large" color={t.auraAqua} /></View>
          ) : alias ? (
            <>
              <Text style={s.label}>Your forwarding address</Text>
              <GlassCard style={s.aliasCard}>
                <Text style={s.alias} selectable>{alias}</Text>
              </GlassCard>
              <TouchableOpacity style={s.copyBtn} onPress={onCopy} activeOpacity={0.85}>
                <Text style={s.copyTxt}>Copy address</Text>
              </TouchableOpacity>

              <Text style={s.label}>How to set it up</Text>
              <View style={s.steps}>
                <Text style={s.step}>1. Open Gmail (web or app) → Settings → Filters → Create a new filter.</Text>
                <Text style={s.step}>2. In “From”, add your bank / bKash / Nagad sender address.</Text>
                <Text style={s.step}>3. Choose “Forward to” and add the address above.</Text>
                <Text style={s.step}>4. Done — new transaction emails show up in your Review inbox to confirm.</Text>
              </View>

              <Text style={s.privacy}>
                Finni only reads forwarded emails, filters out anything that isn’t a transaction, and strips one-time
                codes. Nothing is added to your ledger until you accept it. Stop anytime by removing the filter.
              </Text>
            </>
          ) : (
            <Text style={s.lead}>Couldn’t set up your address right now. Please try again.</Text>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  lead: { fontSize: 14, fontFamily: fonts.regular, color: t.text2, lineHeight: 21, marginBottom: 22 },
  label: { fontSize: 12, fontFamily: fonts.semiBold, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8, marginTop: 6 },
  aliasCard: { padding: 16 },
  alias: { fontSize: 15, fontFamily: fonts.semiBold, color: t.auraAqua },
  copyBtn: { marginTop: 10, alignSelf: 'flex-start', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: t.auraIndigo },
  copyTxt: { fontSize: 13, fontFamily: fonts.semiBold, color: t.auraIndigo },
  steps: { gap: 10, marginBottom: 22 },
  step: { fontSize: 14, fontFamily: fonts.regular, color: t.text2, lineHeight: 20 },
  privacy: { fontSize: 12.5, fontFamily: fonts.regular, color: t.text3, lineHeight: 19, marginBottom: 20 },
});
