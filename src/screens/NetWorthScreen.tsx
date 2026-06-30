import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput,
  ActivityIndicator, Alert, useWindowDimensions, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import Aurora from '../components/Aurora';
import GlassCard from '../components/GlassCard';
import { t, fonts } from '../theme/tokens';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import {
  getNetWorth, addNetWorthItem, updateNetWorthItem, deleteNetWorthItem,
  ASSET_TYPES, LIABILITY_TYPES, TYPE_LABELS,
  type NetWorthSummary, type NetWorthItem, type NetWorthKind,
} from '../lib/netWorth';

const EMPTY: NetWorthSummary = {
  assets: [], liabilities: [], investmentsValue: 0,
  totalAssets: 0, totalLiabilities: 0, netWorth: 0,
};

export default function NetWorthScreen() {
  const { width, height } = useWindowDimensions();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const { currencySymbol } = useProfile();
  const [data, setData] = useState<NetWorthSummary>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<{ kind: NetWorthKind; item?: NetWorthItem } | null>(null);

  const fmt = (n: number) =>
    `${n < 0 ? '-' : ''}${currencySymbol}${Math.abs(Math.round(n)).toLocaleString()}`;

  const load = useCallback(() => {
    if (!user?.id) return;
    setLoading(true);
    getNetWorth(user.id).then((d) => { setData(d); setLoading(false); });
  }, [user?.id]);
  useFocusEffect(load);

  return (
    <View style={s.root}>
      <Aurora width={width} height={height} />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}><Text style={s.back}>‹</Text></TouchableOpacity>
          <Text style={s.title}>Net Worth</Text>
          <View style={{ width: 24 }} />
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={t.auraAqua} /></View>
        ) : (
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            {/* Hero */}
            <GlassCard style={s.hero} borderRadius={t.rLg} intensity={26}>
              <Text style={s.heroLabel}>Net worth</Text>
              <Text style={[s.heroValue, { color: data.netWorth >= 0 ? t.green : t.auraRose }]}>{fmt(data.netWorth)}</Text>
              <View style={s.heroSplit}>
                <View style={s.heroCol}>
                  <Text style={s.heroColLabel}>Assets</Text>
                  <Text style={[s.heroColVal, { color: t.green }]}>{fmt(data.totalAssets)}</Text>
                </View>
                <View style={s.heroDiv} />
                <View style={s.heroCol}>
                  <Text style={s.heroColLabel}>Liabilities</Text>
                  <Text style={[s.heroColVal, { color: t.auraRose }]}>{fmt(data.totalLiabilities)}</Text>
                </View>
              </View>
            </GlassCard>

            {/* Assets */}
            <Section
              title="Assets"
              onAdd={() => setEditing({ kind: 'asset' })}
            >
              {/* Investments auto-line */}
              <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={() => navigation.navigate('MainTabs', { screen: 'Investments' })}>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowName}>Investments</Text>
                  <Text style={s.rowType}>Auto · from your portfolio ›</Text>
                </View>
                <Text style={[s.rowVal, { color: t.green }]}>{fmt(data.investmentsValue)}</Text>
              </TouchableOpacity>
              {data.assets.map((item) => (
                <ItemRow key={item.id} item={item} fmt={fmt} color={t.green} onPress={() => setEditing({ kind: 'asset', item })} />
              ))}
              {data.assets.length === 0 && <Text style={s.empty}>Add cash, savings, property…</Text>}
            </Section>

            {/* Liabilities */}
            <Section
              title="Liabilities"
              onAdd={() => setEditing({ kind: 'liability' })}
            >
              {data.liabilities.map((item) => (
                <ItemRow key={item.id} item={item} fmt={fmt} color={t.auraRose} onPress={() => setEditing({ kind: 'liability', item })} />
              ))}
              {data.liabilities.length === 0 && <Text style={s.empty}>Add debt, loans, credit cards…</Text>}
            </Section>

            <Text style={s.footnote}>Your investment portfolio is included automatically. Everything else is what you add here.</Text>
          </ScrollView>
        )}
      </SafeAreaView>

      {editing && (
        <ItemEditor
          userId={user!.id}
          kind={editing.kind}
          item={editing.item}
          currencySymbol={currencySymbol}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </View>
  );
}

function Section({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <View style={s.sectionHead}>
        <Text style={s.sectionTitle}>{title}</Text>
        <TouchableOpacity onPress={onAdd} hitSlop={10}><Text style={s.add}>+ Add</Text></TouchableOpacity>
      </View>
      <GlassCard style={s.sectionCard} borderRadius={t.rLg} intensity={18}>{children}</GlassCard>
    </View>
  );
}

function ItemRow({ item, fmt, color, onPress }: { item: NetWorthItem; fmt: (n: number) => string; color: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.row} activeOpacity={0.7} onPress={onPress}>
      <View style={{ flex: 1 }}>
        <Text style={s.rowName}>{item.name}</Text>
        <Text style={s.rowType}>{item.item_type ? TYPE_LABELS[item.item_type] ?? item.item_type : ''}</Text>
      </View>
      <Text style={[s.rowVal, { color }]}>{fmt(item.value)}</Text>
    </TouchableOpacity>
  );
}

function ItemEditor({
  userId, kind, item, currencySymbol, onClose, onSaved,
}: {
  userId: string; kind: NetWorthKind; item?: NetWorthItem; currencySymbol: string;
  onClose: () => void; onSaved: () => void;
}) {
  const types = kind === 'asset' ? ASSET_TYPES : LIABILITY_TYPES;
  const [name, setName] = useState(item?.name ?? '');
  const [type, setType] = useState<string>(item?.item_type ?? types[0]);
  const [value, setValue] = useState(item ? String(item.value) : '');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const v = parseFloat(value.replace(/,/g, ''));
    if (!name.trim() || isNaN(v) || v < 0) { Alert.alert('Check your entry', 'Add a name and a valid amount.'); return; }
    setBusy(true);
    const okDone = item
      ? await updateNetWorthItem(userId, item.id, { name, item_type: type, value: v })
      : await addNetWorthItem(userId, kind, name, type, v);
    setBusy(false);
    if (okDone) onSaved();
    else Alert.alert('Could not save', 'Please try again.');
  };

  const remove = () => {
    if (!item) return;
    Alert.alert('Delete item', `Remove "${item.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteNetWorthItem(userId, item.id); onSaved(); } },
    ]);
  };

  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.sheetWrap}>
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <Text style={s.sheetTitle}>{item ? 'Edit' : 'Add'} {kind === 'asset' ? 'asset' : 'liability'}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={10}><Text style={s.sheetClose}>✕</Text></TouchableOpacity>
          </View>

          <Text style={s.fieldLabel}>Name</Text>
          <TextInput
            style={s.input} value={name} onChangeText={setName}
            placeholder={kind === 'asset' ? 'e.g. Savings account' : 'e.g. Car loan'}
            placeholderTextColor={t.text3}
          />

          <Text style={s.fieldLabel}>Type</Text>
          <View style={s.chips}>
            {types.map((ty) => (
              <TouchableOpacity key={ty} onPress={() => setType(ty)} style={[s.chip, type === ty && s.chipOn]} activeOpacity={0.7}>
                <Text style={[s.chipText, type === ty && s.chipTextOn]}>{TYPE_LABELS[ty]}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={s.fieldLabel}>Value ({currencySymbol})</Text>
          <TextInput
            style={s.input} value={value} onChangeText={setValue}
            placeholder="0" placeholderTextColor={t.text3} keyboardType="numeric"
          />

          <TouchableOpacity style={s.saveBtn} onPress={save} disabled={busy} activeOpacity={0.85}>
            {busy ? <ActivityIndicator color="#0b0a1a" /> : <Text style={s.saveTxt}>{item ? 'Save' : 'Add'}</Text>}
          </TouchableOpacity>
          {item && (
            <TouchableOpacity style={s.deleteBtn} onPress={remove} activeOpacity={0.7}>
              <Text style={s.deleteTxt}>Delete</Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.auraBg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  back: { fontSize: 32, color: t.text2, marginTop: -4 },
  title: { fontSize: 18, fontFamily: fonts.bold, color: t.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 18, paddingBottom: 60 },
  hero: { padding: 22, alignItems: 'center' },
  heroLabel: { fontSize: 13, fontFamily: fonts.medium, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5 },
  heroValue: { fontSize: 38, fontFamily: fonts.extraBold, letterSpacing: -1, marginTop: 6 },
  heroSplit: { flexDirection: 'row', alignItems: 'center', marginTop: 18, alignSelf: 'stretch' },
  heroCol: { flex: 1, alignItems: 'center', gap: 3 },
  heroColLabel: { fontSize: 12, fontFamily: fonts.medium, color: t.text3 },
  heroColVal: { fontSize: 17, fontFamily: fonts.bold },
  heroDiv: { width: 1, height: 34, backgroundColor: t.glassLine },
  section: { marginTop: 22 },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 15, fontFamily: fonts.bold, color: t.text },
  add: { fontSize: 14, fontFamily: fonts.semiBold, color: t.auraAqua },
  sectionCard: { paddingHorizontal: 14, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.glassLine },
  rowName: { fontSize: 15, fontFamily: fonts.semiBold, color: t.text },
  rowType: { fontSize: 12.5, fontFamily: fonts.regular, color: t.text3, marginTop: 2 },
  rowVal: { fontSize: 16, fontFamily: fonts.bold },
  empty: { fontSize: 13, fontFamily: fonts.regular, color: t.text3, paddingVertical: 14 },
  footnote: { fontSize: 12, fontFamily: fonts.regular, color: t.text3, textAlign: 'center', lineHeight: 18, marginTop: 22, paddingHorizontal: 16 },
  // editor sheet
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: { backgroundColor: '#14121f', borderTopLeftRadius: t.rXl, borderTopRightRadius: t.rXl, padding: 22, paddingBottom: 34, gap: 4 },
  sheetHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sheetTitle: { fontSize: 17, fontFamily: fonts.bold, color: t.text },
  sheetClose: { fontSize: 18, color: t.text2 },
  fieldLabel: { fontSize: 12, fontFamily: fonts.semiBold, color: t.text3, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 7 },
  input: { backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: t.glassLine, borderRadius: t.rMd, paddingHorizontal: 15, paddingVertical: 13, fontSize: 16, color: t.text, fontFamily: fonts.regular },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: t.glassLine },
  chipOn: { backgroundColor: 'rgba(94,234,212,0.12)', borderColor: t.auraAqua },
  chipText: { fontSize: 13, fontFamily: fonts.medium, color: t.text2 },
  chipTextOn: { color: t.auraAqua },
  saveBtn: { backgroundColor: t.auraAqua, borderRadius: t.rMd, paddingVertical: 15, alignItems: 'center', marginTop: 22 },
  saveTxt: { fontSize: 16, fontFamily: fonts.bold, color: '#0b0a1a' },
  deleteBtn: { alignItems: 'center', paddingVertical: 14 },
  deleteTxt: { fontSize: 14, fontFamily: fonts.semiBold, color: t.auraRose },
});
