import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Alert, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CURRENCIES } from '../../contexts/ProfileContext';
import { supabase } from '../../lib/supabase';
import { clearAgentCache } from '../../lib/agents';
import { t, fonts } from '../../theme/tokens';
import { styles } from './settingsStyles';
import Aurora from '../../components/Aurora';

const { width: SW, height: SH } = Dimensions.get('window');

export default function CurrencyModal({
  userId,
  currentCurrency,
  onClose,
  onSave,
}: {
  userId: string;
  currentCurrency: string;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const [selected, setSelected] = useState(currentCurrency);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ currency: selected }).eq('id', userId);
    setSaving(false);
    if (error) { Alert.alert('Error', `Could not save currency: ${error.message}`); return; }
    await clearAgentCache(userId).catch(() => {});
    await onSave();
  };

  return (
    <View style={styles.modalRoot}>
      <Aurora width={SW} height={SH} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Currency</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 15, fontFamily: fonts.regular, color: t.text2, paddingHorizontal: 22, marginTop: -6, marginBottom: 16 }}>
          Choose the currency Finni uses across your account.
        </Text>
        <ScrollView style={styles.modalScroll} contentContainerStyle={[styles.modalScrollContent, { paddingBottom: 120 }]} showsVerticalScrollIndicator={false}>
          {CURRENCIES.map((c) => {
            const active = selected === c.code;
            return (
              <TouchableOpacity
                key={c.code}
                style={[styles.currencyItem, active && styles.currencyItemActive]}
                onPress={() => setSelected(c.code)}
                activeOpacity={0.8}
              >
                <View style={styles.currencySymBox}>
                  <Text style={[styles.currencySym, active && styles.currencySymActive]}>{c.symbol}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.currencyCode, active && styles.currencyCodeActive]}>{c.code}</Text>
                  <Text style={styles.currencyName}>{c.name}</Text>
                </View>
                {active && (
                  <View style={styles.currencyCheck}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        {/* Sticky save */}
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 22, paddingTop: 14, paddingBottom: 30, backgroundColor: t.auraBg + 'E6' }}>
          <TouchableOpacity style={styles.btnPrimary} onPress={handleSave} disabled={saving} activeOpacity={0.8}>
            {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPrimaryText}>Save Currency</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}
