import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { t, fonts } from '../theme/tokens';
import { createRecurring } from '../lib/recurring';
import { weekdayOf, type Frequency } from '../lib/recurring_schedule';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
function fmtNext(dateStr: string): string {
  const [, m, d] = dateStr.split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

interface Props {
  userId: string;
  amount: number;
  type: 'expense' | 'income';
  categoryId: string | null;
  description: string | null;
  date?: string; // originating transaction date (for anchor); defaults to today
}

// "🔁 Repeat this?" banner on a logged transaction card. Lets the user turn a
// one-off into a recurring template (Weekly / Monthly) without leaving chat.
export default function RecurringBanner({ userId, amount, type, categoryId, description, date }: Props) {
  const [picking, setPicking] = useState<Frequency | null>(null);
  const [saving, setSaving] = useState(false);
  const [setLabel, setSetLabel] = useState<string | null>(null);

  const anchorDay = date ? Number(date.split('-')[2]) : new Date().getDate();
  const anchorWeekday = date ? weekdayOf(date) : new Date().getDay();

  const confirm = async (frequency: Frequency) => {
    if (saving) return;
    setSaving(true);
    const tpl = await createRecurring(userId, {
      amount, description, categoryId, type, frequency, anchorDay, anchorWeekday,
    });
    setSaving(false);
    if (tpl) {
      setSetLabel(`Repeats ${frequency} · next ${fmtNext(tpl.next_run)}`);
      setPicking(null);
    }
  };

  if (setLabel) {
    return (
      <View style={s.setRow}>
        <Text style={s.setTxt}>🔁 {setLabel}</Text>
      </View>
    );
  }

  return (
    <View style={s.wrap}>
      {picking === null ? (
        <View style={s.row}>
          <Text style={s.prompt}>🔁 Is this recurring?</Text>
          <Pressable hitSlop={6} style={s.chip} onPress={() => setPicking('weekly')}>
            <Text style={s.chipTxt}>Every week</Text>
          </Pressable>
          <Pressable hitSlop={6} style={s.chip} onPress={() => setPicking('monthly')}>
            <Text style={s.chipTxt}>Every month</Text>
          </Pressable>
        </View>
      ) : (
        <View style={s.pickerCol}>
          <Text style={s.pickerTxt}>
            {picking === 'weekly'
              ? `Every ${WEEKDAYS[anchorWeekday]}`
              : `On the ${ordinal(anchorDay)} of each month`}
          </Text>
          <View style={s.pickerActions}>
            <Pressable hitSlop={6} style={s.setBtn} onPress={() => confirm(picking)} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color="#fff" /> : <Text style={s.setBtnTxt}>Set recurring</Text>}
            </Pressable>
            <Pressable hitSlop={6} style={s.cancelBtn} onPress={() => setPicking(null)} disabled={saving}>
              <Text style={s.cancelTxt}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  prompt: { flex: 1, fontSize: 12.5, fontFamily: fonts.regular, color: t.text3 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9,
    borderWidth: 1, borderColor: t.glassLine2, backgroundColor: 'rgba(255,255,255,0.04)',
  },
  chipTxt: { fontSize: 12.5, fontFamily: fonts.semiBold, color: t.text2 },
  pickerCol: { gap: 9 },
  pickerTxt: { fontSize: 13, fontFamily: fonts.medium, color: t.text2 },
  pickerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  setBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, backgroundColor: t.auraIndigo, minWidth: 110, alignItems: 'center' },
  setBtnTxt: { fontSize: 13, fontFamily: fonts.semiBold, color: '#fff' },
  cancelBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: t.glassLine2 },
  cancelTxt: { fontSize: 13, fontFamily: fonts.semiBold, color: t.text3 },
  setRow: { paddingHorizontal: 14, paddingTop: 4, paddingBottom: 12 },
  setTxt: { fontSize: 12.5, fontFamily: fonts.semiBold, color: t.auraAqua },
});
