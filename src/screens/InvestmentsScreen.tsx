import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal,
  TextInput, Alert, ActivityIndicator, Dimensions, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { supabase } from '../lib/supabase';
import { trackScreen } from '../lib/analytics';
import { t, fonts } from '../theme/tokens';
import Aurora from '../components/Aurora';
import GlassCard from '../components/GlassCard';
import Orb from '../components/Orb';

const { width: SW, height: SH } = Dimensions.get('window');

type Investment = {
  id: string;
  user_id: string;
  name: string;
  ticker: string | null;
  asset_type: 'stock' | 'crypto' | 'mutual_fund' | 'gold' | 'other';
  quantity: number;
  buy_price: number;
  current_value: number;
  currency: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

type AssetFilter = 'all' | 'stock' | 'crypto' | 'mutual_fund' | 'gold' | 'other';

const ASSET_COLORS: Record<string, string> = {
  stock: t.auraViolet,
  crypto: '#FBBF24',
  mutual_fund: t.auraBlue,
  gold: '#FBBF24',
  other: t.auraAqua,
};

const ASSET_LABELS: Record<string, string> = {
  stock: 'Stocks',
  crypto: 'Crypto',
  mutual_fund: 'Mutual Funds',
  gold: 'Gold',
  other: 'Other',
};

const ASSET_TYPES: AssetFilter[] = ['stock', 'crypto', 'mutual_fund', 'gold', 'other'];

function getAbbr(inv: Investment): string {
  if (inv.ticker) return inv.ticker.slice(0, 3).toUpperCase();
  return inv.name.slice(0, 2).toUpperCase();
}

const PRESET_TYPES = ['stock', 'crypto', 'mutual_fund', 'gold', 'bond', 'real_estate', 'other'];

function AssetTypeCombo({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [query, setQuery] = React.useState(value.replace(/_/g, ' '));
  const [open, setOpen] = React.useState(false);
  const matches = PRESET_TYPES.filter(p => p.replace(/_/g, ' ').toLowerCase().includes(query.toLowerCase()));
  const isExact = PRESET_TYPES.some(p => p.toLowerCase() === query.toLowerCase().replace(/ /g, '_'));
  const showCustom = query.trim().length > 0 && !isExact;

  const pick = (raw: string) => {
    onChange(raw);
    setQuery(raw.replace(/_/g, ' '));
    setOpen(false);
  };

  return (
    <View style={{ zIndex: 10 }}>
      <TextInput
        style={[s.formInput, { marginBottom: 0 }]}
        value={query}
        onChangeText={(v) => { setQuery(v); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="e.g. stock, crypto, gold…"
        placeholderTextColor={t.text3}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {open && (matches.length > 0 || showCustom) && (
        <View style={s.comboDropdown}>
          {matches.map(p => (
            <TouchableOpacity key={p} style={s.comboOption} onPress={() => pick(p)} activeOpacity={0.75}>
              <Text style={s.comboOptionText}>{p.replace(/_/g, ' ')}</Text>
            </TouchableOpacity>
          ))}
          {showCustom && (
            <TouchableOpacity style={s.comboOption} onPress={() => pick(query.trim().toLowerCase().replace(/ /g, '_'))} activeOpacity={0.75}>
              <Text style={[s.comboOptionText, { color: t.auraAqua }]}>Add as custom: "{query.trim()}"</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

export default function InvestmentsScreen() {
  const { user } = useAuth();
  const { currencySymbol } = useProfile();
  const [investments, setInvestments] = useState<Investment[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AssetFilter>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingInv, setEditingInv] = useState<Investment | null>(null);
  const [detailInv, setDetailInv] = useState<Investment | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  // Form state
  const [formName, setFormName] = useState('');
  const [formTicker, setFormTicker] = useState('');
  const [formType, setFormType] = useState<string>('stock');
  const [formQty, setFormQty] = useState('');
  const [formBuyPrice, setFormBuyPrice] = useState('');
  const [formCurrentVal, setFormCurrentVal] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchInvestments = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('investments')
      .select('*')
      .eq('user_id', user.id)
      .order('current_value', { ascending: false });
    if (!error && data) setInvestments(data as Investment[]);
    setLoading(false);
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    fetchInvestments();
    trackScreen('InvestmentsScreen');
  }, [fetchInvestments]));

  // Computed values
  const totalValue = useMemo(() =>
    investments.reduce((sum, inv) => sum + inv.quantity * inv.current_value, 0), [investments]);
  const totalCost = useMemo(() =>
    investments.reduce((sum, inv) => sum + inv.quantity * inv.buy_price, 0), [investments]);
  const totalReturn = totalValue - totalCost;
  const totalReturnPct = totalCost > 0 ? ((totalReturn / totalCost) * 100).toFixed(1) : '0.0';
  const isUp = totalReturn >= 0;

  const allocation = useMemo(() => {
    const groups: Record<string, number> = {};
    investments.forEach((inv) => {
      const val = inv.quantity * inv.current_value;
      groups[inv.asset_type] = (groups[inv.asset_type] ?? 0) + val;
    });
    return Object.entries(groups)
      .map(([type, val]) => ({
        type,
        label: ASSET_LABELS[type] ?? type,
        color: ASSET_COLORS[type] ?? t.auraBlue,
        pct: totalValue > 0 ? Math.round((val / totalValue) * 100) : 0,
      }))
      .sort((a, b) => b.pct - a.pct);
  }, [investments, totalValue]);

  const filteredHoldings = useMemo(() =>
    filter === 'all' ? investments : investments.filter((inv) => inv.asset_type === filter),
    [investments, filter]);

  const filterKinds = useMemo(() => {
    const types = new Set(investments.map((inv) => inv.asset_type));
    return ['all', ...Array.from(types)] as AssetFilter[];
  }, [investments]);

  // CRUD
  const openAdd = () => {
    setEditingInv(null);
    setFormName(''); setFormTicker(''); setFormType('stock');
    setFormQty(''); setFormBuyPrice(''); setFormCurrentVal(''); setFormNotes('');
    setShowModal(true);
  };

  const openEdit = (inv: Investment) => {
    setEditingInv(inv);
    setFormName(inv.name);
    setFormTicker(inv.ticker ?? '');
    setFormType(inv.asset_type);
    setFormQty(String(inv.quantity));
    setFormBuyPrice(String(inv.buy_price));
    setFormCurrentVal(String(inv.current_value));
    setFormNotes(inv.notes ?? '');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!user?.id || !formName.trim()) return;
    const qty = parseFloat(formQty);
    const buyPrice = parseFloat(formBuyPrice);
    const currentVal = parseFloat(formCurrentVal) || buyPrice;
    if (isNaN(qty) || qty <= 0 || isNaN(buyPrice) || buyPrice <= 0) {
      Alert.alert('Error', 'Please enter valid quantity and price.');
      return;
    }
    setSaving(true);
    const payload = {
      user_id: user.id,
      name: formName.trim(),
      ticker: formTicker.trim() || null,
      asset_type: formType,
      quantity: qty,
      buy_price: buyPrice,
      current_value: currentVal,
      notes: formNotes.trim() || null,
    };
    if (editingInv) {
      const { error } = await supabase.from('investments').update(payload).eq('id', editingInv.id);
      if (error) { Alert.alert('Error', error.message); setSaving(false); return; }
    } else {
      const { error } = await supabase.from('investments').insert(payload);
      if (error) { Alert.alert('Error', error.message); setSaving(false); return; }
    }
    setSaving(false);
    setShowModal(false);
    fetchInvestments();
  };

  const handleDelete = (inv: Investment) => {
    Alert.alert('Delete Holding', `Remove "${inv.name}" from your portfolio?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await supabase.from('investments').delete().eq('id', inv.id);
          setInvestments((prev) => prev.filter((x) => x.id !== inv.id));
        },
      },
    ]);
  };

  if (loading) {
    return (
      <View style={s.root}>
        <Aurora width={SW} height={SH} />
        <View style={s.loadingWrap}>
          <ActivityIndicator size="large" color={t.auraAqua} />
          <Text style={s.loadingText}>Loading portfolio...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <Aurora width={SW} height={SH} />
      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.headerRow}>
          <View>
            <Text style={s.title}>Portfolio</Text>
            <Text style={s.subtitle}>Your wealth, growing</Text>
          </View>
          <View style={s.betaBadge}>
            <Text style={s.betaText}>BETA</Text>
          </View>
        </View>

        {investments.length === 0 ? (
          /* Empty state */
          <View style={s.emptyWrap}>
            <Orb size={104} rings={false} style={{ marginBottom: 20 }} />
            <Text style={s.emptyTitle}>No investments yet</Text>
            <Text style={s.emptySub}>Add your first holding to start tracking your portfolio</Text>
            <TouchableOpacity style={s.addBtn} onPress={openAdd} activeOpacity={0.8}>
              <Text style={s.addBtnText}>+ Add Investment</Text>
            </TouchableOpacity>
            <Text style={[s.emptySub, { marginTop: 16 }]}>
              Or just tell Finni in chat:{'\n'}"bought 10 shares of GP at 450"
            </Text>
          </View>
        ) : (
          <>
            {/* Value hero */}
            <GlassCard style={s.heroCard}>
              <Text style={s.eyebrow}>Total Value</Text>
              <Text style={s.heroValue}>{currencySymbol}{totalValue.toFixed(0)}</Text>
              <View style={s.heroChangeRow}>
                <View style={[s.changePill, { backgroundColor: isUp ? t.greenTint : t.redTint, borderColor: isUp ? 'rgba(52,211,153,0.3)' : 'rgba(251,113,133,0.3)' }]}>
                  <Text style={[s.changeText, { color: isUp ? t.green : t.red }]}>
                    {isUp ? '↑' : '↓'} {currencySymbol}{Math.abs(totalReturn).toFixed(0)} ({totalReturnPct}%)
                  </Text>
                </View>
                <Text style={s.changeLabel}>all-time</Text>
              </View>
              <View style={s.heroStats}>
                <View>
                  <Text style={s.statLabel}>Total Invested</Text>
                  <Text style={s.statValue}>{currencySymbol}{totalCost.toFixed(0)}</Text>
                </View>
                <View>
                  <Text style={s.statLabel}>Return</Text>
                  <Text style={[s.statValue, { color: isUp ? t.green : t.red }]}>
                    {isUp ? '+' : ''}{currencySymbol}{totalReturn.toFixed(0)}
                  </Text>
                </View>
              </View>
            </GlassCard>

            {/* Allocation */}
            {allocation.length > 0 && (
              <>
                <Text style={s.sectionTitle}>Asset allocation</Text>
                <GlassCard style={s.allocCard}>
                  <View style={s.allocBar}>
                    {allocation.map((a) => (
                      <View key={a.type} style={{ width: `${a.pct}%`, height: '100%', backgroundColor: a.color }} />
                    ))}
                  </View>
                  <View style={s.allocLegend}>
                    {allocation.map((a) => (
                      <View key={a.type} style={s.allocItem}>
                        <View style={[s.allocDot, { backgroundColor: a.color }]} />
                        <Text style={s.allocLabel}>{a.label}</Text>
                        <Text style={s.allocPct}>{a.pct}%</Text>
                      </View>
                    ))}
                  </View>
                </GlassCard>
              </>
            )}

            {/* Holdings */}
            <View style={s.holdingsHeader}>
              <Text style={s.sectionTitle}>Holdings</Text>
              <TouchableOpacity style={s.addSmallBtn} onPress={openAdd} activeOpacity={0.8}>
                <Text style={s.addSmallBtnText}>+ Add</Text>
              </TouchableOpacity>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ gap: 8 }}>
              {filterKinds.map((k) => {
                const active = filter === k;
                return (
                  <TouchableOpacity
                    key={k}
                    style={[s.chip, active && s.chipActive]}
                    onPress={() => setFilter(k)}
                    activeOpacity={0.8}
                  >
                    <Text style={[s.chipText, active && s.chipTextActive]}>
                      {k === 'all' ? 'All' : ASSET_LABELS[k] ?? k}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {filteredHoldings.map((inv) => {
              const value = inv.quantity * inv.current_value;
              const cost = inv.quantity * inv.buy_price;
              const chg = cost > 0 ? ((value - cost) / cost * 100).toFixed(1) : '0.0';
              const up = value >= cost;
              const color = ASSET_COLORS[inv.asset_type] ?? t.auraBlue;
              return (
                <TouchableOpacity key={inv.id} onPress={() => { setDetailInv(inv); setShowDetail(true); }} activeOpacity={0.7}>
                  <GlassCard style={s.holdingCard}>
                    <View style={[s.holdingIcon, { backgroundColor: color + '28', borderColor: color + '45' }]}>
                      <Text style={[s.holdingAbbr, { color }]}>{getAbbr(inv)}</Text>
                    </View>
                    <View style={s.holdingInfo}>
                      <Text style={s.holdingName}>{inv.name}</Text>
                      <Text style={s.holdingType}>{ASSET_LABELS[inv.asset_type] ?? inv.asset_type}</Text>
                    </View>
                    <View style={s.holdingRight}>
                      <Text style={s.holdingValue}>{currencySymbol}{value.toFixed(0)}</Text>
                      <Text style={[s.holdingChg, { color: up ? t.green : t.red }]}>
                        {up ? '↑' : '↓'} {Math.abs(Number(chg))}%
                      </Text>
                    </View>
                  </GlassCard>
                </TouchableOpacity>
              );
            })}

            {/* Connect brokerage CTA */}
            <TouchableOpacity onPress={() => Alert.alert('Coming Soon', "We're working on brokerage integration. We'll notify you when it's ready!")} activeOpacity={0.7}>
              <GlassCard style={s.connectCard}>
                <View style={s.connectIcon}>
                  <Text style={{ fontSize: 22, color: t.auraAqua }}>+</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.connectTitle}>Connect a brokerage</Text>
                  <Text style={s.connectSub}>Auto-sync holdings & live prices</Text>
                </View>
                <Text style={{ fontSize: 20, color: t.text3 }}>→</Text>
              </GlassCard>
            </TouchableOpacity>
            {/* Disclaimer */}
            <Text style={s.disclaimer}>
              Investment tracking is for record-keeping only. This app does not provide investment advice or recommendations. Consult a qualified professional before making investment decisions.
            </Text>
          </>
        )}
      </ScrollView>

      {/* Holding Detail Sheet */}
      <Modal visible={showDetail} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setShowDetail(false)}>
        <View style={s.root}>
          <Aurora width={SW} height={SH} />
          {detailInv && (() => {
            const inv = detailInv;
            const val = inv.quantity * inv.current_value;
            const cost = inv.quantity * inv.buy_price;
            const ret = val - cost;
            const retPct = cost > 0 ? ((ret / cost) * 100).toFixed(1) : '0.0';
            const isUp = ret >= 0;
            const color = ASSET_COLORS[inv.asset_type] ?? t.auraBlue;
            return (
              <ScrollView contentContainerStyle={s.detailContent} showsVerticalScrollIndicator={false}>
                <View style={s.detailIdRow}>
                  <View style={[s.holdingIcon, { backgroundColor: color + '28', borderColor: color + '45', width: 58, height: 58, borderRadius: 17 }]}>
                    <Text style={[s.holdingAbbr, { color, fontSize: 19 }]}>{getAbbr(inv)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.detailName}>{inv.name}</Text>
                    {inv.ticker ? <Text style={s.detailTicker}>{inv.ticker}</Text> : null}
                    <Text style={s.detailType}>{ASSET_LABELS[inv.asset_type] ?? inv.asset_type.replace(/_/g, ' ')}</Text>
                  </View>
                  <TouchableOpacity style={s.closeBtn} onPress={() => setShowDetail(false)}>
                    <Text style={s.closeBtnText}>✕</Text>
                  </TouchableOpacity>
                </View>

                <GlassCard style={s.heroCard}>
                  <Text style={s.eyebrow}>Current Value</Text>
                  <Text style={s.heroValue}>{currencySymbol}{val.toFixed(0)}</Text>
                  <View style={[s.changePill, { alignSelf: 'flex-start', marginTop: 10, backgroundColor: isUp ? t.greenTint : t.redTint, borderColor: isUp ? 'rgba(52,211,153,0.3)' : 'rgba(251,113,133,0.3)' }]}>
                    <Text style={[s.changeText, { color: isUp ? t.green : t.red }]}>
                      {isUp ? '↑ +' : '↓ '}{retPct}%
                    </Text>
                  </View>
                </GlassCard>

                <Text style={s.sectionTitle}>Your entry</Text>
                <GlassCard style={s.detailBreakCard}>
                  {([
                    { label: 'Quantity', val: String(inv.quantity) },
                    { label: 'Buy price', val: `${currencySymbol}${inv.buy_price.toFixed(2)}` },
                    { label: 'Current price', val: `${currencySymbol}${inv.current_value.toFixed(2)}` },
                    { label: 'Invested', val: `${currencySymbol}${cost.toFixed(0)}` },
                    { label: 'Value', val: `${currencySymbol}${val.toFixed(0)}` },
                    { label: 'Return', val: `${isUp ? '+' : ''}${currencySymbol}${ret.toFixed(0)} (${retPct}%)`, color: isUp ? t.green : t.red },
                  ] as { label: string; val: string; color?: string }[]).map((row, i, arr) => (
                    <View key={row.label} style={[s.detailRow, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: t.glassLine }]}>
                      <Text style={s.detailRowLabel}>{row.label}</Text>
                      <Text style={[s.detailRowVal, row.color ? { color: row.color } : {}]}>{row.val}</Text>
                    </View>
                  ))}
                </GlassCard>

                {inv.notes ? (
                  <>
                    <Text style={s.sectionTitle}>Notes</Text>
                    <GlassCard style={{ padding: 16, marginBottom: 8 }}>
                      <Text style={s.detailNotes}>{inv.notes}</Text>
                    </GlassCard>
                  </>
                ) : null}

                <TouchableOpacity style={s.saveBtn} onPress={() => { setShowDetail(false); setTimeout(() => openEdit(inv), 250); }} activeOpacity={0.8}>
                  <Text style={s.saveBtnText}>Edit this holding</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.deleteBtn} onPress={() => { setShowDetail(false); setTimeout(() => handleDelete(inv), 250); }} activeOpacity={0.8}>
                  <Text style={s.deleteBtnText}>Remove from portfolio</Text>
                </TouchableOpacity>
              </ScrollView>
            );
          })()}
        </View>
      </Modal>

      {/* Add/Edit Modal */}
      <Modal visible={showModal} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setShowModal(false)}>
        <View style={s.root}>
          <Aurora width={SW} height={SH} />
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{editingInv ? 'Edit Investment' : 'Add Investment'}</Text>
              <TouchableOpacity onPress={() => setShowModal(false)} style={s.closeBtn}>
                <Text style={s.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 22, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
              <Text style={s.formLabel}>Name *</Text>
              <TextInput style={s.formInput} placeholder="e.g. Grameenphone" placeholderTextColor={t.text3} value={formName} onChangeText={setFormName} />

              <Text style={s.formLabel}>Ticker (optional)</Text>
              <TextInput style={s.formInput} placeholder="e.g. GP, BTC" placeholderTextColor={t.text3} value={formTicker} onChangeText={setFormTicker} autoCapitalize="characters" />

              <Text style={s.formLabel}>Asset Type</Text>
              <View style={{ marginBottom: 14 }}>
                <AssetTypeCombo value={formType} onChange={(v) => setFormType(v)} />
              </View>

              <Text style={s.formLabel}>Quantity *</Text>
              <TextInput style={s.formInput} placeholder="e.g. 10" placeholderTextColor={t.text3} value={formQty} onChangeText={setFormQty} keyboardType="decimal-pad" />

              <Text style={s.formLabel}>Buy Price (per unit) *</Text>
              <TextInput style={s.formInput} placeholder="e.g. 450" placeholderTextColor={t.text3} value={formBuyPrice} onChangeText={setFormBuyPrice} keyboardType="decimal-pad" />

              <Text style={s.formLabel}>Current Value (per unit)</Text>
              <TextInput style={s.formInput} placeholder="Same as buy price if unsure" placeholderTextColor={t.text3} value={formCurrentVal} onChangeText={setFormCurrentVal} keyboardType="decimal-pad" />

              <Text style={s.formLabel}>Notes (optional)</Text>
              <TextInput style={[s.formInput, { minHeight: 72, textAlignVertical: 'top' }]} placeholder="Any notes..." placeholderTextColor={t.text3} value={formNotes} onChangeText={setFormNotes} multiline />

              <TouchableOpacity style={s.saveBtn} onPress={handleSave} disabled={saving} activeOpacity={0.8}>
                {saving ? <ActivityIndicator size="small" color="#fff" /> : (
                  <Text style={s.saveBtnText}>{editingInv ? 'Update' : 'Add'} Investment</Text>
                )}
              </TouchableOpacity>

              {editingInv && (
                <TouchableOpacity style={s.deleteBtn} onPress={() => { setShowModal(false); handleDelete(editingInv); }} activeOpacity={0.8}>
                  <Text style={s.deleteBtnText}>Delete this holding</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.auraBg },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 62, paddingHorizontal: 22, paddingBottom: 120 },
  loadingWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  loadingText: { fontSize: 14, fontFamily: fonts.medium, color: t.text3 },

  // Header
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 },
  title: { fontSize: 30, fontFamily: fonts.extraBold, fontWeight: '800', color: t.text, letterSpacing: -0.6 },
  subtitle: { fontSize: 15, fontFamily: fonts.regular, color: t.text2, marginTop: 4 },
  betaBadge: {
    marginTop: 8, paddingHorizontal: 11, paddingVertical: 5, borderRadius: t.rPill,
    backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine,
  },
  betaText: { fontSize: 11, fontFamily: fonts.bold, fontWeight: '700', letterSpacing: 0.8, color: t.auraAqua },

  // Empty
  emptyWrap: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: { fontSize: 18, fontFamily: fonts.bold, fontWeight: '700', color: t.text, marginBottom: 8 },
  emptySub: { fontSize: 14, fontFamily: fonts.regular, color: t.text2, textAlign: 'center', lineHeight: 21 },
  addBtn: {
    marginTop: 20, paddingHorizontal: 20, paddingVertical: 12, borderRadius: t.rMd,
    backgroundColor: t.auraIndigo,
  },
  addBtnText: { fontSize: 16, fontFamily: fonts.semiBold, fontWeight: '600', color: '#fff' },

  // Hero
  heroCard: { padding: 24, paddingBottom: 20, marginBottom: 16 },
  eyebrow: { fontSize: 11, fontFamily: fonts.semiBold, fontWeight: '600', letterSpacing: 1.5, textTransform: 'uppercase', color: t.text3 },
  heroValue: { fontSize: 38, fontFamily: fonts.extraBold, fontWeight: '800', color: t.text, letterSpacing: -1, marginTop: 8, lineHeight: 42 },
  heroChangeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 },
  changePill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: t.rPill, borderWidth: 1,
  },
  changeText: { fontSize: 13, fontFamily: fonts.bold, fontWeight: '700' },
  changeLabel: { fontSize: 13, fontFamily: fonts.medium, color: t.text3 },
  heroStats: { flexDirection: 'row', gap: 22, marginTop: 16 },
  statLabel: { fontSize: 11.5, fontFamily: fonts.medium, color: t.text3 },
  statValue: { fontSize: 16, fontFamily: fonts.extraBold, fontWeight: '800', color: t.text, marginTop: 4 },

  // Allocation
  sectionTitle: { fontSize: 17, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text, marginTop: 26, marginBottom: 12, letterSpacing: -0.3 },
  allocCard: { padding: 20 },
  allocBar: { flexDirection: 'row', height: 12, borderRadius: 99, overflow: 'hidden', gap: 2 },
  allocLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 16 },
  allocItem: { flexDirection: 'row', alignItems: 'center', gap: 9, width: '45%' },
  allocDot: { width: 10, height: 10, borderRadius: 4 },
  allocLabel: { flex: 1, fontSize: 13.5, fontFamily: fonts.medium, color: t.text2 },
  allocPct: { fontSize: 13.5, fontFamily: fonts.bold, fontWeight: '700', color: t.text },

  // Holdings
  holdingsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addSmallBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: t.rSm, backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine },
  addSmallBtnText: { fontSize: 13, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text2 },
  chip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: t.rPill, backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine },
  chipActive: { backgroundColor: t.auraIndigo, borderColor: 'transparent' },
  chipText: { fontSize: 14, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text2 },
  chipTextActive: { color: '#fff', fontWeight: '700' },

  holdingCard: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 13, paddingHorizontal: 15, marginBottom: 10 },
  holdingIcon: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  holdingAbbr: { fontSize: 15, fontFamily: fonts.extraBold, fontWeight: '800' },
  holdingInfo: { flex: 1, minWidth: 0 },
  holdingName: { fontSize: 15.5, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text },
  holdingType: { fontSize: 13, fontFamily: fonts.medium, color: t.text3, marginTop: 3 },
  holdingRight: { alignItems: 'flex-end' },
  holdingValue: { fontSize: 15, fontFamily: fonts.extraBold, fontWeight: '800', color: t.text },
  holdingChg: { fontSize: 12.5, fontFamily: fonts.bold, fontWeight: '700', marginTop: 3 },

  // Connect CTA
  connectCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, marginTop: 16 },
  connectIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: t.cyanTint, alignItems: 'center', justifyContent: 'center' },
  connectTitle: { fontSize: 15, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text },
  connectSub: { fontSize: 13, fontFamily: fonts.medium, color: t.text3, marginTop: 2 },

  // Combo dropdown
  comboDropdown: {
    marginTop: 4, borderRadius: t.rMd, backgroundColor: t.glass2,
    borderWidth: 1, borderColor: t.glassLine2, overflow: 'hidden',
  },
  comboOption: {
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 1, borderBottomColor: t.glassLine,
  },
  comboOptionText: {
    fontSize: 15, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text,
    textTransform: 'capitalize',
  },

  // Detail sheet
  detailContent: { paddingTop: 64, paddingHorizontal: 22, paddingBottom: 120 },
  detailIdRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  detailName: { fontSize: 19, fontFamily: fonts.bold, fontWeight: '700', color: t.text, letterSpacing: -0.3 },
  detailTicker: { fontSize: 13, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text3, marginTop: 2, letterSpacing: 0.5 },
  detailType: { fontSize: 13, fontFamily: fonts.medium, color: t.text3, marginTop: 3, textTransform: 'capitalize' },
  detailBreakCard: { padding: 4, marginBottom: 8 },
  detailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 13 },
  detailRowLabel: { fontSize: 14, fontFamily: fonts.medium, color: t.text3 },
  detailRowVal: { fontSize: 14.5, fontFamily: fonts.bold, fontWeight: '700', color: t.text },
  detailNotes: { fontSize: 14, fontFamily: fonts.regular, color: t.text2, lineHeight: 21 },

  // Modal
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 22, paddingTop: 60, paddingBottom: 16,
  },
  modalTitle: { fontSize: 26, fontFamily: fonts.bold, fontWeight: '700', color: t.text, letterSpacing: -0.5 },
  closeBtn: { width: 38, height: 38, borderRadius: t.rPill, backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { fontSize: 18, fontWeight: '600', color: t.text2 },
  formLabel: { fontSize: 11, fontFamily: fonts.semiBold, fontWeight: '600', letterSpacing: 1.5, textTransform: 'uppercase', color: t.text3, marginBottom: 10 },
  formInput: { backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine, borderRadius: t.rMd, paddingHorizontal: 16, paddingVertical: 14, fontSize: 15.5, fontFamily: fonts.medium, fontWeight: '500', color: t.text, marginBottom: 14 },
  typeRow: { flexDirection: 'row', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
  saveBtn: { marginTop: 8, paddingVertical: 16, borderRadius: t.rMd, backgroundColor: t.auraIndigo, alignItems: 'center' },
  saveBtnText: { fontSize: 16, fontFamily: fonts.bold, fontWeight: '700', color: '#fff' },
  deleteBtn: { marginTop: 16, paddingVertical: 14, alignItems: 'center' },
  deleteBtnText: { fontSize: 15, fontFamily: fonts.semiBold, fontWeight: '600', color: t.red },
  disclaimer: { fontSize: 10, fontFamily: fonts.regular, color: t.text4, textAlign: 'center', marginTop: 16, paddingHorizontal: 8, lineHeight: 14 },
});
