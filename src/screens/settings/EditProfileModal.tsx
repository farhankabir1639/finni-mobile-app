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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!userId) return;
    supabase
      .from('profiles')
      .select('name')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) setName((data as any).name ?? '');
      });
  }, [userId]);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({ name: name.trim() })
      .eq('id', userId);
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
        <TextInput
          style={styles.formInput}
          placeholder="Your name"
          placeholderTextColor={colors.textSecondary}
          value={name}
          onChangeText={setName}
        />
        <Text style={[styles.formLabel, { color: colors.textSecondary, fontSize: 12, marginTop: 8 }]}>
          Monthly budget is calculated automatically from your income in Settings → Income.
        </Text>
        <TouchableOpacity style={[styles.saveButton, { marginTop: 24 }]} onPress={handleSave} disabled={saving}>
          {saving ? <ActivityIndicator size="small" color={colors.textPrimary} /> : <Text style={styles.saveButtonText}>Save Changes</Text>}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
