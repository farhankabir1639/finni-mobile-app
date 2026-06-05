import React from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, ScrollView, Platform,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t, fonts } from '../theme/tokens';

export type PickerCategory = { id: string; name: string; emoji?: string };

interface CategoryPickerSheetProps {
  visible: boolean;
  onClose: () => void;
  categories: PickerCategory[];
  currentCategoryId?: string | null;
  onSelect: (categoryId: string) => void;
}

export default function CategoryPickerSheet({
  visible, onClose, categories, currentCategoryId, onSelect,
}: CategoryPickerSheetProps) {
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
          <Text style={[styles.title, { fontFamily: fonts.bold }]}>Change Category</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12} activeOpacity={0.7}>
            <Text style={styles.closeBtn}>✕</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
        >
          {categories.map(cat => {
            const active = cat.id === currentCategoryId;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.tile, active && styles.tileActive]}
                onPress={() => { onSelect(cat.id); onClose(); }}
                activeOpacity={0.75}
              >
                <Text style={styles.tileEmoji}>{cat.emoji ?? '💰'}</Text>
                <Text
                  style={[styles.tileName, { fontFamily: fonts.medium }, active && styles.tileNameActive]}
                  numberOfLines={1}
                >
                  {cat.name}
                </Text>
                {active && (
                  <View style={styles.checkBadge}>
                    <Text style={styles.checkText}>✓</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
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
    backgroundColor: t.line2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: t.line,
  },
  title: {
    fontSize: 18,
    color: t.text,
  },
  closeBtn: {
    fontSize: 18,
    color: t.text2,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 12,
  },
  tile: {
    width: '30%',
    minWidth: 90,
    backgroundColor: 'rgba(255,255,255,0.055)',
    borderWidth: 1,
    borderColor: t.glassLine,
    borderRadius: t.rMd,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 8,
  },
  tileActive: {
    borderColor: t.auraAqua,
    backgroundColor: 'rgba(94,234,212,0.10)',
  },
  tileEmoji: {
    fontSize: 28,
  },
  tileName: {
    fontSize: 12,
    color: t.text2,
    textAlign: 'center',
  },
  tileNameActive: {
    color: t.auraAqua,
  },
  checkBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: t.auraAqua,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkText: {
    fontSize: 11,
    color: t.auraBg,
    fontWeight: '700',
  },
});
