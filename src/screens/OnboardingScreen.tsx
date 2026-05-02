import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import { seedDefaultCategories } from '../lib/seedCategories';

const ONBOARDING_CURRENCIES = [
  { code: 'USD', symbol: '$' },
  { code: 'BDT', symbol: '৳' },
  { code: 'EUR', symbol: '€' },
  { code: 'GBP', symbol: '£' },
  { code: 'INR', symbol: '₹' },
  { code: 'AUD', symbol: 'A$' },
];

const GOAL_CARDS = [
  { type: 'saving', label: 'Save money', emoji: '💰' },
  { type: 'home', label: 'Buy a home', emoji: '🏠' },
  { type: 'education', label: 'Education', emoji: '📚' },
  { type: 'travel', label: 'Travel', emoji: '🌍' },
  { type: 'debt_payment', label: 'Pay off debt', emoji: '💳' },
  { type: 'custom', label: 'Custom', emoji: '🎯' },
] as const;

type GoalCard = typeof GOAL_CARDS[number];

function suggestCurrency(location: string): string {
  const loc = location.toLowerCase();
  if (loc.includes('bangladesh') || loc.includes('dhaka')) return 'BDT';
  if (loc.includes('india') || loc.includes('mumbai') || loc.includes('delhi') || loc.includes('bangalore') || loc.includes('kolkata')) return 'INR';
  if (loc.includes('uk') || loc.includes('united kingdom') || loc.includes('london') || loc.includes('england')) return 'GBP';
  if (loc.includes('euro') || loc.includes('germany') || loc.includes('france') || loc.includes('spain') || loc.includes('italy')) return 'EUR';
  if (loc.includes('australia') || loc.includes('sydney') || loc.includes('melbourne')) return 'AUD';
  return 'USD';
}

const STEP_MESSAGES = [
  "Hey! 👋 I'm Finni, your personal finance coach.\nLet's personalize your experience.",
  "Let's set up your finances so I can give\nyou personalized advice 💰",
  "Finally, set a goal to work towards.\nI'll help you get there! 🎯",
];

export default function OnboardingScreen() {
  const { user } = useAuth();
  const { refreshProfile } = useProfile();

  const [step, setStep] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Step 1 state
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [currency, setCurrency] = useState('USD');

  // Step 2 state
  const [incomeAmount, setIncomeAmount] = useState('');
  const [incomeLabel, setIncomeLabel] = useState('');
  const [budget, setBudget] = useState('');
  const budgetManuallySet = useRef(false);

  // Step 3 state
  const [selectedGoal, setSelectedGoal] = useState<GoalCard | null>(null);
  const [goalName, setGoalName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [deadline, setDeadline] = useState('');

  // Auto-suggest currency from location
  useEffect(() => {
    if (location.trim()) setCurrency(suggestCurrency(location));
  }, [location]);

  // Pre-fill budget as 70% of income (unless user manually changed it)
  useEffect(() => {
    if (budgetManuallySet.current) return;
    const amt = parseFloat(incomeAmount);
    if (!isNaN(amt) && amt > 0) setBudget(Math.round(amt * 0.7).toString());
  }, [incomeAmount]);

  // Auto-fill goal name from card selection
  useEffect(() => {
    if (!selectedGoal) return;
    if (selectedGoal.type !== 'custom') setGoalName(selectedGoal.label);
    else setGoalName('');
  }, [selectedGoal]);

  const currencySymbol = ONBOARDING_CURRENCIES.find((c) => c.code === currency)?.symbol ?? '$';

  const animateIn = (direction: 'forward' | 'back') => {
    slideAnim.setValue(direction === 'forward' ? 350 : -350);
    Animated.spring(slideAnim, {
      toValue: 0,
      useNativeDriver: true,
      tension: 70,
      friction: 12,
    }).start();
  };

  const advance = useCallback(() => {
    animateIn('forward');
    setStep((s) => s + 1);
  }, []);

  const retreat = useCallback(() => {
    animateIn('back');
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const saveStep1 = async () => {
    if (!user?.id) return;
    const payload: Record<string, unknown> = { id: user.id, currency };
    if (name.trim()) payload.name = name.trim();
    if (location.trim()) payload.location = location.trim();
    await supabase.from('profiles').upsert(payload);
  };

  const saveStep2 = async () => {
    if (!user?.id) return;
    const incomeAmt = parseFloat(incomeAmount);
    const budgetAmt = parseFloat(budget);
    const profilePayload: Record<string, unknown> = { id: user.id };
    if (!isNaN(budgetAmt) && budgetAmt > 0) profilePayload.monthly_budget = budgetAmt;
    if (Object.keys(profilePayload).length > 1) await supabase.from('profiles').upsert(profilePayload);
    if (!isNaN(incomeAmt) && incomeAmt > 0) {
      await supabase.from('income').insert({
        user_id: user.id,
        label: incomeLabel.trim() || 'Income',
        amount: incomeAmt,
        frequency: 'monthly',
      });
    }
  };

  const saveStep3 = async () => {
    if (!user?.id || !selectedGoal || !goalName.trim()) return;
    const targetAmt = parseFloat(targetAmount);
    const targetDate =
      deadline.trim() && /^\d{4}-\d{2}-\d{2}$/.test(deadline)
        ? new Date(deadline).toISOString()
        : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    await supabase.from('financial_goals').insert({
      user_id: user.id,
      name: goalName.trim(),
      target_amount: isNaN(targetAmt) ? 1000 : targetAmt,
      current_amount: 0,
      target_date: targetDate,
      goal_type: selectedGoal.type,
      status: 'in_progress',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  };

  const handleContinue = async () => {
    setIsSaving(true);
    try {
      if (step === 0) await saveStep1();
      if (step === 1) await saveStep2();
      if (step === 2) await saveStep3();
    } catch (e) {
      console.error('[Onboarding] Save error:', e);
    } finally {
      setIsSaving(false);
      advance();
    }
  };

  const handleSkip = () => advance();

  // Completion: mark onboarding done first, then seed categories (non-blocking)
  useEffect(() => {
    if (step !== 3 || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        // Mark complete first — this is what gates the navigation.
        // If this succeeds, user is unblocked even if seed fails.
        await supabase
          .from('profiles')
          .update({ onboarding_complete: true })
          .eq('id', user.id);
        // Seed categories in the background; failure is non-fatal.
        seedDefaultCategories(user.id).catch((e) =>
          console.error('[Onboarding] Seed categories error (non-fatal):', e)
        );
      } catch (e) {
        console.error('[Onboarding] Complete error:', e);
      } finally {
        if (!cancelled) await refreshProfile();
      }
    })();
    return () => { cancelled = true; };
  }, [step, user?.id, refreshProfile]);

  // --- Completion screen ---
  if (step === 3) {
    const firstName = name.trim().split(/\s+/)[0] || null;
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.completionContainer}>
          <View style={styles.finniAvatarLarge}>
            <Text style={styles.finniAvatarText}>F</Text>
          </View>
          <Text style={styles.completionTitle}>
            You're all set{firstName ? `, ${firstName}` : ''}! 🚀
          </Text>
          <Text style={styles.completionSubtitle}>Let's start your financial journey.</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Progress bar */}
        <View style={styles.progressContainer}>
          {step > 0 ? (
            <TouchableOpacity onPress={retreat} style={styles.backBtn} hitSlop={12}>
              <Text style={styles.backBtnText}>‹</Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.backBtnPlaceholder} />
          )}
          <View style={styles.progressBar}>
            {[0, 1, 2].map((i) => (
              <View
                key={i}
                style={[
                  styles.progressSegment,
                  i <= step && styles.progressSegmentActive,
                  i < 2 && { marginRight: 8 },
                ]}
              />
            ))}
          </View>
        </View>

        <ScrollView
          style={styles.flex}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View style={{ transform: [{ translateX: slideAnim }] }}>
            {/* Finni chat bubble */}
            <View style={styles.finniRow}>
              <View style={styles.finniAvatar}>
                <Text style={styles.finniAvatarText}>F</Text>
              </View>
              <View style={styles.finniMessageBubble}>
                <Text style={styles.finniMessageText}>{STEP_MESSAGES[step]}</Text>
              </View>
            </View>

            {/* ── Step 1: Who are you? ── */}
            {step === 0 && (
              <View style={styles.stepContent}>
                <Text style={styles.fieldLabel}>What's your name?</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Your name"
                  placeholderTextColor={colors.textSecondary}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                />

                <Text style={styles.fieldLabel}>Where are you based?</Text>
                <TextInput
                  style={styles.input}
                  placeholder="City, Country (e.g. Dhaka, Bangladesh)"
                  placeholderTextColor={colors.textSecondary}
                  value={location}
                  onChangeText={setLocation}
                />

                <Text style={styles.fieldLabel}>What currency do you use?</Text>
                <View style={styles.pillRow}>
                  {ONBOARDING_CURRENCIES.map((c) => (
                    <TouchableOpacity
                      key={c.code}
                      style={[styles.pill, currency === c.code && styles.pillActive]}
                      onPress={() => setCurrency(c.code)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.pillText, currency === c.code && styles.pillTextActive]}>
                        {c.code} ({c.symbol})
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            {/* ── Step 2: Your finances ── */}
            {step === 1 && (
              <View style={styles.stepContent}>
                <Text style={styles.fieldLabel}>
                  What's your monthly income?{' '}
                  <Text style={styles.optional}>(optional)</Text>
                </Text>
                <View style={styles.inputWithPrefix}>
                  <Text style={styles.inputPrefix}>{currencySymbol}</Text>
                  <TextInput
                    style={styles.inputPrefixed}
                    placeholder="0.00"
                    placeholderTextColor={colors.textSecondary}
                    value={incomeAmount}
                    onChangeText={setIncomeAmount}
                    keyboardType="decimal-pad"
                  />
                </View>
                <TextInput
                  style={[styles.input, { marginTop: 8 }]}
                  placeholder="Label (e.g. Salary, Freelance)"
                  placeholderTextColor={colors.textSecondary}
                  value={incomeLabel}
                  onChangeText={setIncomeLabel}
                />

                <Text style={[styles.fieldLabel, { marginTop: 20 }]}>
                  What's your monthly spending budget?{' '}
                  <Text style={styles.optional}>(optional)</Text>
                </Text>
                <View style={styles.inputWithPrefix}>
                  <Text style={styles.inputPrefix}>{currencySymbol}</Text>
                  <TextInput
                    style={styles.inputPrefixed}
                    placeholder="0.00"
                    placeholderTextColor={colors.textSecondary}
                    value={budget}
                    onChangeText={(text) => {
                      budgetManuallySet.current = true;
                      setBudget(text);
                    }}
                    keyboardType="decimal-pad"
                  />
                </View>
                {!budgetManuallySet.current && budget.length > 0 && (
                  <Text style={styles.hint}>Pre-filled to 70% of your income</Text>
                )}
              </View>
            )}

            {/* ── Step 3: Your first goal ── */}
            {step === 2 && (
              <View style={styles.stepContent}>
                <View style={styles.goalGrid}>
                  {GOAL_CARDS.map((card) => {
                    const active = selectedGoal?.type === card.type;
                    return (
                      <TouchableOpacity
                        key={card.type}
                        style={[styles.goalCard, active && styles.goalCardActive]}
                        onPress={() => setSelectedGoal(card)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.goalEmoji}>{card.emoji}</Text>
                        <Text style={[styles.goalLabel, active && styles.goalLabelActive]}>
                          {card.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {selectedGoal && (
                  <View style={styles.goalDetails}>
                    <Text style={styles.fieldLabel}>Goal name</Text>
                    <TextInput
                      style={styles.input}
                      value={goalName}
                      onChangeText={setGoalName}
                      placeholder="e.g. Emergency fund"
                      placeholderTextColor={colors.textSecondary}
                    />
                    <Text style={styles.fieldLabel}>
                      Target amount <Text style={styles.optional}>(optional)</Text>
                    </Text>
                    <View style={styles.inputWithPrefix}>
                      <Text style={styles.inputPrefix}>{currencySymbol}</Text>
                      <TextInput
                        style={styles.inputPrefixed}
                        placeholder="0.00"
                        placeholderTextColor={colors.textSecondary}
                        value={targetAmount}
                        onChangeText={setTargetAmount}
                        keyboardType="decimal-pad"
                      />
                    </View>
                    <Text style={styles.fieldLabel}>
                      Deadline <Text style={styles.optional}>(optional, YYYY-MM-DD)</Text>
                    </Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 2026-12-31"
                      placeholderTextColor={colors.textSecondary}
                      value={deadline}
                      onChangeText={setDeadline}
                    />
                  </View>
                )}
              </View>
            )}
          </Animated.View>
        </ScrollView>

        {/* Bottom actions */}
        <View style={styles.bottomActions}>
          <TouchableOpacity
            style={[styles.ctaButton, isSaving && styles.ctaDisabled]}
            onPress={handleContinue}
            disabled={isSaving}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaText}>
              {isSaving ? 'Saving...' : step === 2 ? 'Set Goal & Finish' : 'Continue →'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={handleSkip} style={styles.skipButton}>
            <Text style={styles.skipText}>
              {step === 2 ? 'Set goals later' : 'Skip for now'}
            </Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  progressContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  backBtn: {
    width: 32,
    marginRight: 12,
    alignItems: 'flex-start',
  },
  backBtnText: {
    fontSize: 30,
    color: colors.primary,
    fontWeight: '600',
    lineHeight: 34,
  },
  backBtnPlaceholder: {
    width: 44,
  },
  progressBar: {
    flex: 1,
    flexDirection: 'row',
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
  },
  progressSegmentActive: {
    backgroundColor: colors.primary,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  finniRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 24,
    marginBottom: 28,
    gap: 12,
  },
  finniAvatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  finniAvatarLarge: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  finniAvatarText: {
    fontSize: 24,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  finniMessageBubble: {
    flex: 1,
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    padding: 16,
  },
  finniMessageText: {
    fontSize: 15,
    color: colors.textPrimary,
    lineHeight: 22,
    fontWeight: '500',
  },
  stepContent: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 8,
    marginTop: 12,
  },
  optional: {
    color: colors.textSecondary,
    fontWeight: '400',
  },
  input: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.textPrimary,
  },
  inputWithPrefix: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
  },
  inputPrefix: {
    fontSize: 18,
    color: colors.textSecondary,
    paddingLeft: 16,
    paddingRight: 8,
    fontWeight: '600',
  },
  inputPrefixed: {
    flex: 1,
    paddingVertical: 14,
    paddingRight: 16,
    fontSize: 16,
    color: colors.textPrimary,
  },
  hint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 6,
    marginLeft: 4,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  goalGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 8,
  },
  goalCard: {
    width: '47%',
    backgroundColor: colors.cardBackground,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  goalCardActive: {
    borderColor: colors.primary,
    backgroundColor: 'rgba(99, 102, 241, 0.12)',
  },
  goalEmoji: {
    fontSize: 32,
  },
  goalLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textSecondary,
    textAlign: 'center',
  },
  goalLabelActive: {
    color: colors.primary,
  },
  goalDetails: {
    marginTop: 8,
    gap: 4,
  },
  bottomActions: {
    paddingHorizontal: 20,
    paddingBottom: 8,
    paddingTop: 12,
    gap: 8,
  },
  ctaButton: {
    backgroundColor: colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaDisabled: {
    opacity: 0.6,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  skipText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  completionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
    gap: 16,
  },
  completionTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: colors.textPrimary,
    textAlign: 'center',
    marginTop: 8,
  },
  completionSubtitle: {
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
