import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, Switch, ActivityIndicator, Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { t, fonts } from '../../theme/tokens';
import { styles } from './settingsStyles';
import Aurora from '../../components/Aurora';
import GlassCard from '../../components/GlassCard';

type EmailFrequency = 'off' | 'daily' | 'weekly';

interface Props {
  userId: string;
  userEmail: string;
  onClose: () => void;
}

const FREQ_OPTIONS: { value: EmailFrequency; label: string; desc: string }[] = [
  { value: 'off',    label: 'Off',    desc: 'No emails' },
  { value: 'daily',  label: 'Daily',  desc: 'Every morning' },
  { value: 'weekly', label: 'Weekly', desc: 'Every Monday' },
];

export default function NotificationsModal({ userId, userEmail, onClose }: Props) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [emailFreq, setEmailFreq]     = useState<EmailFrequency>('off');
  const [pushEnabled, setPushEnabled] = useState(true);

  useEffect(() => {
    supabase
      .from('profiles')
      .select('email_insights, push_enabled')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (data) {
          setEmailFreq((data.email_insights as EmailFrequency) ?? 'off');
          setPushEnabled(data.push_enabled ?? true);
        }
        setLoading(false);
      });
  }, [userId]);

  const save = useCallback(
    async (field: 'email_insights' | 'push_enabled', value: string | boolean) => {
      setSaving(true);
      const { error } = await supabase
        .from('profiles')
        .update({ [field]: value })
        .eq('id', userId);
      setSaving(false);
      if (error) Alert.alert('Error', 'Could not save preference. Please try again.');
    },
    [userId]
  );

  const handleEmailChange = (freq: EmailFrequency) => {
    setEmailFreq(freq);
    save('email_insights', freq);
  };

  const handlePushToggle = (val: boolean) => {
    setPushEnabled(val);
    save('push_enabled', val);
  };

  return (
    <View style={styles.modalRoot}>
      <Aurora width={400} height={800} />
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle}>Notifications</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.7}>
          <Text style={styles.closeBtnText}>✕</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.modalLoading}>
          <ActivityIndicator color={t.auraAqua} />
        </View>
      ) : (
        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>

          {/* Email Insights */}
          <GlassCard style={StyleSheet.flatten([styles.formCard, { marginBottom: 20 }]) as ViewStyle}>
            <View style={n.sectionHead}>
              <Text style={n.sectionIcon}>📧</Text>
              <View style={{ flex: 1 }}>
                <Text style={n.sectionTitle}>Email Insights</Text>
                <Text style={n.sectionSub}>
                  Personalized financial summaries sent to {userEmail}
                </Text>
              </View>
            </View>

            <View style={n.chipRow}>
              {FREQ_OPTIONS.map(opt => {
                const active = emailFreq === opt.value;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    style={[n.chip, active && n.chipActive]}
                    onPress={() => handleEmailChange(opt.value)}
                    activeOpacity={0.75}
                  >
                    <Text style={[n.chipLabel, active && n.chipLabelActive]}>{opt.label}</Text>
                    <Text style={[n.chipDesc, active && n.chipDescActive]}>{opt.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {emailFreq !== 'off' && (
              <View style={n.infoBanner}>
                <Text style={n.infoText}>
                  {emailFreq === 'daily'
                    ? '📬 You\'ll receive a daily snapshot every morning with your spending summary and AI tips.'
                    : '📬 You\'ll receive a weekly summary every Monday covering last week\'s finances.'}
                </Text>
              </View>
            )}
          </GlassCard>

          {/* Push Notifications */}
          <GlassCard style={styles.formCard}>
            <View style={n.pushRow}>
              <View style={n.sectionHead}>
                <Text style={n.sectionIcon}>🔔</Text>
                <View style={{ flex: 1 }}>
                  <Text style={n.sectionTitle}>Push Notifications</Text>
                  <Text style={n.sectionSub}>
                    Budget alerts, spending nudges, and weekly summaries
                  </Text>
                </View>
              </View>
              <Switch
                value={pushEnabled}
                onValueChange={handlePushToggle}
                trackColor={{ false: t.surface3, true: t.auraIndigo }}
                thumbColor={pushEnabled ? t.auraAqua : t.text3}
              />
            </View>

            {pushEnabled && (
              <View style={n.nudgeList}>
                {[
                  '⚠️  Budget nearly full for a category',
                  '📊  Weekly spending summary (Monday)',
                  '🎯  Goal milestone reached',
                  '👋  Daily check-in if you haven\'t opened the app',
                ].map(item => (
                  <Text key={item} style={n.nudgeItem}>{item}</Text>
                ))}
              </View>
            )}
          </GlassCard>

          {saving && (
            <View style={n.savingRow}>
              <ActivityIndicator size="small" color={t.auraAqua} />
              <Text style={n.savingText}>Saving…</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

import { StyleSheet, ViewStyle } from 'react-native';

const n = StyleSheet.create({
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 16,
  },
  sectionIcon: { fontSize: 22, marginTop: 1 },
  sectionTitle: {
    fontSize: 16,
    fontFamily: fonts.semiBold,
    color: t.text,
    marginBottom: 3,
  },
  sectionSub: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: t.text3,
    lineHeight: 19,
  },

  chipRow: { flexDirection: 'row', gap: 8 },
  chip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 11,
    borderRadius: t.rMd,
    backgroundColor: t.glass,
    borderWidth: 1,
    borderColor: t.glassLine,
  },
  chipActive: {
    backgroundColor: t.indigoTint,
    borderColor: t.lineIndigo,
  },
  chipLabel: {
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: t.text2,
    marginBottom: 2,
  },
  chipLabelActive: { color: t.indigoBright },
  chipDesc: { fontSize: 11, fontFamily: fonts.regular, color: t.text3 },
  chipDescActive: { color: t.text2 },

  infoBanner: {
    marginTop: 14,
    padding: 12,
    paddingHorizontal: 14,
    borderRadius: t.rMd,
    backgroundColor: t.indigoTint,
    borderWidth: 1,
    borderColor: t.lineIndigo,
  },
  infoText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: t.text2,
    lineHeight: 20,
  },

  pushRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  nudgeList: {
    marginTop: 14,
    gap: 9,
  },
  nudgeItem: {
    fontSize: 13.5,
    fontFamily: fonts.regular,
    color: t.text2,
    lineHeight: 20,
  },

  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    justifyContent: 'center',
    marginTop: 12,
  },
  savingText: {
    fontSize: 13,
    fontFamily: fonts.medium,
    color: t.text3,
  },
});
