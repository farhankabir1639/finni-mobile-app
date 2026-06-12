import React, { useState, useEffect } from 'react';
import { Modal, TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { t, fonts } from '../theme/tokens';
import { isoDate, fmtShort, MONTHS } from './DateRangePicker';

const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const CELL_W: `${number}%` = '14.2857%';

interface DatePickerProps {
  visible: boolean;
  value: string | null;
  onApply: (date: string) => void;
  onClose: () => void;
  minDate?: string;
  title?: string;
}

export default function DatePicker({
  visible, value, onApply, onClose, minDate, title = 'Select date',
}: DatePickerProps) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setSelected(value ?? null);
      if (value) {
        const [y, m] = value.split('-').map(Number);
        setViewYear(y);
        setViewMonth(m - 1);
      }
    }
  }, [visible]);

  const shiftMonth = (n: number) => {
    let m = viewMonth + n, y = viewYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setViewMonth(m); setViewYear(y);
  };

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMo = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMo; d++) cells.push(d);

  const todayIso = isoDate(now.getFullYear(), now.getMonth(), now.getDate());

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={s.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={s.sheet} onPress={() => {}}>
          <View style={s.handle} />

          <View style={s.header}>
            <Text style={s.title}>{title}</Text>
            <Text style={[s.selectedLabel, { color: selected ? t.auraAqua : t.text3 }]}>
              {selected ? fmtShort(selected) : 'No date set'}
            </Text>
          </View>

          {/* Month navigation */}
          <View style={s.calHeader}>
            <TouchableOpacity style={s.navBtn} onPress={() => shiftMonth(-1)} activeOpacity={0.7}>
              <Text style={s.navArrow}>‹</Text>
            </TouchableOpacity>
            <Text style={s.monthLabel}>{MONTHS[viewMonth]} {viewYear}</Text>
            <TouchableOpacity style={s.navBtn} onPress={() => shiftMonth(1)} activeOpacity={0.7}>
              <Text style={s.navArrow}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Day-of-week headers */}
          <View style={s.dowRow}>
            {DOW.map((d, i) => <Text key={i} style={s.dowLabel}>{d}</Text>)}
          </View>

          {/* Calendar grid */}
          <View style={s.calGrid}>
            {cells.map((d, i) => {
              if (!d) return <View key={i} style={s.dayCell} />;
              const iso = isoDate(viewYear, viewMonth, d);
              const isPicked = iso === selected;
              const isToday = iso === todayIso;
              const disabled = !!minDate && iso < minDate;
              return (
                <TouchableOpacity
                  key={i}
                  style={[s.dayCell, isPicked && s.dayCellPicked, disabled && s.dayCellDisabled]}
                  onPress={() => !disabled && setSelected(iso)}
                  activeOpacity={disabled ? 1 : 0.75}
                >
                  <Text style={[
                    s.dayText,
                    isToday && !isPicked && s.dayTextToday,
                    isPicked && s.dayTextPicked,
                    disabled && s.dayTextDisabled,
                  ]}>
                    {d}
                  </Text>
                  {isToday && !isPicked && <View style={s.todayDot} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Actions */}
          <View style={s.actions}>
            <TouchableOpacity
              style={s.clearBtn}
              onPress={() => { setSelected(null); onApply(''); onClose(); }}
              activeOpacity={0.8}
            >
              <Text style={s.clearText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.applyBtn, !selected && { opacity: 0.45 }]}
              onPress={() => selected && (onApply(selected), onClose())}
              disabled={!selected}
              activeOpacity={0.8}
            >
              <Text style={s.applyText}>Set deadline</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(2,3,8,0.75)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    backgroundColor: 'rgba(14,12,26,0.97)',
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    borderColor: t.glassLine2, padding: 20, paddingBottom: 44,
  },
  handle: { width: 40, height: 5, borderRadius: 99, backgroundColor: t.glassLine2, alignSelf: 'center', marginBottom: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  title: { fontSize: 17, fontFamily: fonts.semiBold, color: t.text },
  selectedLabel: { fontSize: 13, fontFamily: fonts.bold },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  navBtn: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine },
  navArrow: { fontSize: 22, color: t.text2, lineHeight: 28, fontFamily: fonts.regular },
  monthLabel: { fontSize: 15, fontFamily: fonts.semiBold, color: t.text },
  dowRow: { flexDirection: 'row', marginBottom: 4 },
  dowLabel: { width: CELL_W, textAlign: 'center', fontSize: 11, fontFamily: fonts.bold, color: t.text3, paddingVertical: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: CELL_W, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  dayCellPicked: { backgroundColor: t.auraAqua, borderRadius: 10 },
  dayCellDisabled: { opacity: 0.25 },
  dayText: { fontSize: 13.5, fontFamily: fonts.medium, color: t.text },
  dayTextPicked: { fontFamily: fonts.bold, color: '#07070E' },
  dayTextToday: { color: t.auraAqua, fontFamily: fonts.bold },
  dayTextDisabled: { color: t.text3 },
  todayDot: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: t.auraAqua },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  clearBtn: { flex: 1, paddingVertical: 14, borderRadius: t.rMd, alignItems: 'center', backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine },
  clearText: { fontSize: 15, fontFamily: fonts.bold, color: t.text2 },
  applyBtn: { flex: 1.5, paddingVertical: 14, borderRadius: t.rMd, alignItems: 'center', backgroundColor: t.auraIndigo },
  applyText: { fontSize: 15, fontFamily: fonts.bold, color: '#fff' },
});
