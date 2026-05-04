import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { colors } from '../../lib/theme';
import { styles } from './settingsStyles';

export default function EditProfileModal({
  userId,
  currentName,
  onClose,
  onSave,
}: {
  userId: string;
  currentName: string | null;
  onClose: () => void;
  onSave: () => Promise<void>;
}) {
  const [name, setName] = useState(currentName ?? '');
  const [monthlyBudget, setMonthlyBudget] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('profiles')
      .select('name, monthly_budget, location')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setName((data as any).name ?? '');
          setMonthlyBudget(String((data as any).monthly_budget ?? '') || '');
          setLocation((data as any).location ?? '');
        }
      });
  }, [userId]);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    const payload: Record<string, unknown> = { name: name.trim(), location: location.trim() };
    const budget = parseFloat(monthlyBudget);
    if (!isNaN(budget) && budget >= 0) payload.monthly_budget = budget;
    const { error } = await supabase.from('profiles').update(payload).eq('id', userId);
    setSaving(false);
    if (error) {
      Alert.alert('Error', `Could not save profile: ${error.message}`);
      return;
    }
    Alert.alert('Saved', 'Profile updated successfully.');
    await onSave();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalHeaderTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.modalScroll} contentContainerStyle={[styles.modalScrollContent, { paddingTop: 24 }]}>
        <Text style={styles.formLabel}>Display Name</Text>
        <TextInput style={styles.formInput} placeholder="Your name" placeholderTextColor={colors.textSecondary} value={name} onChangeText={setName} />
        <Text style={styles.formLabel}>Location</Text>
        <TextInput style={styles.formInput} placeholder="e.g. Dhaka, Bangladesh" placeholderTextColor={colors.textSecondary} value={location} onChangeText={setLocation} />
        <Text style={styles.formLabel}>Monthly Budget</Text>
        <TextInput style={styles.formInput} placeholder="e.g. 1500" placeholderTextColor={colors.textSecondary} value={monthlyBudget} onChangeText={setMonthlyBudget} keyboardType="decimal-pad" />
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
