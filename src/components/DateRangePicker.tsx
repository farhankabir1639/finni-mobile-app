import React, { useState, useEffect } from 'react';
import { Modal, TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { t, fonts } from '../theme/tokens';

export type DateRange = { start: string; end: string };

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export function isoDate(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
export function fmtShort(iso: string) {
  const [, m, d] = iso.split('-').map(Number);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

interface DateRangePickerProps {
  visible: boolean;
  value: DateRange | null;
  onApply: (range: DateRange) => void;
  onClose: () => void;
  title?: string;
}

export default function DateRangePicker({
  visible, value, onApply, onClose, title = 'Custom range',
}: DateRangePickerProps) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());
  const [start, setStart] = useState<string | null>(null);
  const [end, setEnd] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setStart(value?.start ?? null);
      setEnd(value?.end ?? null);
    }
  }, [visible]);

  const firstDow = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMo = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMo; d++) cells.push(d);

  const shiftMonth = (n: number) => {
    let m = viewMonth + n, y = viewYear;
    if (m < 0) { m = 11; y--; }
    if (m > 11) { m = 0; y++; }
    setViewMonth(m);
    setViewYear(y);
  };

  const pickDay = (iso: string) => {
    if (!start || (start && end)) { setStart(iso); setEnd(null); }
    else if (iso < start) { setEnd(start); setStart(iso); }
    else setEnd(iso);
  };

  const applyPreset = (days: number) => {
    const e = new Date();
    const s = new Date();
    s.setDate(s.getDate() - (days - 1));
    setStart(isoDate(s.getFullYear(), s.getMonth(), s.getDate()));
    setEnd(isoDate(e.getFullYear(), e.getMonth(), e.getDate()));
  };

  const inRange = (iso: string) => !!(start && end && iso > start && iso < end);
  const rangeLabel = !start
    ? 'Select a range'
    : !end
    ? fmtShort(start)
    : `${fmtShort(start)} – ${fmtShort(end)}`;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={dr.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={dr.sheet} onPress={() => {}}>
          <View style={dr.handle} />

          <View style={dr.header}>
            <Text style={dr.title}>{title}</Text>
            <Text style={[dr.rangeLabel, { color: start ? t.auraAqua : t.text3 }]}>
              {rangeLabel}
            </Text>
          </View>

          {/* Quick presets */}
          <View style={dr.presets}>
            {[
              { label: 'Today',       days: 1  },
              { label: 'Last 7 days', days: 7  },
              { label: 'Last 30 days',days: 30 },
              { label: 'Last 90 days',days: 90 },
            ].map(p => (
              <TouchableOpacity
                key={p.days}
                style={dr.presetChip}
                onPress={() => applyPreset(p.days)}
                activeOpacity={0.8}
              >
                <Text style={dr.presetText}>{p.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Month navigation */}
          <View style={dr.calHeader}>
            <TouchableOpacity style={dr.navBtn} onPress={() => shiftMonth(-1)} activeOpacity={0.7}>
              <Text style={dr.navArrow}>‹</Text>
            </TouchableOpacity>
            <Text style={dr.monthLabel}>{MONTHS[viewMonth]} {viewYear}</Text>
            <TouchableOpacity style={dr.navBtn} onPress={() => shiftMonth(1)} activeOpacity={0.7}>
              <Text style={dr.navArrow}>›</Text>
            </TouchableOpacity>
          </View>

          {/* Day-of-week headers */}
          <View style={dr.dowRow}>
            {DOW.map((d, i) => (
              <Text key={i} style={dr.dowLabel}>{d}</Text>
            ))}
          </View>

          {/* Calendar grid */}
          <View style={dr.calGrid}>
            {cells.map((d, i) => {
              if (!d) return <View key={i} style={dr.dayCell} />;
              const iso = isoDate(viewYear, viewMonth, d);
              const isStart = iso === start;
              const isEnd = iso === end;
              const edge = isStart || isEnd;
              const mid = inRange(iso);
              const isToday = iso === isoDate(now.getFullYear(), now.getMonth(), now.getDate());
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    dr.dayCell,
                    mid && dr.dayCellMid,
                    edge && dr.dayCellEdge,
                  ]}
                  onPress={() => pickDay(iso)}
                  activeOpacity={0.75}
                >
                  <Text style={[
                    dr.dayText,
                    isToday && !edge && dr.dayTextToday,
                    edge && dr.dayTextEdge,
                  ]}>
                    {d}
                  </Text>
                  {isToday && !edge && <View style={dr.todayDot} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Actions */}
          <View style={dr.actions}>
            <TouchableOpacity
              style={dr.clearBtn}
              onPress={() => { setStart(null); setEnd(null); }}
              activeOpacity={0.8}
            >
              <Text style={dr.clearText}>Clear</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[dr.applyBtn, !start && { opacity: 0.45 }]}
              onPress={() => start && onApply({ start, end: end ?? start })}
              disabled={!start}
              activeOpacity={0.8}
            >
              <Text style={dr.applyText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const CELL_W: `${number}%` = '14.2857%';

const dr = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(2,3,8,0.75)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: 'rgba(14,12,26,0.97)',
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: t.glassLine2,
    padding: 20,
    paddingBottom: 44,
  },
  handle: {
    width: 40, height: 5, borderRadius: 99,
    backgroundColor: t.glassLine2,
    alignSelf: 'center', marginBottom: 18,
  },
  header: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 16,
  },
  title: { fontSize: 17, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text },
  rangeLabel: { fontSize: 13, fontFamily: fonts.bold, fontWeight: '700' },

  presets: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 18 },
  presetChip: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: t.rPill,
    backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine,
  },
  presetText: { fontSize: 13, fontFamily: fonts.medium, color: t.text2 },

  calHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 14,
  },
  navBtn: {
    width: 34, height: 34, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine,
  },
  navArrow: { fontSize: 22, color: t.text2, lineHeight: 28, fontFamily: fonts.regular },
  monthLabel: { fontSize: 15, fontFamily: fonts.semiBold, fontWeight: '600', color: t.text },

  dowRow: { flexDirection: 'row', marginBottom: 4 },
  dowLabel: {
    width: CELL_W, textAlign: 'center',
    fontSize: 11, fontFamily: fonts.bold, fontWeight: '700', color: t.text3, paddingVertical: 4,
  },

  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: CELL_W, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  dayCellEdge: { backgroundColor: t.auraAqua, borderRadius: 10 },
  dayCellMid: { backgroundColor: t.auraAqua + '28', borderRadius: 0 },
  dayText: { fontSize: 13.5, fontFamily: fonts.medium, color: t.text },
  dayTextEdge: { fontFamily: fonts.bold, fontWeight: '700', color: '#07070E' },
  dayTextToday: { color: t.auraAqua, fontFamily: fonts.bold, fontWeight: '700' },
  todayDot: {
    position: 'absolute', bottom: 4,
    width: 4, height: 4, borderRadius: 2, backgroundColor: t.auraAqua,
  },

  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  clearBtn: {
    flex: 1, paddingVertical: 14, borderRadius: t.rMd,
    alignItems: 'center', backgroundColor: t.glass, borderWidth: 1, borderColor: t.glassLine,
  },
  clearText: { fontSize: 15, fontFamily: fonts.bold, fontWeight: '700', color: t.text2 },
  applyBtn: { flex: 1.5, paddingVertical: 14, borderRadius: t.rMd, alignItems: 'center', backgroundColor: t.auraIndigo },
  applyText: { fontSize: 15, fontFamily: fonts.bold, fontWeight: '700', color: '#fff' },
});
