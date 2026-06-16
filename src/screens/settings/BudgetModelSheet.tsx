import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, ScrollView, Dimensions, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { classifyCategoryBuckets } from '../../lib/agents';
import {
  BUDGET_MODELS, classifyByKeyword, allocateBudgets,
  type Bucket, type BudgetModel, type CatInput, type AllocationResult,
} from '../../lib/budgetModels';
import { t, fonts } from '../../theme/tokens';
import { styles } from './settingsStyles';
import Aurora from '../../components/Aurora';
import GlassCard from '../../components/GlassCard';
import type { Category } from './types';

const { width: SW, height: SH } = Dimensions.get('window');
const BUCKET_LABEL: Record<Bucket, string> = { needs: 'Needs', wants: 'Wants', savings: 'Savings' };
const BUCKET_COLOR: Record<Bucket, string> = { needs: '#5EEAD4', wants: '#9d8cff', savings: '#34D399' };

interface Props {
  userId: string;
  categories: Category[];
  currencySymbol: string;
  onClose: () => void;
  onApplied: () => void;
}

export default function BudgetModelSheet({ userId, categories, currencySymbol, onClose, onApplied }: Props) {
  const [income, setIncome] = useState<number | null>(null);
  const [selected, setSelected] = useState<BudgetModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [preview, setPreview] = useState<{ result: AllocationResult; inputs: CatInput[] } | null>(null);

  useEffect(() => {
    supabase.from('income').select('amount, frequency').eq('user_id', userId).then(({ data }) => {
      const m = (data ?? []).reduce((sum, r) => {
        const a = Number(r.amount) || 0;
        if (r.frequency === 'weekly') return sum + a * 4.33;
        if (r.frequency === 'annual') return sum + a / 12;
        return sum + a;
      }, 0);
      setIncome(m);
    });
  }, [userId]);

  const pick = async (model: BudgetModel) => {
    if (busy || !income) return;
    setSelected(model);
    setBusy(true);
    setPreview(null);
    // Keyword classify first; only ask the AI about the leftovers.
    const buckets: Record<string, Bucket> = {};
    const unknown: string[] = [];
    for (const c of categories) {
      const kb = classifyByKeyword(c.name);
      if (kb) buckets[c.id] = kb; else unknown.push(c.name);
    }
    if (unknown.length) {
      const aiMap = await classifyCategoryBuckets(unknown);
      for (const c of categories) {
        if (buckets[c.id]) continue;
        const b = aiMap[c.name];
        buckets[c.id] = b === 'needs' || b === 'wants' || b === 'savings' ? b : 'wants';
      }
    }
    const inputs: CatInput[] = categories.map((c) => ({ id: c.id, name: c.name, spent: c.spent ?? 0, bucket: buckets[c.id] ?? 'wants' }));
    setPreview({ result: allocateBudgets(model, income, inputs), inputs });
    setBusy(false);
  };

  const apply = async () => {
    if (!preview || applying) return;
    setApplying(true);
    await Promise.all(preview.result.allocations.map((a) =>
      supabase.from('categories').update({ budget: a.budget, type: 'monthly' }).eq('id', a.id).eq('user_id', userId)));
    setApplying(false);
    onApplied();
    onClose();
  };

  const catById = new Map(categories.map((c) => [c.id, c]));
  const noIncome = income === 0;

  return (
    <View style={styles.modalRoot}>
      <Aurora width={SW} height={SH} />
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>Smart Budget</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}><Text style={styles.closeBtnText}>✕</Text></TouchableOpacity>
        </View>

        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent} showsVerticalScrollIndicator={false}>
          {income === null ? (
            <View style={styles.modalLoading}><ActivityIndicator size="large" color={t.auraAqua} /></View>
          ) : noIncome ? (
            <View style={styles.emptyState}>
              <Text style={[s.h, { textAlign: 'center' }]}>Add an income source first</Text>
              <Text style={s.sub}>Smart Budget splits your monthly income across categories — it needs to know your income.</Text>
            </View>
          ) : (
            <>
              <Text style={s.sub}>Pick a budgeting framework. Finni sorts your categories into needs, wants and savings, then splits your income to match.</Text>

              {BUDGET_MODELS.map((m) => {
                const active = selected?.id === m.id;
                return (
                  <TouchableOpacity key={m.id} activeOpacity={0.85} onPress={() => pick(m)}>
                    <GlassCard style={StyleSheet.flatten([s.modelCard, active && s.modelCardActive])}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={s.modelName}>{m.name}</Text>
                        {active && busy ? <ActivityIndicator size="small" color={t.auraAqua} /> : null}
                      </View>
                      <Text style={s.modelTag}>{m.tagline}</Text>
                    </GlassCard>
                  </TouchableOpacity>
                );
              })}

              {preview && !busy ? (
                <View style={{ marginTop: 18 }}>
                  <Text style={s.previewHead}>Proposed monthly budgets</Text>
                  {preview.inputs
                    .map((ci) => ({ ci, alloc: preview.result.allocations.find((a) => a.id === ci.id) }))
                    .sort((a, b) => (b.alloc?.budget ?? 0) - (a.alloc?.budget ?? 0))
                    .map(({ ci, alloc }) => {
                      const cat = catById.get(ci.id);
                      return (
                        <View key={ci.id} style={s.row}>
                          <Text style={s.rowName}>{cat?.emoji ?? '📦'}  {cat?.name ?? ci.name}
                            <Text style={[s.bucketTag, { color: BUCKET_COLOR[ci.bucket] }]}>  · {BUCKET_LABEL[ci.bucket]}</Text>
                          </Text>
                          <Text style={s.rowAmt}>{currencySymbol}{Math.round(alloc?.budget ?? 0).toLocaleString()}</Text>
                        </View>
                      );
                    })}

                  <View style={[s.row, { borderTopWidth: 1, borderTopColor: t.glassLine2, marginTop: 6, paddingTop: 12 }]}>
                    <Text style={[s.rowName, { color: BUCKET_COLOR.savings, fontFamily: fonts.semiBold }]}>💰  Savings target</Text>
                    <Text style={[s.rowAmt, { color: BUCKET_COLOR.savings }]}>{currencySymbol}{Math.round(preview.result.savingsAmount).toLocaleString()}</Text>
                  </View>
                  {!preview.result.savingsHasHome && preview.result.savingsAmount > 0 ? (
                    <Text style={s.savingsNote}>You have no savings category yet — set aside {currencySymbol}{Math.round(preview.result.savingsAmount).toLocaleString()}/month, or add a “Savings” category to track it.</Text>
                  ) : null}

                  <TouchableOpacity style={[styles.btnPrimary, { marginTop: 18 }]} onPress={apply} disabled={applying} activeOpacity={0.85}>
                    {applying ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPrimaryText}>Apply these budgets</Text>}
                  </TouchableOpacity>
                  <Text style={s.overwriteNote}>This overwrites your current category budgets.</Text>
                </View>
              ) : null}
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  h: { fontSize: 17, fontFamily: fonts.bold, color: t.text, marginBottom: 8 },
  sub: { fontSize: 13.5, fontFamily: fonts.regular, color: t.text2, lineHeight: 19, marginBottom: 18 },
  modelCard: { padding: 16, marginBottom: 10 },
  modelCardActive: { borderColor: t.auraIndigo },
  modelName: { fontSize: 16, fontFamily: fonts.bold, color: t.text },
  modelTag: { fontSize: 13, fontFamily: fonts.regular, color: t.text3, marginTop: 3 },
  previewHead: { fontSize: 12, fontFamily: fonts.semiBold, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 9 },
  rowName: { flex: 1, fontSize: 14.5, fontFamily: fonts.regular, color: t.text },
  bucketTag: { fontSize: 12, fontFamily: fonts.medium },
  rowAmt: { fontSize: 14.5, fontFamily: fonts.semiBold, color: t.text },
  savingsNote: { fontSize: 12, fontFamily: fonts.regular, color: t.amber, marginTop: 8, lineHeight: 17 },
  overwriteNote: { fontSize: 11.5, fontFamily: fonts.regular, color: t.text3, textAlign: 'center', marginTop: 8 },
});
