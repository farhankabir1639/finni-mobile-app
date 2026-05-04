import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CURRENCIES } from '../../contexts/ProfileContext';
import { supabase } from '../../lib/supabase';
import { clearAgentCache } from '../../lib/agents';
import { colors } from '../../lib/theme';
import { styles } from './settingsStyles';

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
    if (error) {
      Alert.alert('Error', `Could not save currency: ${error.message}`);
      return;
    }
    // Bust cached AI insights so the next Analytics visit regenerates them with the new currency
    await clearAgentCache(userId).catch(() => {});
    await onSave();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalHeaderTitle}>Currency</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.modalScroll} contentContainerStyle={[styles.modalScrollContent, { paddingTop: 16 }]}>
        {CURRENCIES.map((c) => {
          const active = selected === c.code;
          return (
            <TouchableOpacity key={c.code} style={[styles.currencyItem, active && styles.currencyItemActive]} onPress={() => setSelected(c.code)} activeOpacity={0.8}>
              <View style={styles.currencyItemLeft}>
                <Text style={[styles.currencySymbol, active && styles.currencySymbolActive]}>{c.symbol}</Text>
                <View>
                  <Text style={[styles.currencyCode, active && styles.currencyCodeActive]}>{c.code}</Text>
                  <Text style={styles.currencyName}>{c.name}</Text>
                </View>
              </View>
              {active && <Text style={styles.currencyCheck}>✓</Text>}
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity style={[styles.saveButton, { marginTop: 24 }]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Text style={styles.saveButtonText}>Save Currency</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
