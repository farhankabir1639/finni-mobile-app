import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, TextInput, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { t, fonts } from '../../theme/tokens';
import { styles } from './settingsStyles';
import Aurora from '../../components/Aurora';
import { Dimensions } from 'react-native';

const { width: SW, height: SH } = Dimensions.get('window');

function getInitial(name: string | null | undefined): string {
  if (!name?.trim()) return '?';
  return name.trim().charAt(0).toUpperCase() || '?';
}

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
    supabase.from('profiles').select('name').eq('id', userId).maybeSingle()
      .then(({ data }) => { if (data) setName((data as { name?: string }).name ?? ''); });
  }, [userId]);

  const handleSave = async () => {
    if (!userId) return;
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ name: name.trim() }).eq('id', userId);
    setSaving(false);
    if (error) { Alert.alert('Error', `Could not save profile: ${error.message}`); return; }
    Alert.alert('Saved', 'Profile updated successfully.');
    await onSave();
  };

  return (
    <View style={styles.modalRoot}>
      <Aurora width={SW} height={SH} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Edit Profile</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>✕</Text>
          </TouchableOpacity>
        </View>
        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
          {/* Avatar */}
          <View style={{ alignItems: 'center', marginBottom: 26 }}>
            <LinearGradient
              colors={['#c4b5fd', t.auraViolet, t.auraIndigo]}
              start={{ x: 0.2, y: 0 }}
              end={{ x: 0.8, y: 1 }}
              style={{ width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ fontSize: 30, fontFamily: fonts.bold, fontWeight: '700', color: '#fff' }}>
                {getInitial(name || currentName)}
              </Text>
            </LinearGradient>
          </View>

          <Text style={styles.formLabel}>Display Name</Text>
          <TextInput
            style={[styles.formInput, styles.formInputBig]}
            placeholder="Your name"
            placeholderTextColor={t.text3}
            value={name}
            onChangeText={setName}
          />

          {/* Info box */}
          <View style={styles.infoBox}>
            <Text style={{ fontSize: 18 }}>✨</Text>
            <Text style={styles.infoBoxText}>
              Monthly budget is calculated automatically from your income. Update it in{' '}
              <Text style={styles.infoBoxHighlight}>Settings → Income</Text>.
            </Text>
          </View>

          {/* Save */}
          <TouchableOpacity
            style={[styles.btnPrimary, { marginTop: 24, flexDirection: 'row', gap: 8, justifyContent: 'center' }]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Text style={{ fontSize: 16 }}>✓</Text>
                <Text style={styles.btnPrimaryText}>Save Changes</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
