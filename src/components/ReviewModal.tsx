import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t, fonts } from '../theme/tokens';
import { listPending, acceptExtracted, rejectExtracted, type ExtractedTxn } from '../lib/emailCapture';
import CategoryPickerSheet, { type PickerCategory } from './CategoryPickerSheet';
import Aurora from './Aurora';
import { useWindowDimensions } from 'react-native';

interface Props {
  visible: boolean;
  userId: string;
  categories: PickerCategory[];
  currencySymbol: string;
  onClose: () => void;
  onChanged: () => void; // refresh pending badge in parent
}

// Review queue for auto-captured (email/push) transactions. Nothing here is in
// the ledger yet — the user accepts (optionally re-categorizing) or rejects.
export default function ReviewModal({ visible, userId, categories, currencySymbol, onClose, onChanged }: Props) {
  const { width, height } = useWindowDimensions();
  const [items, setItems] = useState<ExtractedTxn[]>([]);
  const [loading, setLoading] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, string | null>>({}); // id → chosen category
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [picking, setPicking] = useState<ExtractedTxn | null>(null);

  const refresh = () => { setLoading(true); listPending(userId).then((r) => { setItems(r); setLoading(false); }); };
  useEffect(() => { if (visible && userId) refresh(); }, [visible, userId]);

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'Uncategorized';
  const chosenCat = (item: ExtractedTxn) => (item.id in overrides ? overrides[item.id] : item.suggested_category_id);

  const accept = async (item: ExtractedTxn) => {
    if (busy[item.id]) return;
    setBusy((b) => ({ ...b, [item.id]: true }));
    const okDone = await acceptExtracted(userId, item, chosenCat(item));
    setBusy((b) => ({ ...b, [item.id]: false }));
    if (okDone) { setItems((xs) => xs.filter((x) => x.id !== item.id)); onChanged(); }
  };
  const reject = async (item: ExtractedTxn) => {
    if (busy[item.id]) return;
    await rejectExtracted(userId, item.id);
    setItems((xs) => xs.filter((x) => x.id !== item.id));
    onChanged();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" onRequestClose={onClose}>
      <View style={s.root}>
        <Aurora width={width} height={height} />
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <View style={s.header}>
            <Text style={s.title}>Review</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}><Text style={s.close}>✕</Text></TouchableOpacity>
          </View>
          <Text style={s.sub}>Transactions Finni captured from your forwarded emails. Confirm or skip — nothing is saved until you accept.</Text>

          <ScrollView contentContainerStyle={s.list} showsVerticalScrollIndicator={false}>
            {loading ? (
              <View style={s.center}><ActivityIndicator size="large" color={t.auraAqua} /></View>
            ) : items.length === 0 ? (
              <View style={s.center}>
                <Text style={s.emptyTitle}>Nothing to review 🎉</Text>
                <Text style={s.emptySub}>Forwarded bank emails will appear here to confirm. Set it up in Settings → Auto-import.</Text>
              </View>
            ) : items.map((item) => {
              const isIncome = item.direction === 'income';
              const cid = chosenCat(item);
              return (
                <View key={item.id} style={s.card}>
                  <View style={s.cardTop}>
                    <Text style={s.merchant} numberOfLines={1}>{item.merchant ?? 'Transaction'}</Text>
                    <Text style={[s.amount, { color: isIncome ? t.green : t.text }]}>
                      {isIncome ? '+' : '-'}{currencySymbol}{Math.round(item.amount).toLocaleString()}
                    </Text>
                  </View>
                  <View style={s.metaRow}>
                    <Text style={s.source}>📧 email</Text>
                    {item.occurred_at ? <Text style={s.meta}>· {new Date(item.occurred_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</Text> : null}
                    {(item.confidence ?? 1) < 0.6 ? <Text style={s.lowConf}>· double-check</Text> : null}
                  </View>
                  <TouchableOpacity style={s.catRow} onPress={() => setPicking(item)} activeOpacity={0.7}>
                    <Text style={s.catLabel}>Category</Text>
                    <Text style={s.catValue}>{catName(cid)}  ›</Text>
                  </TouchableOpacity>
                  <View style={s.actions}>
                    <TouchableOpacity style={s.rejectBtn} onPress={() => reject(item)} hitSlop={6}>
                      <Text style={s.rejectTxt}>Skip</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={s.acceptBtn} onPress={() => accept(item)} hitSlop={6} disabled={busy[item.id]}>
                      {busy[item.id] ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.acceptTxt}>Accept</Text>}
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </SafeAreaView>
      </View>

      <CategoryPickerSheet
        visible={!!picking}
        categories={categories}
        currentCategoryId={picking ? chosenCat(picking) : null}
        onSelect={(catId) => { if (picking) setOverrides((o) => ({ ...o, [picking.id]: catId })); }}
        onClose={() => setPicking(null)}
      />
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.auraBg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 20, fontFamily: fonts.bold, color: t.text },
  close: { fontSize: 20, color: t.text2 },
  sub: { fontSize: 13, fontFamily: fonts.regular, color: t.text2, paddingHorizontal: 20, paddingBottom: 8, lineHeight: 18 },
  list: { padding: 16, gap: 12, paddingBottom: 60 },
  center: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontFamily: fonts.bold, color: t.text },
  emptySub: { fontSize: 13.5, fontFamily: fonts.regular, color: t.text2, textAlign: 'center', lineHeight: 20 },
  card: { backgroundColor: 'rgba(14,12,26,0.97)', borderRadius: t.rMd, borderWidth: 1, borderColor: t.glassLine2, padding: 14 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  merchant: { flex: 1, fontSize: 15, fontFamily: fonts.semiBold, color: t.text },
  amount: { fontSize: 16, fontFamily: fonts.bold },
  metaRow: { flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' },
  source: { fontSize: 12, fontFamily: fonts.medium, color: t.text3 },
  meta: { fontSize: 12, fontFamily: fonts.regular, color: t.text3 },
  lowConf: { fontSize: 12, fontFamily: fonts.medium, color: t.amber },
  catRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.glassLine2 },
  catLabel: { fontSize: 13, fontFamily: fonts.regular, color: t.text3 },
  catValue: { fontSize: 13, fontFamily: fonts.semiBold, color: t.auraAqua },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  rejectBtn: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: t.glassLine2 },
  rejectTxt: { fontSize: 14, fontFamily: fonts.semiBold, color: t.text3 },
  acceptBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: t.auraIndigo, alignItems: 'center' },
  acceptTxt: { fontSize: 14, fontFamily: fonts.semiBold, color: '#fff' },
});
