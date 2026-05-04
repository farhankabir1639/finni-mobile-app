import React, { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Modal } from 'react-native';
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

  const handleSignOut = async () => {
    try {
      await signOut();
    } catch (error) {
      console.warn('Sign out failed:', error);
    }
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
