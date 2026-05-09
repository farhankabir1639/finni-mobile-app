import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal, Linking, Alert, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';

const PRIVACY_URL = 'https://www.heyfinni.com/privacy-policy';
const DATA_DELETION_URL = 'https://www.heyfinni.com/data-deletion';
const SUPPORT_EMAIL = 'support@heyfinni.com';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { colors } from '../lib/theme';
import { styles } from './settings/settingsStyles';
import CategoriesModal from './settings/CategoriesModal';
import EditProfileModal from './settings/EditProfileModal';
import CurrencyModal from './settings/CurrencyModal';
import IncomeModal from './settings/IncomeModal';
import GoalsModal from './settings/GoalsModal';

function getInitial(name: string | null | undefined): string {
  if (!name?.trim()) return '?';
  const first = name.trim().charAt(0).toUpperCase();
  return first || '?';
}

export default function SettingsScreen() {
  const navigation = useNavigation();
  const { user, signOut } = useAuth();
  const { profile, refreshProfile } = useProfile();
  const [categoriesModalVisible, setCategoriesModalVisible] = useState(false);
  const [goalsModalVisible, setGoalsModalVisible] = useState(false);
  const [editProfileVisible, setEditProfileVisible] = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [incomeModalVisible, setIncomeModalVisible] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.warn('Sign out failed:', error);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account & Data',
      'This will permanently delete your account, all transactions, income records, goals, and categories. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete Permanently',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Are you absolutely sure?',
              'Type "DELETE" to confirm — this action is irreversible.',
              [
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
                      console.error('[Settings] Delete account error:', e);
                      setDeletingAccount(false);
                      Alert.alert('Error', 'Could not delete account. Please contact support@heyfinni.com');
                    }
                  },
                },
              ]
            );
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
              k.startsWith(`insights_user_prompt_${user.id}`)
            );
            await AsyncStorage.multiRemove(appKeys);
            Alert.alert('Done', 'Local cache cleared.');
          },
        },
      ]
    );
  };

  const displayName = profile.name?.trim() || 'User';
  const email = user?.email ?? '';

  const SettingItem = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <TouchableOpacity style={styles.item} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.itemText}>{label}</Text>
      <Text style={styles.chevron}>→</Text>
    </TouchableOpacity>
  );

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <View style={styles.section}>
      <Text style={styles.sectionHeader}>{title}</Text>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={styles.backButton}>
          <Text style={styles.backButtonText}>‹</Text>
        </TouchableOpacity>
      </View>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitial(profile.name)}</Text>
          </View>
          <Text style={styles.profileName}>{displayName}</Text>
          <Text style={styles.profileEmail}>{email}</Text>
        </View>

        <Section title="My Account">
          <SettingItem label="Edit Profile" onPress={() => setEditProfileVisible(true)} />
          <SettingItem label="Currency" onPress={() => setCurrencyModalVisible(true)} />
          <SettingItem label="Income" onPress={() => setIncomeModalVisible(true)} />
        </Section>

        <Section title="Finance">
          <SettingItem label="Categories" onPress={() => setCategoriesModalVisible(true)} />
          <SettingItem label="Goals" onPress={() => setGoalsModalVisible(true)} />
        </Section>

        <Section title="Legal & Support">
          <SettingItem label="Privacy Policy" onPress={() => Linking.openURL(PRIVACY_URL)} />
          <SettingItem label="Contact Support" onPress={() => Linking.openURL(`mailto:${SUPPORT_EMAIL}`)} />
          <SettingItem label="Clear Cached Data" onPress={handleClearCache} />
        </Section>

        <Section title="Danger Zone">
          <TouchableOpacity
            style={[styles.item, { borderColor: '#EF4444' }]}
            onPress={handleDeleteAccount}
            activeOpacity={0.7}
            disabled={deletingAccount}
          >
            {deletingAccount
              ? <ActivityIndicator size="small" color="#EF4444" />
              : <Text style={[styles.itemText, { color: '#EF4444' }]}>Delete Account & All Data</Text>}
          </TouchableOpacity>
        </Section>

        <View style={{ paddingHorizontal: 4, marginBottom: 16 }}>
          <Text style={{ fontSize: 11, color: '#4B5563', lineHeight: 16 }}>
            ⚠️ Finni provides financial tracking tools and AI-generated suggestions for informational purposes only. Nothing in this app constitutes financial, investment, or legal advice. Always consult a qualified professional before making financial decisions.
          </Text>
        </View>

        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut} activeOpacity={0.8}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={categoriesModalVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setCategoriesModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#0A0F1E' }}>
          <CategoriesModal userId={user?.id ?? ''} onClose={() => setCategoriesModalVisible(false)} />
        </View>
      </Modal>

      <Modal visible={goalsModalVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setGoalsModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#0A0F1E' }}>
          <GoalsModal userId={user?.id ?? ''} onClose={() => setGoalsModalVisible(false)} />
        </View>
      </Modal>

      <Modal visible={editProfileVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setEditProfileVisible(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <EditProfileModal
            userId={user?.id ?? ''}
            currentName={profile.name}
            onClose={() => setEditProfileVisible(false)}
            onSave={async () => { await refreshProfile(); setEditProfileVisible(false); }}
          />
        </View>
      </Modal>

      <Modal visible={currencyModalVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setCurrencyModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <CurrencyModal
            userId={user?.id ?? ''}
            currentCurrency={profile.currency}
            onClose={() => setCurrencyModalVisible(false)}
            onSave={async () => { await refreshProfile(); setCurrencyModalVisible(false); }}
          />
        </View>
      </Modal>

      <Modal visible={incomeModalVisible} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setIncomeModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: '#0A0F1E' }}>
          <IncomeModal userId={user?.id ?? ''} onClose={() => setIncomeModalVisible(false)} />
        </View>
      </Modal>
    </SafeAreaView>
  );
}
