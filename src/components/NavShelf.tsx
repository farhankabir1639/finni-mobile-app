import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { t, fonts } from '../theme/tokens';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import { EMAIL_CAPTURE_ENABLED } from '../lib/featureFlags';

const Chevron = ({ dir = 'right', color = t.text3 }: { dir?: 'right' | 'down'; color?: string }) => (
  <Svg width={16} height={16} viewBox="0 0 24 24" fill="none">
    <Path d={dir === 'down' ? 'M6 9l6 6 6-6' : 'M9 6l6 6-6 6'} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
  </Svg>
);

// ── Breadcrumb pill — opens the shelf (place in a screen header) ──────────────
export function Breadcrumb({ onOpen }: { onOpen: () => void }) {
  return (
    <Pressable onPress={onOpen} style={s.crumb} hitSlop={8}>
      <LinearGradient colors={['#8B8FFF', '#4F46E5']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.crumbMark}>
        <Svg width={15} height={15} viewBox="0 0 24 24" fill="none">
          <Path d="M5 20V9M12 20V4M19 20v-7" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" />
        </Svg>
      </LinearGradient>
      <Text style={s.crumbTxt} numberOfLines={1}>Know where your money goes</Text>
      <Chevron dir="down" />
    </Pressable>
  );
}

type NavItem = { id: string; label: string };
const NAV: NavItem[] = [
  { id: 'Home', label: 'Home' },
  { id: 'Transactions', label: 'Transactions' },
  { id: 'Analytics', label: 'Insights' },
  { id: 'Investments', label: 'Investments' },
  ...(EMAIL_CAPTURE_ENABLED ? [{ id: 'Review', label: 'Review' }] : []),
];

// settings quick-rows → open the full Settings screen focused on a section
const QUICK: { key: string; label: string; color: string }[] = [
  { key: 'edit', label: 'Edit Profile', color: t.auraIndigo },
  { key: 'currency', label: 'Currency', color: t.green },
  { key: 'income', label: 'Income', color: t.green },
  { key: 'categories', label: 'Categories', color: t.catShopping },
  { key: 'budget', label: 'Smart Budget', color: t.auraViolet },
  { key: 'goals', label: 'Goals', color: t.cyan },
];

interface Props {
  visible: boolean;
  active: string;
  onClose: () => void;
  onNavigate: (tab: string) => void;
  onOpenSettings: (section?: string) => void;
  onSignOut: () => void;
}

// Slide-down nav + settings shelf (replaces the Settings tab).
export default function NavShelf({ visible, active, onClose, onNavigate, onOpenSettings, onSignOut }: Props) {
  const { user } = useAuth();
  const { profile } = useProfile();
  const name = profile?.name ?? user?.email?.split('@')[0] ?? 'You';
  const email = user?.email ?? '';
  const initial = (name[0] ?? 'F').toUpperCase();

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <SafeAreaView edges={['top']} style={s.shelfWrap} pointerEvents="box-none">
        <View style={s.shelf}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 18, paddingBottom: 24 }}>
            {/* brand + close */}
            <View style={s.brandRow}>
              <LinearGradient colors={['#8B8FFF', '#4F46E5']} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.brandMark}>
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none"><Path d="M5 20V9M12 20V4M19 20v-7" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" /></Svg>
              </LinearGradient>
              <View style={{ flex: 1 }}>
                <Text style={s.brandName}>Finni</Text>
                <Text style={s.brandSub}>Know where your money goes</Text>
              </View>
              <TouchableOpacity onPress={onClose} style={s.closeBtn} hitSlop={10}><Text style={s.closeTxt}>✕</Text></TouchableOpacity>
            </View>

            {/* account → full settings */}
            <TouchableOpacity style={s.account} activeOpacity={0.8} onPress={() => { onClose(); onOpenSettings(); }}>
              <LinearGradient colors={['#c4b5fd', t.auraViolet, t.auraIndigo]} start={{ x: 0.2, y: 0 }} end={{ x: 0.9, y: 1 }} style={s.avatar}>
                <Text style={s.avatarTxt}>{initial}</Text>
              </LinearGradient>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.accName} numberOfLines={1}>{name}</Text>
                <Text style={s.accEmail} numberOfLines={1}>{email}</Text>
              </View>
              <Chevron />
            </TouchableOpacity>

            {/* navigate */}
            <Text style={s.eyebrow}>Navigate</Text>
            <View style={{ gap: 8 }}>
              {NAV.map((n) => {
                const on = n.id === active;
                return (
                  <TouchableOpacity key={n.id} style={[s.row, on && s.rowActive]} activeOpacity={0.8}
                    onPress={() => { onClose(); onNavigate(n.id); }}>
                    <Text style={[s.rowLabel, on && s.rowLabelActive]}>{n.label}</Text>
                    <Chevron color={on ? t.auraAqua : t.text3} />
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* settings quick rows */}
            <Text style={s.eyebrow}>Settings</Text>
            <View style={{ gap: 8 }}>
              {QUICK.map((q) => (
                <TouchableOpacity key={q.key} style={s.row} activeOpacity={0.8}
                  onPress={() => { onClose(); onOpenSettings(q.key); }}>
                  <View style={[s.dot, { backgroundColor: q.color }]} />
                  <Text style={s.rowLabel}>{q.label}</Text>
                  <Chevron />
                </TouchableOpacity>
              ))}
            </View>

            {/* sign out */}
            <TouchableOpacity style={s.signOut} activeOpacity={0.85} onPress={() => { onClose(); onSignOut(); }}>
              <Text style={s.signOutTxt}>Sign Out</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const s = StyleSheet.create({
  // breadcrumb
  crumb: { flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'flex-start', paddingVertical: 6, paddingLeft: 7, paddingRight: 13, borderRadius: 999, backgroundColor: 'rgba(18,16,32,0.6)', borderWidth: 1, borderColor: t.glassLine2 },
  crumbMark: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  crumbTxt: { fontSize: 13, fontFamily: fonts.semiBold, color: t.text, maxWidth: 200 },
  // shelf
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(2,3,8,0.66)' },
  shelfWrap: { position: 'absolute', top: 0, left: 0, right: 0 },
  shelf: { backgroundColor: 'rgba(16,14,30,0.98)', borderBottomLeftRadius: 30, borderBottomRightRadius: 30, borderBottomWidth: 1, borderColor: t.glassLine2, maxHeight: '92%' },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  brandMark: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 17, fontFamily: fonts.bold, color: t.text },
  brandSub: { fontSize: 12.5, fontFamily: fonts.regular, color: t.text3, marginTop: 1 },
  closeBtn: { width: 38, height: 38, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine },
  closeTxt: { fontSize: 16, color: t.text2 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 13, padding: 12, borderRadius: t.rLg, backgroundColor: t.glass2, borderWidth: 1, borderColor: t.glassLine, marginBottom: 6 },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 18, fontFamily: fonts.bold, color: '#fff' },
  accName: { fontSize: 15.5, fontFamily: fonts.semiBold, color: t.text },
  accEmail: { fontSize: 12.5, fontFamily: fonts.regular, color: t.text3, marginTop: 2 },
  eyebrow: { fontSize: 11, fontFamily: fonts.semiBold, letterSpacing: 1, textTransform: 'uppercase', color: t.text3, marginTop: 22, marginBottom: 10, marginLeft: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderRadius: t.rMd, backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine },
  rowActive: { backgroundColor: 'rgba(139,92,246,0.18)', borderColor: 'rgba(139,92,246,0.4)' },
  rowLabel: { flex: 1, fontSize: 14.5, fontFamily: fonts.semiBold, color: t.text },
  rowLabelActive: { color: '#fff' },
  dot: { width: 9, height: 9, borderRadius: 5 },
  signOut: { marginTop: 22, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: t.rMd, backgroundColor: t.redTint, borderWidth: 1, borderColor: 'rgba(251,113,133,0.3)' },
  signOutTxt: { fontSize: 15, fontFamily: fonts.semiBold, color: t.red },
});
