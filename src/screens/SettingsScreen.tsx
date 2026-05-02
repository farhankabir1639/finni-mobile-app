import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useProfile, CURRENCIES } from '../contexts/ProfileContext';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';

type Category = {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  color?: string;
  budget: number;
  spent: number;
  type?: string;
};

type Goal = {
  id: string;
  user_id: string;
  name: string;
  target_amount: number;
  current_amount: number;
  target_date: string;
  goal_type?: string;
  category_id?: string | null;
  description?: string;
  status?: string;
};

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

  const SettingItem = ({
    label,
    onPress,
  }: {
    label: string;
    onPress: () => void;
  }) => (
    <TouchableOpacity style={styles.item} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.itemText}>{label}</Text>
      <Text style={styles.chevron}>→</Text>
    </TouchableOpacity>
  );

  const Section = ({
    title,
    children,
  }: {
    title: string;
    children: React.ReactNode;
  }) => (
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
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Profile card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{getInitial(profile.name)}</Text>
          </View>
          <Text style={styles.profileName}>{displayName}</Text>
          <Text style={styles.profileEmail}>{email}</Text>
        </View>

        {/* My Account */}
        <Section title="My Account">
          <SettingItem label="Edit Profile" onPress={() => setEditProfileVisible(true)} />
          <SettingItem label="Currency" onPress={() => setCurrencyModalVisible(true)} />
          <SettingItem label="Income" onPress={() => setIncomeModalVisible(true)} />
        </Section>

        {/* Finance */}
        <Section title="Finance">
          <SettingItem
            label="Categories"
            onPress={() => setCategoriesModalVisible(true)}
          />
          <SettingItem label="Goals" onPress={() => setGoalsModalVisible(true)} />
        </Section>

        {/* Sign Out */}
        <TouchableOpacity
          style={styles.signOutButton}
          onPress={handleSignOut}
          activeOpacity={0.8}
        >
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Categories Modal */}
      <Modal
        visible={categoriesModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setCategoriesModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#0A0F1E' }}>
          <CategoriesModal
            userId={user?.id ?? ''}
            onClose={() => setCategoriesModalVisible(false)}
          />
        </View>
      </Modal>

      {/* Goals Modal */}
      <Modal
        visible={goalsModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setGoalsModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#0A0F1E' }}>
          <GoalsModal
            userId={user?.id ?? ''}
            onClose={() => setGoalsModalVisible(false)}
          />
        </View>
      </Modal>

      {/* Edit Profile Modal */}
      <Modal
        visible={editProfileVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setEditProfileVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <EditProfileModal
            userId={user?.id ?? ''}
            currentName={profile.name}
            onClose={() => setEditProfileVisible(false)}
            onSave={async () => {
              await refreshProfile();
              setEditProfileVisible(false);
            }}
          />
        </View>
      </Modal>

      {/* Currency Modal */}
      <Modal
        visible={currencyModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setCurrencyModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          <CurrencyModal
            userId={user?.id ?? ''}
            currentCurrency={profile.currency}
            onClose={() => setCurrencyModalVisible(false)}
            onSave={async () => {
              await refreshProfile();
              setCurrencyModalVisible(false);
            }}
          />
        </View>
      </Modal>

      {/* Income Modal */}
      <Modal
        visible={incomeModalVisible}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setIncomeModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: '#0A0F1E' }}>
          <IncomeModal
            userId={user?.id ?? ''}
            onClose={() => setIncomeModalVisible(false)}
          />
        </View>
      </Modal>
    </SafeAreaView>
  );
}

type BudgetPeriod = 'daily' | 'weekly' | 'monthly';

function CategoriesModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addEmoji, setAddEmoji] = useState('💰');
  const [addBudget, setAddBudget] = useState('');
  const [addBudgetType, setAddBudgetType] = useState<BudgetPeriod>('monthly');
  const [saving, setSaving] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [editColor, setEditColor] = useState('#6366F1');
  const [updating, setUpdating] = useState(false);

  const EDIT_COLOR_PALETTE = ['#6366F1', '#8B5CF6', '#EC4899', '#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#F97316'];

  const fetchCategories = async () => {
    if (!userId) return;
    const [catResult, txResult] = await Promise.all([
      supabase.from('categories').select('*').eq('user_id', userId),
      supabase.from('transactions').select('category_id, withdrawal, type').eq('user_id', userId),
    ]);

    const cats = (catResult.data ?? []) as Category[];
    const txs = txResult.data ?? [];

    const spentMap: Record<string, number> = {};
    for (const tx of txs) {
      if (tx.type === 'expense' && tx.category_id) {
        spentMap[tx.category_id] = (spentMap[tx.category_id] ?? 0) + (Number(tx.withdrawal) || 0);
      }
    }

    const enriched = cats.map((c) => ({ ...c, spent: spentMap[c.id] ?? 0 }));
    setLoading(false);
    setCategories(enriched);
  };

  useEffect(() => {
    if (!userId) return;
    setLoading(true);

    const subscription = supabase
      .channel('categories-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'categories',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          fetchCategories().catch((e) => {
            console.error('[Categories] Realtime refetch error:', e);
            setLoading(false);
          });
        }
      )
      .subscribe();

    fetchCategories().catch((e) => {
      console.error('[Categories] Initial fetch error:', e);
      setLoading(false);
      setCategories([]);
      supabase.removeChannel(subscription);
    });

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [userId]);

  const handleAddCategory = async () => {
    const name = addName.trim();
    const budgetAmount = parseFloat(addBudget) || 0;
    if (!name || !userId) return;
    setSaving(true);

    const budgetPeriod =
      addBudgetType === 'daily'
        ? 'Daily'
        : addBudgetType === 'weekly'
          ? 'Weekly'
          : 'Monthly';

    const payload = {
      user_id: userId,
      name,
      emoji: addEmoji.trim() || '💰',
      color: '#6366F1',
      spent: 0,
      budget: budgetAmount,
      type: budgetPeriod.toLowerCase(),
    };
    console.log('[Categories] Insert payload:', payload);

    const { data, error } = await supabase.from('categories').insert(payload).select('*');

    setSaving(false);
    if (error) {
      console.warn('Category insert error:', error);
      Alert.alert('Error', `Could not save category: ${error.message}`);
      return;
    }
    console.log('[Categories] Insert success:', data);
    Alert.alert('Success', 'Category added successfully');
    setAddName('');
    setAddEmoji('💰');
    setAddBudget('');
    setAddBudgetType('monthly');
    setShowAddForm(false);
    fetchCategories();
  };

  const handleUpdateCategory = async () => {
    if (!editingCategory || !userId) return;
    const name = editName.trim();
    if (!name) {
      Alert.alert('Error', 'Category name cannot be empty.');
      return;
    }
    setUpdating(true);
    const { error } = await supabase
      .from('categories')
      .update({ name, emoji: editEmoji.trim() || '💰', color: editColor })
      .eq('id', editingCategory.id)
      .eq('user_id', userId);
    setUpdating(false);
    if (error) {
      Alert.alert('Error', `Could not update category: ${error.message || JSON.stringify(error)}`);
      return;
    }
    setEditingCategory(null);
    fetchCategories();
  };

  const handleDeleteCategory = (id: string) => {
    Alert.alert(
      'Delete Category',
      'Deleting this category will mark all linked transactions as Uncategorized. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const { error: txError } = await supabase
              .from('transactions')
              .update({ category_id: null })
              .eq('category_id', id)
              .eq('user_id', userId);
            if (txError) {
              console.warn('Transaction update error:', txError);
              return;
            }
            const { error } = await supabase
              .from('categories')
              .delete()
              .eq('id', id)
              .eq('user_id', userId);
            if (error) {
              console.warn('Category delete error:', error);
              return;
            }
            setCategories((c) => c.filter((x) => x.id !== id));
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.fullModal} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.fullModalInner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.modalHeaderTitle}>Categories</Text>
          <View style={styles.modalHeaderRight}>
            {!showAddForm && !editingCategory && (
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowAddForm(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.addButtonText}>Add Category</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showAddForm ? (
          <View style={styles.addForm}>
            <TextInput
              style={styles.formInput}
              placeholder="Category name"
              placeholderTextColor={colors.textSecondary}
              value={addName}
              onChangeText={setAddName}
            />
            <TextInput
              style={styles.formInput}
              placeholder="Emoji (e.g. 🍔)"
              placeholderTextColor={colors.textSecondary}
              value={addEmoji}
              onChangeText={setAddEmoji}
            />
            <TextInput
              style={styles.formInput}
              placeholder="Budget amount"
              placeholderTextColor={colors.textSecondary}
              value={addBudget}
              onChangeText={setAddBudget}
              keyboardType="decimal-pad"
            />
            <Text style={styles.formLabel}>Budget period</Text>
            <View style={styles.periodChipsRow}>
              {(['daily', 'weekly', 'monthly'] as const).map((opt) => {
                const active = addBudgetType === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.periodChip, active && styles.periodChipActive]}
                    onPress={() => setAddBudgetType(opt)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.periodChipText,
                        active && styles.periodChipTextActive,
                      ]}
                    >
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.formButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowAddForm(false);
                  setAddName('');
                  setAddEmoji('💰');
                  setAddBudget('');
                  setAddBudgetType('monthly');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleAddCategory}
                disabled={saving || !addName.trim()}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {editingCategory ? (
          <View style={styles.addForm}>
            <Text style={styles.formLabel}>Edit Category</Text>
            <TextInput
              style={styles.formInput}
              placeholder="Category name"
              placeholderTextColor={colors.textSecondary}
              value={editName}
              onChangeText={setEditName}
            />
            <TextInput
              style={styles.formInput}
              placeholder="Emoji (e.g. 🍔)"
              placeholderTextColor={colors.textSecondary}
              value={editEmoji}
              onChangeText={setEditEmoji}
            />
            <Text style={styles.formLabel}>Color</Text>
            <View style={styles.editColorRow}>
              {EDIT_COLOR_PALETTE.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.colorCircle,
                    { backgroundColor: c },
                    editColor === c && styles.colorCircleSelected,
                  ]}
                  onPress={() => setEditColor(c)}
                  activeOpacity={0.8}
                />
              ))}
            </View>
            <View style={styles.formButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setEditingCategory(null)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleUpdateCategory}
                disabled={updating || !editName.trim()}
              >
                {updating ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : categories.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No categories yet</Text>
              <Text style={styles.emptySubtitle}>Add your first category</Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => setShowAddForm(true)}
              >
                <Text style={styles.emptyButtonText}>Add Category</Text>
              </TouchableOpacity>
            </View>
          ) : (
            categories.map((cat) => (
              <View key={cat.id} style={styles.categoryItem}>
                <View style={styles.categoryItemLeft}>
                  <Text style={styles.categoryEmoji}>{cat.emoji || '💰'}</Text>
                  <View>
                    <Text style={styles.categoryName}>{cat.name}</Text>
                    <View style={styles.categoryAmounts}>
                      <Text style={styles.categoryBudget}>
                        Budget: ${(cat.budget ?? 0).toFixed(2)}
                        {cat.type ? ` / ${cat.type}` : ''}
                      </Text>
                      <Text style={styles.categorySpent}>
                        Spent: ${(cat.spent ?? 0).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.categoryRowActions}>
                  <TouchableOpacity
                    onPress={() => {
                      setEditingCategory(cat);
                      setEditName(cat.name);
                      setEditEmoji(cat.emoji || '💰');
                      setEditColor(cat.color || '#6366F1');
                      setShowAddForm(false);
                    }}
                    style={styles.editButton}
                  >
                    <Text style={styles.editButtonText}>✏️</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleDeleteCategory(cat.id)}
                    style={styles.deleteButton}
                  >
                    <Text style={styles.deleteButtonText}>🗑️</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function EditProfileModal({
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
    const payload: Record<string, unknown> = { id: userId, name: name.trim(), location: location.trim() };
    const budget = parseFloat(monthlyBudget);
    if (!isNaN(budget) && budget >= 0) payload.monthly_budget = budget;
    const { error } = await supabase.from('profiles').upsert(payload);
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
        <Text style={styles.formLabel}>Location</Text>
        <TextInput
          style={styles.formInput}
          placeholder="e.g. Dhaka, Bangladesh"
          placeholderTextColor={colors.textSecondary}
          value={location}
          onChangeText={setLocation}
        />
        <Text style={styles.formLabel}>Monthly Budget</Text>
        <TextInput
          style={styles.formInput}
          placeholder="e.g. 1500"
          placeholderTextColor={colors.textSecondary}
          value={monthlyBudget}
          onChangeText={setMonthlyBudget}
          keyboardType="decimal-pad"
        />
        <TouchableOpacity style={styles.saveButton} onPress={handleSave} disabled={saving}>
          {saving ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Text style={styles.saveButtonText}>Save Changes</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function CurrencyModal({
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
    const { error } = await supabase
      .from('profiles')
      .upsert({ id: userId, currency: selected });
    setSaving(false);
    if (error) {
      Alert.alert('Error', `Could not save currency: ${error.message}`);
      return;
    }
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
            <TouchableOpacity
              key={c.code}
              style={[styles.currencyItem, active && styles.currencyItemActive]}
              onPress={() => setSelected(c.code)}
              activeOpacity={0.8}
            >
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
          {saving ? (
            <ActivityIndicator size="small" color={colors.textPrimary} />
          ) : (
            <Text style={styles.saveButtonText}>Save Currency</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

type IncomeRecord = {
  id: string;
  user_id: string;
  amount: number;
  frequency: 'monthly' | 'weekly' | 'annual';
  label: string;
  start_date?: string;
  created_at?: string;
};

function calcMonthlyIncome(record: IncomeRecord): number {
  const amt = Number(record.amount) || 0;
  if (record.frequency === 'weekly') return amt * 4.33;
  if (record.frequency === 'annual') return amt / 12;
  return amt;
}

function IncomeModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { currencySymbol } = useProfile();
  const [incomeRecords, setIncomeRecords] = useState<IncomeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addLabel, setAddLabel] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [addFrequency, setAddFrequency] = useState<'monthly' | 'weekly' | 'annual'>('monthly');
  const [saving, setSaving] = useState(false);

  const fetchIncome = async () => {
    if (!userId) return;
    const { data, error } = await supabase
      .from('income')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) {
      console.error('[Income] Fetch error:', error);
      setIncomeRecords([]);
      return;
    }
    setIncomeRecords((data as IncomeRecord[]) ?? []);
  };

  useEffect(() => {
    if (userId) {
      setLoading(true);
      fetchIncome();
    }
  }, [userId]);

  const totalMonthlyIncome = incomeRecords.reduce((sum, r) => sum + calcMonthlyIncome(r), 0);

  const handleAdd = async () => {
    const label = addLabel.trim() || 'Income';
    const amount = parseFloat(addAmount);
    if (!userId) {
      Alert.alert('Error', 'You must be logged in to add income.');
      return;
    }
    if (isNaN(amount) || amount <= 0) {
      Alert.alert('Error', 'Please enter a valid amount.');
      return;
    }
    if (!addLabel.trim()) {
      Alert.alert('Error', 'Please enter a label.');
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('income').insert({
      user_id: userId,
      label,
      amount,
      frequency: addFrequency,
    });
    setSaving(false);
    if (error) {
      Alert.alert('Error', `Could not save income: ${error.message || error.details || JSON.stringify(error)}`);
      return;
    }
    setAddLabel('');
    setAddAmount('');
    setAddFrequency('monthly');
    setShowAddForm(false);
    fetchIncome();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('income').delete().eq('id', id);
    if (error) {
      console.warn('[Income] Delete error:', error);
      return;
    }
    setIncomeRecords((r) => r.filter((x) => x.id !== id));
  };

  const freqSuffix = (f: string) => {
    if (f === 'weekly') return '/wk';
    if (f === 'annual') return '/yr';
    return '/mo';
  };

  return (
    <SafeAreaView style={styles.fullModal} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.fullModalInner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.modalHeaderTitle}>Income</Text>
          <View style={styles.modalHeaderRight}>
            {!showAddForm && (
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowAddForm(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.addButtonText}>Add Income</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.incomeBanner}>
          <Text style={styles.incomeBannerLabel}>Total Monthly Income</Text>
          <Text style={styles.incomeBannerAmount}>
            {currencySymbol}{totalMonthlyIncome.toFixed(2)}
          </Text>
        </View>

        {showAddForm && (
          <View style={styles.addForm}>
            <TextInput
              style={styles.formInput}
              placeholder="Label (e.g. Salary, Freelance)"
              placeholderTextColor={colors.textSecondary}
              value={addLabel}
              onChangeText={setAddLabel}
            />
            <TextInput
              style={styles.formInput}
              placeholder="Amount"
              placeholderTextColor={colors.textSecondary}
              value={addAmount}
              onChangeText={setAddAmount}
              keyboardType="decimal-pad"
            />
            <Text style={styles.formLabel}>Frequency</Text>
            <View style={styles.periodChipsRow}>
              {(['monthly', 'weekly', 'annual'] as const).map((opt) => {
                const active = addFrequency === opt;
                return (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.periodChip, active && styles.periodChipActive]}
                    onPress={() => setAddFrequency(opt)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.periodChipText, active && styles.periodChipTextActive]}>
                      {opt.charAt(0).toUpperCase() + opt.slice(1)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.formButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowAddForm(false);
                  setAddLabel('');
                  setAddAmount('');
                  setAddFrequency('monthly');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleAdd}
                disabled={saving || !addLabel.trim() || !addAmount.trim()}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        )}

        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : incomeRecords.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No income sources</Text>
              <Text style={styles.emptySubtitle}>Add your first income source</Text>
              <TouchableOpacity style={styles.emptyButton} onPress={() => setShowAddForm(true)}>
                <Text style={styles.emptyButtonText}>Add Income</Text>
              </TouchableOpacity>
            </View>
          ) : (
            incomeRecords.map((record) => (
              <View key={record.id} style={styles.incomeItem}>
                <View style={styles.incomeItemLeft}>
                  <Text style={styles.incomeLabel}>{record.label}</Text>
                  <Text style={styles.incomeSubLabel}>
                    {currencySymbol}{Number(record.amount).toFixed(2)}{freqSuffix(record.frequency)}
                    {' · '}
                    {currencySymbol}{calcMonthlyIncome(record).toFixed(2)}/mo
                  </Text>
                </View>
                <TouchableOpacity onPress={() => handleDelete(record.id)} style={styles.deleteButton}>
                  <Text style={styles.deleteButtonText}>🗑️</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const GOAL_TYPES = [
  { value: 'saving', label: 'Saving' },
  { value: 'debt_payment', label: 'Debt Payment' },
  { value: 'investment', label: 'Investment' },
  { value: 'expense', label: 'Expense' },
] as const;

function GoalsModal({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { currencySymbol } = useProfile();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addTarget, setAddTarget] = useState('');
  const [addCurrent, setAddCurrent] = useState('');
  const [addDate, setAddDate] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [selectedGoalType, setSelectedGoalType] = useState<string>('saving');
  const [saving, setSaving] = useState(false);
  const [dateError, setDateError] = useState('');

  const fetchGoals = () => {
    if (!userId) return;
    supabase
      .from('financial_goals')
      .select('*')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        setLoading(false);
        if (error) {
          console.warn('Goals fetch error:', error);
          setGoals([]);
          return;
        }
        setGoals((data as Goal[]) ?? []);
      });
  };

  const fetchCategories = () => {
    if (!userId) return;
    supabase
      .from('categories')
      .select('*')
      .eq('user_id', userId)
      .then(({ data, error }) => {
        if (error) {
          console.warn('Categories fetch error:', error);
          setCategories([]);
          return;
        }
        setCategories((data as Category[]) ?? []);
      });
  };

  useEffect(() => {
    if (userId) {
      setLoading(true);
      fetchGoals();
      fetchCategories();
    }
  }, [userId]);

  const handleAddGoal = async () => {
    const goalName = addName.trim();
    const targetAmount = addTarget.trim();
    const currentAmount = addCurrent.trim();
    const targetDate = addDate.trim();
    console.log('Saving goal with:', {
      user_id: userId,
      name: goalName,
      target_amount: parseFloat(targetAmount),
      current_amount: parseFloat(currentAmount) || 0,
      target_date: targetDate,
      goal_type: selectedGoalType,
      status: 'in_progress',
    });
    if (!goalName || !userId) return;
    if (!targetAmount) return;
    if (dateError) return;
    setSaving(true);
    const targetDateVal = targetDate
      ? new Date(targetDate).toISOString()
      : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const payload = {
      user_id: userId,
      name: goalName,
      description: '',
      target_amount: parseFloat(targetAmount),
      current_amount: parseFloat(currentAmount) || 0,
      target_date: targetDateVal,
      goal_type: selectedGoalType,
      status: 'in_progress',
      category_id: selectedCategoryId || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('financial_goals').insert(payload);
    setSaving(false);
    if (error) {
      Alert.alert('Error', JSON.stringify(error));
      return;
    }
    Alert.alert('Success', 'Goal saved!');
    setAddName('');
    setAddTarget('');
    setAddCurrent('');
    setAddDate('');
    setDateError('');
    setSelectedCategoryId(null);
    setSelectedGoalType('saving');
    setShowAddForm(false);
    fetchGoals();
  };

  const handleDeleteGoal = async (id: string) => {
    const { error } = await supabase.from('financial_goals').delete().eq('id', id);
    if (error) {
      console.warn('Goal delete error:', error);
      return;
    }
    setGoals((g) => g.filter((x) => x.id !== id));
  };

  return (
    <SafeAreaView style={styles.fullModal} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.fullModalInner}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.modalHeader}>
          <Text style={styles.modalHeaderTitle}>Goals</Text>
          <View style={styles.modalHeaderRight}>
            {!showAddForm && (
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => setShowAddForm(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.addButtonText}>Add Goal</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>
        </View>

        {showAddForm ? (
          <View style={styles.addForm}>
            <TextInput
              style={styles.formInput}
              placeholder="Goal name"
              placeholderTextColor={colors.textSecondary}
              value={addName}
              onChangeText={setAddName}
            />
            <Text style={styles.formLabelOptional}>Link to Category (optional)</Text>
            <ScrollView
              horizontal
              style={styles.categoryChipsScroll}
              contentContainerStyle={styles.categoryChipsContent}
              showsHorizontalScrollIndicator={false}
            >
              <TouchableOpacity
                style={[
                  styles.goalCategoryChip,
                  selectedCategoryId === null && styles.goalCategoryChipActive,
                ]}
                onPress={() => setSelectedCategoryId(null)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    styles.goalCategoryChipText,
                    selectedCategoryId === null && styles.goalCategoryChipTextActive,
                  ]}
                >
                  None
                </Text>
              </TouchableOpacity>
              {categories.map((cat) => {
                const selected = selectedCategoryId === cat.id;
                return (
                  <TouchableOpacity
                    key={cat.id}
                    style={[styles.goalCategoryChip, selected && styles.goalCategoryChipActive]}
                    onPress={() => setSelectedCategoryId(cat.id)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.goalCategoryChipText,
                        selected && styles.goalCategoryChipTextActive,
                      ]}
                    >
                      {cat.emoji} {cat.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <Text style={styles.formLabel}>Goal type</Text>
            <View style={styles.goalTypeChipsRow}>
              {GOAL_TYPES.map((gt) => {
                const active = selectedGoalType === gt.value;
                return (
                  <TouchableOpacity
                    key={gt.value}
                    style={[styles.goalTypeChip, active && styles.goalTypeChipActive]}
                    onPress={() => setSelectedGoalType(gt.value)}
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.goalTypeChipText,
                        active && styles.goalTypeChipTextActive,
                      ]}
                    >
                      {gt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={styles.formInput}
              placeholder="Target amount"
              placeholderTextColor={colors.textSecondary}
              value={addTarget}
              onChangeText={setAddTarget}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={styles.formInput}
              placeholder="Current amount"
              placeholderTextColor={colors.textSecondary}
              value={addCurrent}
              onChangeText={setAddCurrent}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[styles.formInput, dateError ? { borderColor: colors.error, borderWidth: 1 } : {}]}
              placeholder="Target date (YYYY-MM-DD)"
              placeholderTextColor={colors.textSecondary}
              value={addDate}
              onChangeText={(text) => {
                setAddDate(text);
                if (text.trim()) {
                  const valid = /^\d{4}-\d{2}-\d{2}$/.test(text.trim()) && !isNaN(new Date(text.trim()).getTime());
                  setDateError(valid ? '' : 'Use format YYYY-MM-DD (e.g. 2025-12-31)');
                } else {
                  setDateError('');
                }
              }}
            />
            {dateError ? <Text style={{ color: colors.error, fontSize: 12, marginTop: -8, marginBottom: 8 }}>{dateError}</Text> : null}
            <View style={styles.formButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => {
                  setShowAddForm(false);
                  setAddName('');
                  setAddTarget('');
                  setAddCurrent('');
                  setAddDate('');
                  setDateError('');
                  setSelectedCategoryId(null);
                  setSelectedGoalType('saving');
                }}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.saveButton}
                onPress={handleAddGoal}
                disabled={false}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Text style={styles.saveButtonText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={styles.modalLoading}>
              <ActivityIndicator size="large" color={colors.primary} />
            </View>
          ) : goals.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No goals yet</Text>
              <Text style={styles.emptySubtitle}>Set your first financial goal</Text>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => setShowAddForm(true)}
              >
                <Text style={styles.emptyButtonText}>Add Goal</Text>
              </TouchableOpacity>
            </View>
          ) : (
            goals.map((goal) => {
              const target = goal.target_amount || 1;
              const current = Math.min(goal.current_amount ?? 0, target);
              const pct = Math.round((current / target) * 100);
              const linkedCategory = goal.category_id
                ? categories.find((c) => c.id === goal.category_id)
                : null;
              const targetDateStr = goal.target_date
                ? new Date(goal.target_date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })
                : null;
              return (
                <View key={goal.id} style={styles.goalItem}>
                  <View style={styles.goalItemTop}>
                    <View style={styles.goalItemTitleRow}>
                      <Text style={styles.goalName}>{goal.name}</Text>
                      {linkedCategory && (
                        <Text style={styles.goalCategoryBadge}>
                          {linkedCategory.emoji} {linkedCategory.name}
                        </Text>
                      )}
                    </View>
                    <TouchableOpacity
                      onPress={() => handleDeleteGoal(goal.id)}
                      style={styles.deleteButton}
                    >
                      <Text style={styles.deleteButtonText}>🗑️</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.goalProgressTrack}>
                    <View
                      style={[
                        styles.goalProgressFill,
                        { width: `${pct}%` },
                      ]}
                    />
                  </View>
                  <Text style={styles.goalProgressText}>
                    {currencySymbol}{current.toFixed(2)} / {currencySymbol}{target.toFixed(2)}
                  </Text>
                  {targetDateStr ? (
                    <Text style={styles.goalDate}>{targetDateStr}</Text>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    padding: 4,
  },
  backButtonText: {
    fontSize: 18,
    color: '#6366F1',
    fontWeight: '600',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 32,
  },
  profileCard: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  avatarText: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  profileName: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  profileEmail: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
    marginLeft: 4,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 8,
  },
  itemText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  chevron: {
    fontSize: 18,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  signOutButton: {
    backgroundColor: colors.error,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 8,
  },
  signOutText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  fullModal: {
    flex: 1,
    backgroundColor: '#0A0F1E',
    paddingTop: 60,
  },
  fullModalInner: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalHeaderTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  modalHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  addButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  addButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  closeButton: {
    padding: 4,
  },
  closeButtonText: {
    fontSize: 20,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  addForm: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  formInput: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
    marginBottom: 12,
  },
  formLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    marginBottom: 8,
  },
  formLabelOptional: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
    marginBottom: 8,
  },
  periodChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  periodChip: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  periodChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  periodChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  periodChipTextActive: {
    color: colors.textPrimary,
  },
  formButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  saveButton: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    minWidth: 80,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  modalLoading: {
    paddingVertical: 48,
    alignItems: 'center',
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 48,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: 20,
  },
  emptyButton: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  emptyButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  categoryItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  categoryEmoji: {
    fontSize: 24,
    marginRight: 12,
  },
  categoryName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  categoryAmounts: {
    flexDirection: 'row',
    gap: 16,
  },
  categoryBudget: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
  },
  categorySpent: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  deleteButton: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.error,
  },
  deleteButtonText: {
    fontSize: 20,
  },
  goalItem: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  goalItemTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  goalName: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    flex: 1,
  },
  goalTarget: {
    fontSize: 14,
    color: colors.primary,
    fontWeight: '600',
    marginBottom: 8,
  },
  goalProgressTrack: {
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
    marginBottom: 8,
  },
  goalProgressFill: {
    height: '100%',
    backgroundColor: '#6366F1',
    borderRadius: 4,
  },
  goalProgressText: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  goalDate: {
    fontSize: 12,
    color: '#94A3B8',
  },
  goalItemTitleRow: {
    flex: 1,
  },
  goalCategoryBadge: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  categoryChipsScroll: {
    maxHeight: 44,
    marginBottom: 16,
  },
  categoryChipsContent: {
    flexDirection: 'row',
    paddingVertical: 4,
    gap: 8,
  },
  goalCategoryChip: {
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  goalCategoryChipActive: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  goalCategoryChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  goalCategoryChipTextActive: {
    color: '#FFFFFF',
  },
  goalTypeChipsRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  goalTypeChip: {
    flex: 1,
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1E2A3A',
    borderRadius: 999,
    paddingVertical: 10,
    alignItems: 'center',
  },
  goalTypeChipActive: {
    backgroundColor: '#6366F1',
    borderColor: '#6366F1',
  },
  goalTypeChipText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#94A3B8',
  },
  goalTypeChipTextActive: {
    color: '#FFFFFF',
  },
  currencyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
  },
  currencyItemActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  currencyItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  currencySymbol: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textSecondary,
    width: 32,
    textAlign: 'center',
  },
  currencySymbolActive: {
    color: colors.primary,
  },
  currencyCode: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  currencyCodeActive: {
    color: colors.primary,
  },
  currencyName: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  currencyCheck: {
    fontSize: 18,
    color: colors.primary,
    fontWeight: '700',
  },
  editColorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  colorCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  colorCircleSelected: {
    borderWidth: 3,
    borderColor: '#FFFFFF',
  },
  categoryRowActions: {
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  editButtonText: {
    fontSize: 18,
  },
  incomeBanner: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(16, 185, 129, 0.3)',
    paddingVertical: 16,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  incomeBannerLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.success,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  incomeBannerAmount: {
    fontSize: 28,
    fontWeight: '700',
    color: colors.success,
  },
  incomeItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
  },
  incomeItemLeft: {
    flex: 1,
  },
  incomeLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 4,
  },
  incomeSubLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
});
