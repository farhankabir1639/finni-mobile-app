import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
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
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../contexts/AuthContext';
import { useProfile, CURRENCIES } from '../contexts/ProfileContext';
import { supabase } from '../lib/supabase';
import { t, fonts } from '../theme/tokens';
import { seedDefaultCategories } from '../lib/seedCategories';
import DatePicker from '../components/DatePicker';
import { fmtShort } from '../components/DateRangePicker';
import Aurora from '../components/Aurora';
import Orb from '../components/Orb';
import GlassCard from '../components/GlassCard';
import Svg, { Path, Circle, Line } from 'react-native-svg';

const { width: SW, height: SH } = Dimensions.get('window');

// Thin-line vector icons for goal tiles (replaces emoji — matches design system)
function GoalIcon({ type, color }: { type: GoalCard['type']; color: string }) {
  const p = { stroke: color, strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' };
  switch (type) {
    case 'saving': // stacked coins
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path d="M5 7c0-1.66 3.13-3 7-3s7 1.34 7 3-3.13 3-7 3-7-1.34-7-3Z" {...p} />
          <Path d="M5 7v5c0 1.66 3.13 3 7 3s7-1.34 7-3V7" {...p} />
          <Path d="M5 12v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5" {...p} />
        </Svg>
      );
    case 'home': // house
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path d="M4 11.5 12 4l8 7.5" {...p} />
          <Path d="M6 10v9h12v-9" {...p} />
          <Path d="M10 19v-5h4v5" {...p} />
        </Svg>
      );
    case 'education': // graduation cap
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path d="M12 5 2 9l10 4 10-4-10-4Z" {...p} />
          <Path d="M6 11v4c0 1.1 2.7 2 6 2s6-.9 6-2v-4" {...p} />
          <Line x1={22} y1={9} x2={22} y2={13.5} {...p} />
        </Svg>
      );
    case 'travel': // globe
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={8} {...p} />
          <Line x1={4} y1={12} x2={20} y2={12} {...p} />
          <Path d="M12 4c2.5 2.2 2.5 13.8 0 16M12 4c-2.5 2.2-2.5 13.8 0 16" {...p} />
        </Svg>
      );
    case 'debt_payment': // card
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" {...p} />
          <Line x1={3} y1={10} x2={21} y2={10} {...p} />
          <Line x1={7} y1={15} x2={11} y2={15} {...p} />
        </Svg>
      );
    default: // custom — target
      return (
        <Svg width={22} height={22} viewBox="0 0 24 24">
          <Circle cx={12} cy={12} r={8} {...p} />
          <Circle cx={12} cy={12} r={4} {...p} />
          <Circle cx={12} cy={12} r={0.6} {...p} />
        </Svg>
      );
  }
}

const GOAL_CARDS = [
  { type: 'saving', label: 'Save money', emoji: '💰', color: t.auraAqua },
  { type: 'home', label: 'Buy a home', emoji: '🏠', color: t.auraViolet },
  { type: 'education', label: 'Education', emoji: '📚', color: t.auraBlue },
  { type: 'travel', label: 'Travel', emoji: '🌍', color: t.auraAqua },
  { type: 'debt_payment', label: 'Pay off debt', emoji: '💳', color: t.auraRose },
  { type: 'custom', label: 'Custom', emoji: '🎯', color: t.amber },
] as const;

type GoalCard = typeof GOAL_CARDS[number];

function suggestCurrency(location: string): string {
  const loc = location.toLowerCase();
  if (loc.includes('bangladesh') || loc.includes('dhaka')) return 'BDT';
  if (loc.includes('india') || loc.includes('mumbai') || loc.includes('delhi') || loc.includes('bangalore') || loc.includes('kolkata')) return 'INR';
  if (loc.includes('uk') || loc.includes('united kingdom') || loc.includes('london') || loc.includes('england')) return 'GBP';
  if (loc.includes('euro') || loc.includes('germany') || loc.includes('france') || loc.includes('spain') || loc.includes('italy')) return 'EUR';
  if (loc.includes('australia') || loc.includes('sydney') || loc.includes('melbourne')) return 'AUD';
  if (loc.includes('canada') || loc.includes('toronto') || loc.includes('vancouver') || loc.includes('montreal')) return 'CAD';
  if (loc.includes('singapore')) return 'SGD';
  return 'USD';
}

const STEP_MESSAGES = [
  "I'm Finni, your AI finance coach. Let's shape your space — start with the basics.",
  "Now your income, so I can tailor budgets and advice to your real numbers 💰",
  "Finally, pick a goal to work toward. I'll track it and help you get there! 🎯",
];

// ── FinniSay speech bubble ──
function FinniSay({ children }: { children: string }) {
  return (
    <View style={s.finniRow}>
      <View style={{ marginTop: 2 }}>
        <Orb size={40} talking />
      </View>
      <GlassCard style={s.finniMessageBubble} borderRadius={16} intensity={22}>
        <Text style={s.finniMessageText}>{children}</Text>
      </GlassCard>
    </View>
  );
}

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
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);

  // Completion screen fallback
  const [showFallback, setShowFallback] = useState(false);

  // Auto-suggest currency from location
  useEffect(() => { if (location.trim()) setCurrency(suggestCurrency(location)); }, [location]);

  // Pre-fill budget as 70% of income
  useEffect(() => {
    if (budgetManuallySet.current) return;
    const amt = parseFloat(incomeAmount);
    if (!isNaN(amt) && amt > 0) setBudget(Math.round(amt * 0.7).toString());
  }, [incomeAmount]);

  // Auto-fill goal name
  useEffect(() => {
    if (!selectedGoal) return;
    if (selectedGoal.type !== 'custom') setGoalName(selectedGoal.label);
    else setGoalName('');
  }, [selectedGoal]);

  // Show fallback after 3s on completion
  useEffect(() => {
    if (step !== 3) return;
    const timer = setTimeout(() => setShowFallback(true), 3000);
    return () => clearTimeout(timer);
  }, [step]);

  const currencySymbol = CURRENCIES.find((c) => c.code === currency)?.symbol ?? '$';

  const animateIn = (direction: 'forward' | 'back') => {
    slideAnim.setValue(direction === 'forward' ? 350 : -350);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 70, friction: 12 }).start();
  };

  const advance = useCallback(() => { animateIn('forward'); setStep((s) => s + 1); }, []);
  const retreat = useCallback(() => { animateIn('back'); setStep((s) => Math.max(0, s - 1)); }, []);

  // ── Save logic (unchanged) ──
  const saveStep1 = async () => {
    if (!user?.id) return;
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = { id: user.id, currency, created_at: now, updated_at: now };
    if (name.trim()) payload.name = name.trim();
    const { error } = await supabase.from('profiles').upsert(payload);
    if (error && __DEV__) console.error('[Onboarding] saveStep1 error:', error);
  };

  const saveStep2 = async () => {
    if (!user?.id) return;
    const incomeAmt = parseFloat(incomeAmount);
    if (!isNaN(incomeAmt) && incomeAmt > 0) {
      await supabase.from('income').insert({
        user_id: user.id, label: incomeLabel.trim() || 'Income', amount: incomeAmt, frequency: 'monthly',
      });
    }
  };

  const GOAL_TYPE_MAP: Record<string, string> = {
    saving: 'saving', home: 'saving', education: 'saving', travel: 'saving', debt_payment: 'debt_payment', custom: 'saving',
  };

  const saveStep3 = async () => {
    if (!user?.id || !selectedGoal || !goalName.trim()) return;
    const targetAmt = parseFloat(targetAmount);
    const targetDate = deadline.trim() && /^\d{4}-\d{2}-\d{2}$/.test(deadline)
      ? new Date(`${deadline.trim()}T12:00:00`).toISOString()
      : new Date(Date.now() + 365 * 86400000).toISOString();
    const { error } = await supabase.from('financial_goals').insert({
      user_id: user.id, name: goalName.trim(), target_amount: isNaN(targetAmt) ? 1000 : targetAmt,
      current_amount: 0, target_date: targetDate, goal_type: GOAL_TYPE_MAP[selectedGoal.type] ?? 'saving', status: 'in_progress',
    });
    if (error) { if (__DEV__) console.error('[Onboarding] Goal insert error:', error); throw error; }
  };

  const handleContinue = async () => {
    setIsSaving(true);
    try {
      if (step === 0) await saveStep1();
      if (step === 1) await saveStep2();
      if (step === 2) await saveStep3();
    } catch (e) { if (__DEV__) console.error('[Onboarding] Save error:', e); }
    finally { setIsSaving(false); advance(); }
  };

  const completingRef = useRef(false);
  const completeOnboarding = React.useCallback(async () => {
    if (!user?.id || completingRef.current) return;
    completingRef.current = true;
    try {
      const { error } = await supabase.from('profiles')
        .upsert({ id: user.id, onboarding_complete: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'id' });
      if (error) { if (__DEV__) console.log('[Onboarding] DB upsert FAILED:', error); return; }
      seedDefaultCategories(user.id).catch(() => {});
      await refreshProfile();
    } catch (e) { if (__DEV__) console.log('[Onboarding] EXCEPTION:', e); }
  }, [user?.id, refreshProfile]);

  useEffect(() => {
    if (step !== 3 || !user?.id) return;
    let mounted = true;
    (async () => {
      try { await completeOnboarding(); }
      catch (e) { if (__DEV__) console.error('[Onboarding] Complete error:', e); }
      finally { if (mounted && __DEV__) console.log('[Onboarding] done'); }
    })();
    return () => { mounted = false; };
  }, [step, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Completion screen ──
  if (step === 3) {
    const firstName = name.trim().split(/\s+/)[0] || null;
    return (
      <View style={s.root}>
        <Aurora width={SW} height={SH} />
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={s.completionContainer}>
            <Orb size={104} rings talking />
            <Text style={s.completionTitle}>You're all set{firstName ? `, ${firstName}` : ''}!</Text>
            <Text style={s.completionSubtitle}>Let's start your financial journey.</Text>
            {showFallback && (
              <TouchableOpacity onPress={() => completeOnboarding()} activeOpacity={0.8}>
                <LinearGradient colors={['#5EEAD4', '#A5B4FC']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.ctaGradient}>
                  <Text style={s.ctaGradientText}>Get Started →</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const step0Valid = name.trim().length > 0;
  const step1Valid = true; // income optional now
  const canNext = step === 0 ? step0Valid : step === 1 ? step1Valid : true;

  return (
    <View style={s.root}>
      <Aurora width={SW} height={SH} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {/* Progress bar */}
          <View style={s.progressRow}>
            <TouchableOpacity
              onPress={retreat}
              style={[s.backBtn, { opacity: step > 0 ? 1 : 0 }]}
              disabled={step === 0}
              hitSlop={12}
            >
              <Text style={s.backBtnText}>‹</Text>
            </TouchableOpacity>
            <View style={s.progressBar}>
              {[0, 1, 2].map((i) => (
                <View key={i} style={[s.progressSegment, i < 2 && { marginRight: 7 }]}>
                  {i <= step && (
                    <LinearGradient
                      colors={[t.auraAqua, t.auraViolet]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={s.progressFill}
                    />
                  )}
                </View>
              ))}
            </View>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={s.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <Animated.View style={{ transform: [{ translateX: slideAnim }] }}>
              {/* ── Step 1: About you ── */}
              {step === 0 && (
                <View style={s.stepContent}>
                  <FinniSay>{STEP_MESSAGES[0]}</FinniSay>
                  <View style={s.fieldGroup}>
                    <Text style={s.fieldLabel}>What should I call you? <Text style={s.req}>•</Text></Text>
                    <TextInput style={s.input} placeholder="Your name" placeholderTextColor={t.text3} value={name} onChangeText={setName} autoCapitalize="words" />
                  </View>
                  <View style={s.fieldGroup}>
                    <Text style={s.fieldLabel}>Where are you based?</Text>
                    <TextInput style={s.input} placeholder="City, Country (e.g. Dhaka, Bangladesh)" placeholderTextColor={t.text3} value={location} onChangeText={setLocation} />
                  </View>
                  <View style={s.fieldGroup}>
                    <Text style={s.fieldLabel}>Which currency do you use?</Text>
                    <View style={s.chipRow}>
                      {CURRENCIES.map((c) => {
                        const active = currency === c.code;
                        return (
                          <TouchableOpacity key={c.code} style={[s.chip, active && s.chipActive]} onPress={() => setCurrency(c.code)} activeOpacity={0.8}>
                            <Text style={[s.chipText, active && s.chipTextActive]}>{c.code} ({c.symbol})</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                </View>
              )}

              {/* ── Step 2: Finances ── */}
              {step === 1 && (
                <View style={s.stepContent}>
                  <FinniSay>{STEP_MESSAGES[1]}</FinniSay>
                  <View style={s.fieldGroup}>
                    <Text style={s.fieldLabel}>What's your monthly income? <Text style={s.req}>•</Text></Text>
                    <View style={s.inputWithPrefix}>
                      <Text style={s.inputPrefix}>{currencySymbol}</Text>
                      <TextInput style={s.inputPrefixed} placeholder="0" placeholderTextColor={t.text3} value={incomeAmount} onChangeText={setIncomeAmount} keyboardType="decimal-pad" />
                    </View>
                  </View>
                  <View style={s.fieldGroup}>
                    <Text style={s.fieldLabel}>Give it a label</Text>
                    <TextInput style={s.input} placeholder="e.g. Salary, Freelance" placeholderTextColor={t.text3} value={incomeLabel} onChangeText={setIncomeLabel} />
                  </View>
                  <View style={s.fieldGroup}>
                    <Text style={s.fieldLabel}>Monthly spending budget <Text style={s.optional}>(optional)</Text></Text>
                    <View style={s.inputWithPrefix}>
                      <Text style={s.inputPrefix}>{currencySymbol}</Text>
                      <TextInput style={s.inputPrefixed} placeholder="0" placeholderTextColor={t.text3} value={budget}
                        onChangeText={(v) => { budgetManuallySet.current = true; setBudget(v); }} keyboardType="decimal-pad" />
                    </View>
                    {/* Auto-budget tip */}
                    <View style={s.tipBox}>
                      <Text style={{ color: t.auraAqua, fontSize: 17 }}>✨</Text>
                      <Text style={s.tipText}>Leave this blank and I'll calculate a healthy budget from your income automatically.</Text>
                    </View>
                  </View>
                </View>
              )}

              {/* ── Step 3: Goal ── */}
              {step === 2 && (
                <View style={s.stepContent}>
                  <FinniSay>{STEP_MESSAGES[2]}</FinniSay>
                  <View style={s.goalGrid}>
                    {GOAL_CARDS.map((card) => {
                      const active = selectedGoal?.type === card.type;
                      return (
                        <TouchableOpacity
                          key={card.type}
                          style={[s.goalCard, active && { borderColor: card.color + '8C', backgroundColor: card.color + '18' }]}
                          onPress={() => setSelectedGoal(card)}
                          activeOpacity={0.8}
                        >
                          <View style={[s.goalIconBox, { backgroundColor: card.color + '2E', borderColor: card.color + '4D' }]}>
                            <GoalIcon type={card.type} color={card.color} />
                          </View>
                          <Text style={[s.goalLabel, active && { color: '#fff' }]}>{card.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {selectedGoal && (
                    <View style={s.goalDetails}>
                      <View style={s.fieldGroup}>
                        <Text style={s.fieldLabel}>Goal name</Text>
                        <TextInput style={s.input} value={goalName} onChangeText={setGoalName} placeholder="Name your goal" placeholderTextColor={t.text3} />
                      </View>
                      <View style={s.fieldGroup}>
                        <Text style={s.fieldLabel}>Target amount <Text style={s.optional}>(optional)</Text></Text>
                        <View style={s.inputWithPrefix}>
                          <Text style={s.inputPrefix}>{currencySymbol}</Text>
                          <TextInput style={s.inputPrefixed} placeholder="0" placeholderTextColor={t.text3} value={targetAmount} onChangeText={setTargetAmount} keyboardType="decimal-pad" />
                        </View>
                      </View>
                      <View style={s.fieldGroup}>
                        <Text style={s.fieldLabel}>Deadline <Text style={s.optional}>(optional)</Text></Text>
                        <TouchableOpacity style={s.input} onPress={() => setShowDeadlinePicker(true)} activeOpacity={0.75}>
                          <Text style={[s.datePickerText, { color: deadline ? t.text : t.text3 }]}>
                            {deadline ? fmtShort(deadline) : 'Select a deadline'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                </View>
              )}
            </Animated.View>
          </ScrollView>

          {/* Bottom CTA */}
          <View style={s.bottomActions}>
            <TouchableOpacity
              onPress={handleContinue}
              disabled={isSaving || !canNext}
              activeOpacity={0.8}
            >
              <LinearGradient
                colors={['#5EEAD4', '#A5B4FC']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[s.ctaGradient, (!canNext || isSaving) && { opacity: 0.5 }]}
              >
                <Text style={s.ctaGradientText}>
                  {isSaving ? 'Saving...' : step === 2 ? (selectedGoal && goalName.trim() ? 'Set goal & finish' : 'Finish setup') : 'Continue'}
                </Text>
                {!isSaving && <Text style={{ fontSize: 18, color: '#0b0a1a' }}>→</Text>}
              </LinearGradient>
            </TouchableOpacity>
            {step === 2 && (
              <TouchableOpacity onPress={() => advance()} style={s.skipButton}>
                <Text style={s.skipText}>Set up goals later</Text>
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <DatePicker
        visible={showDeadlinePicker}
        value={deadline || null}
        minDate={new Date().toISOString().slice(0, 10)}
        title="Set deadline"
        onApply={(date) => setDeadline(date)}
        onClose={() => setShowDeadlinePicker(false)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.auraBg },

  // Progress
  progressRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, paddingTop: 12, paddingBottom: 8,
  },
  backBtn: { width: 38, height: 38, borderRadius: t.rPill, backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 26, color: t.text, fontWeight: '600', lineHeight: 30 },
  progressBar: { flex: 1, flexDirection: 'row' },
  progressSegment: { flex: 1, height: 4, borderRadius: 99, backgroundColor: t.glass, overflow: 'hidden' },
  progressFill: { flex: 1, borderRadius: 99 },

  // Content
  scrollContent: { paddingHorizontal: 22, paddingBottom: 24 },
  stepContent: { gap: 22 },
  fieldGroup: { gap: 0 },

  // Finni bubble
  finniRow: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  finniMessageBubble: {
    flex: 1, padding: 14, paddingHorizontal: 17,
    borderTopLeftRadius: 8, borderTopRightRadius: 22, borderBottomRightRadius: 22, borderBottomLeftRadius: 22,
  },
  finniMessageText: { fontSize: 15, fontFamily: fonts.medium, fontWeight: '500', color: t.text, lineHeight: 23 },

  // Fields
  fieldLabel: { fontSize: 14.5, fontFamily: fonts.bold, fontWeight: '700', color: t.text, marginBottom: 10, marginLeft: 2, letterSpacing: -0.2 },
  req: { color: t.auraRose, fontSize: 14 },
  optional: { color: t.text3, fontWeight: '400', fontSize: 12.5 },
  input: {
    backgroundColor: t.glass2, borderWidth: 1, borderColor: t.glassLine, borderRadius: t.rMd,
    paddingHorizontal: 18, paddingVertical: 16, fontSize: 16, fontFamily: fonts.medium, color: t.text,
  },
  datePickerText: { fontSize: 16, fontFamily: fonts.medium },
  inputWithPrefix: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: t.glass2, borderWidth: 1, borderColor: t.glassLine, borderRadius: t.rMd,
  },
  inputPrefix: { fontSize: 18, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text2, paddingLeft: 18, paddingRight: 8 },
  inputPrefixed: { flex: 1, paddingVertical: 16, paddingRight: 18, fontSize: 16, fontFamily: fonts.medium, color: t.text },

  // Tip box
  tipBox: {
    flexDirection: 'row', gap: 9, marginTop: 12, padding: 12, paddingHorizontal: 14,
    borderRadius: t.rMd, backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine,
  },
  tipText: { flex: 1, fontSize: 13, fontFamily: fonts.medium, fontWeight: '500', color: t.text2, lineHeight: 19.5 },

  // Chips
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  chip: { backgroundColor: t.glass2, borderWidth: 1, borderColor: t.glassLine, borderRadius: t.rPill, paddingHorizontal: 14, paddingVertical: 10 },
  chipActive: { backgroundColor: t.auraIndigo, borderColor: t.auraIndigo },
  chipText: { fontSize: 14, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text2 },
  chipTextActive: { color: '#fff' },

  // Goals
  goalGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginBottom: 8 },
  goalCard: {
    width: '47%', backgroundColor: t.glass2, borderWidth: 1, borderColor: t.glassLine, borderRadius: t.rLg,
    padding: 16, alignItems: 'flex-start', gap: 12,
  },
  goalIconBox: {
    width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  goalLabel: { fontSize: 15, fontFamily: fonts.bold, fontWeight: '700', color: t.text },
  goalDetails: { gap: 18 },

  // Bottom
  bottomActions: { paddingHorizontal: 22, paddingBottom: 8, paddingTop: 12 },
  ctaGradient: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
    paddingVertical: 17, borderRadius: t.rMd,
  },
  ctaGradientText: { fontSize: 17, fontFamily: fonts.bold, fontWeight: '700', color: '#0b0a1a' },
  skipButton: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  skipText: { fontSize: 14.5, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text3 },

  // Completion
  completionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40, gap: 16 },
  completionTitle: { fontSize: 28, fontFamily: fonts.extraBold, fontWeight: '800', color: t.text, textAlign: 'center', marginTop: 16 },
  completionSubtitle: { fontSize: 16, fontFamily: fonts.regular, color: t.text2, textAlign: 'center' },
});
