import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { t, fonts } from '../theme/tokens';
import CatIcon, { getCatConfig } from './CatIcon';

export type PickerCategory = { id: string; name: string; emoji?: string };

interface CategoryPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  categories: PickerCategory[];
  currentCategoryId?: string | null;
  onSelect: (categoryId: string) => void;
  onDelete?: () => void;
}

export default function CategoryPickerSheet({
  visible, onClose, categories, currentCategoryId, onSelect, onDelete,
}: CategoryPickerSheetProps) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.handleWrap}>
          <View style={styles.handle} />
        </View>

        <View style={styles.header}>
          <Text style={[styles.title, { fontFamily: fonts.bold }]}>Change category</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} activeOpacity={0.7}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[styles.list, { paddingBottom: Math.max(insets.bottom, 16) + 24 }]}
          showsVerticalScrollIndicator={false}
        >
          {categories.map(cat => {
            const active = cat.id === currentCategoryId;
            const cfg = getCatConfig(cat.name);
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.row, active && styles.rowActive]}
                onPress={() => { onSelect(cat.id); onClose(); }}
                activeOpacity={0.75}
              >
                <CatIcon name={cat.name} size={38} radius={11} />
                <Text
                  style={[
                    styles.rowName,
                    { fontFamily: active ? fonts.semiBold : fonts.regular },
                    active && { color: cfg.color },
                  ]}
                  numberOfLines={1}
                >
                  {cat.name}
                </Text>
                {active && (
                  <View style={[styles.checkBadge, { backgroundColor: cfg.color }]}>
                    <Svg width={11} height={11} viewBox="0 0 24 24">
                      <Path d="M5 12l5 5L19 7" stroke={t.auraBg} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    </Svg>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          {onDelete && (
            <TouchableOpacity
              style={styles.deleteRow}
              onPress={() => { onDelete(); onClose(); }}
              activeOpacity={0.75}
            >
              <Svg width={18} height={18} viewBox="0 0 24 24">
                <Path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" stroke={t.red} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              </Svg>
              <Text style={[styles.deleteTxt, { fontFamily: fonts.semiBold }]}>Delete transaction</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.auraBg,
  },
  handleWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: {
    fontSize: 17,
    color: t.text,
  },
  closeBtn: {
    fontSize: 18,
    color: t.text2,
  },
  list: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 11,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  rowActive: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderColor: 'rgba(255,255,255,0.13)',
  },
  rowName: {
    flex: 1,
    fontSize: 15,
    color: t.text,
    textTransform: 'capitalize',
  },
  checkBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginTop: 10,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: 'rgba(251,113,133,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(251,113,133,0.28)',
  },
  deleteTxt: {
    fontSize: 15,
    color: t.red,
  },
});
