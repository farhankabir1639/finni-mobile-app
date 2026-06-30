import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Modal, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { t, fonts } from '../theme/tokens';
import { type PickerCategory } from './CategoryPickerSheet';
import ReviewQueue from './ReviewQueue';
import Aurora from './Aurora';

interface Props {
  visible: boolean;
  userId: string;
  categories: PickerCategory[];
  currencySymbol: string;
  onClose: () => void;
  onChanged: () => void; // refresh pending badge in parent
}

// Home entry-point into the auto-capture review queue (the Review tab renders the
// same <ReviewQueue>). Nothing here is in the ledger until the user accepts.
export default function ReviewModal({ visible, userId, categories, currencySymbol, onClose, onChanged }: Props) {
  const { width, height } = useWindowDimensions();
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
          <ReviewQueue
            userId={userId}
            categories={categories}
            currencySymbol={currencySymbol}
            onChanged={onChanged}
            reloadSignal={visible ? 1 : 0}
          />
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: t.auraBg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16 },
  title: { fontSize: 20, fontFamily: fonts.bold, color: t.text },
  close: { fontSize: 20, color: t.text2 },
  sub: { fontSize: 13, fontFamily: fonts.regular, color: t.text2, paddingHorizontal: 20, paddingBottom: 8, lineHeight: 18 },
});
