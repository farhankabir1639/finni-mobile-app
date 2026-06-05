import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Linking, Alert, ActivityIndicator, Dimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { trackScreen } from '../lib/analytics';
import { LinearGradient } from 'expo-linear-gradient';

const PRIVACY_URL = 'https://www.heyfinni.com/privacy-policy';
const DATA_DELETION_URL = 'https://www.heyfinni.com/data-deletion';
const SUPPORT_EMAIL = 'support@heyfinni.com';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { t, fonts } from '../theme/tokens';
import { styles } from './settings/settingsStyles';
import Aurora from '../components/Aurora';
import GlassCard from '../components/GlassCard';
import CategoriesModal from './settings/CategoriesModal';
import EditProfileModal from './settings/EditProfileModal';
import CurrencyModal from './settings/CurrencyModal';
import IncomeModal from './settings/IncomeModal';
import GoalsModal from './settings/GoalsModal';

const { width: SW, height: SH } = Dimensions.get('window');

function getInitial(name: string | null | undefined): string {
  if (!name?.trim()) return '?';
  return name.trim().charAt(0).toUpperCase() || '?';
}

type RowProps = {
  label: string;
  icon: string;
  color?: string;
  danger?: boolean;
  onPress: () => void;
  loading?: boolean;
};

function SettingsRow({ label, icon, color, danger, onPress, loading }: RowProps) {
  const iconBg = danger ? t.redTint : (color ? color + '24' : t.indigoTint);
  const iconColor = danger ? t.red : (color || t.indigoBright);
  return (
    <TouchableOpacity
      style={[styles.row, danger && styles.rowDanger]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={loading}
    >
      <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
        {loading ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <Text style={{ fontSize: 19, color: iconColor }}>{icon}</Text>
        )}
      </View>
      <Text style={[styles.rowLabel, danger && { color: t.red }]}>{label}</Text>
      <Text style={styles.rowChevron}>→</Text>
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const { user, signOut } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const [categoriesModalVisible, setCategoriesModalVisible] = useState(false);
  const [goalsModalVisible, setGoalsModalVisible] = useState(false);
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [incomeModalVisible, setIncomeModalVisible] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const handleSignOut = () => {
    Alert.alert(
      'Sign out of Finni?',
      "You'll need to sign in again to access your finances.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: async () => { try { await signOut(); } catch {} } },
      ]
    );
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete account & all data?',
      'This permanently erases your account, transactions, budgets and goals. This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Everything',
          style: 'destructive',
          onPress: () => {
            Alert.alert('Are you absolutely sure?', 'This action is irreversible.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Yes, Delete Everything',
                style: 'destructive',
                onPress: async () => {
                  if (!user?.id) return;
                  setDeletingAccount(true);
                  try {
                    await Promise.all([
                      supabase.from('transactions').delete().eq('user_id', user.id),
                      supabase.from('categories').delete().eq('user_id', user.id),
                      supabase.from('financial_goals').delete().eq('user_id', user.id),
                      supabase.from('income').delete().eq('user_id', user.id),
                    ]);
                    await supabase.from('profiles').delete().eq('id', user.id);
                    const keys = await AsyncStorage.getAllKeys();
                    const appKeys = keys.filter((k) => k.includes(user.id));
                    if (appKeys.length) await AsyncStorage.multiRemove(appKeys);
                    await signOut();
                  } catch (e) {
                    if (__DEV__) console.error('[Settings] Delete account error:', e);
                    setDeletingAccount(false);
                    Alert.alert('Error', 'Could not delete account. Please contact support@heyfinni.com');
                  }
                },
              },
            ]);
          },
        },
      ]
    );
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Cached Data',
      'This will clear locally cached chat history, AI insights, and analytics. Your transactions and account data are not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: async () => {
            if (!user?.id) return;
            const keys = await AsyncStorage.getAllKeys();
            const appKeys = keys.filter((k) =>
              k.startsWith(`chat_sessions_${user.id}`) ||
              k.startsWith(`insights_${user.id}`) ||
              k.startsWith(`analytics_cache_${user.id}`) ||
              k.startsWith(`savings_${user.id}`) ||
              k.startsWith(`insights_user_prompt_${user.id}`) ||
              k.startsWith(`image_tx_used_${user.id}`)
            );
            await AsyncStorage.multiRemove(appKeys);
            Alert.alert('Done', 'Local cache cleared.');
          },
        },
      ]
    );
  };

  useFocusEffect(useCallback(() => { trackScreen('SettingsScreen'); }, []));

  const displayName = profile.name?.trim() || 'User';
  const email = user?.email ?? '';

  return (
    <View style={styles.root}>
      <Aurora width={SW} height={SH} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
        </View>

        {/* Profile card */}
        <GlassCard style={styles.profileCard}>
          <LinearGradient
            colors={['#c4b5fd', t.auraViolet, t.auraIndigo]}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>{getInitial(profile.name)}</Text>
          </LinearGradient>
          <Text style={styles.profileName}>{displayName}</Text>
          <Text style={styles.profileEmail}>{email}</Text>
        </GlassCard>

        {/* My Account */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>My Account</Text>
          <SettingsRow label="Edit Profile" icon="👤" onPress={() => setEditProfileVisible(true)} />
          <SettingsRow label="Currency" icon="💰" color={t.green} onPress={() => setCurrencyModalVisible(true)} />
          <SettingsRow label="Income" icon="👛" color={t.green} onPress={() => setIncomeModalVisible(true)} />
        </View>

        {/* Finance */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Finance</Text>
          <SettingsRow label="Categories" icon="🏷️" color={t.catShopping} onPress={() => setCategoriesModalVisible(true)} />
          <SettingsRow label="Goals" icon="🎯" color={t.cyan} onPress={() => setGoalsModalVisible(true)} />
        </View>

        {/* Legal & Support */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Legal & Support</Text>
          <SettingsRow label="Privacy Policy" icon="🛡️" color={t.text2} onPress={() => Linking.openURL(PRIVACY_URL)} />
          <SettingsRow label="Contact Support" icon="🎧" color={t.text2} onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
          <SettingsRow label="Clear Cached Data" icon="🔄" color={t.text2} onPress={handleClearCache} />
        </View>

        {/* Danger Zone */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Danger Zone</Text>
          <SettingsRow
            label="Delete Account & All Data"
            icon="🗑️"
            danger
            onPress={handleDeleteAccount}
            loading={deletingAccount}
          />
        </View>

        {/* Disclaimer */}
        <View style={styles.disclaimer}>
          <Text style={{ fontSize: 16, color: t.amber }}>⚠️</Text>
          <Text style={styles.disclaimerText}>
            Finni provides financial tracking tools and AI-generated suggestions for informational purposes only. Nothing in this app constitutes financial, investment, or legal advice.
          </Text>
        </View>

        {/* Sign Out */}
        <TouchableOpacity activeOpacity={0.8} onPress={handleSignOut}>
          <LinearGradient
            colors={[t.red, t.redDeep]}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
            style={styles.signOutBtn}
          >
            <Text style={{ fontSize: 18 }}>🚪</Text>
            <Text style={styles.signOutText}>Sign Out</Text>
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>

      {/* Modals */}
      <Modal visible={categoriesModalVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setCategoriesModalVisible(false)}>
        <CategoriesModal userId={user?.id ?? ''} onClose={() => setCategoriesModalVisible(false)} />
      </Modal>

      <Modal visible={goalsModalVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setGoalsModalVisible(false)}>
        <GoalsModal userId={user?.id ?? ''} onClose={() => setGoalsModalVisible(false)} />
      </Modal>

      <Modal visible={editProfileVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setEditProfileVisible(false)}>
        <EditProfileModal
          userId={user?.id ?? ''}
          currentName={profile.name}
          onClose={() => setEditProfileVisible(false)}
          onSave={async () => { await refreshProfile(); setEditProfileVisible(false); }}
        />
      </Modal>

      <Modal visible={currencyModalVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setCurrencyModalVisible(false)}>
        <CurrencyModal
          userId={user?.id ?? ''}
          currentCurrency={profile.currency}
          onClose={() => setCurrencyModalVisible(false)}
          onSave={async () => { await refreshProfile(); setCurrencyModalVisible(false); }}
        />
      </Modal>

      <Modal visible={incomeModalVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setIncomeModalVisible(false)}>
        <IncomeModal userId={user?.id ?? ''} onClose={() => setIncomeModalVisible(false)} />
      </Modal>
    </View>
  );
}
