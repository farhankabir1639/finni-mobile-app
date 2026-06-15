import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { t, fonts } from '../theme/tokens';
import { createProposedCategory, removePendingProposal } from '../lib/categoryProposals';
import type { CategoryProposal } from '../lib/agents';

type Status = 'pending' | 'busy' | 'created' | 'skipped';

interface Props {
  userId: string;
  proposals: CategoryProposal[];
  // Called after a category is created so the parent can refresh its category
  // list (so later transactions in the session match the new category).
  onResolved?: () => void;
}

export default function CategoryProposalCard({ userId, proposals, onResolved }: Props) {
  const [status, setStatus] = useState<Record<string, Status>>({});
  const get = (name: string): Status => status[name] ?? 'pending';
  const setOne = (name: string, s: Status) => setStatus((prev) => ({ ...prev, [name]: s }));

  const create = async (p: CategoryProposal) => {
    if (get(p.name) !== 'pending') return;
    setOne(p.name, 'busy');
    const id = await createProposedCategory(userId, p);
    await removePendingProposal(userId, p.name);
    setOne(p.name, id ? 'created' : 'skipped');
    if (id) onResolved?.();
  };

  const skip = async (p: CategoryProposal) => {
    if (get(p.name) !== 'pending') return;
    await removePendingProposal(userId, p.name);
    setOne(p.name, 'skipped');
  };

  const createAll = async () => {
    for (const p of proposals) {
      if (get(p.name) === 'pending') await create(p);
    }
  };

  const multi = proposals.length > 1;
  const anyPending = proposals.some((p) => get(p.name) === 'pending');

  return (
    <View style={s.card}>
      <Text style={s.title}>New {multi ? 'categories' : 'category'}?</Text>
      <Text style={s.sub}>
        Saved under “Other” for now — want me to create {multi ? 'them' : 'it'}?
      </Text>

      <View style={s.rows}>
        {proposals.map((p) => {
          const st = get(p.name);
          return (
            <View key={p.name} style={s.row}>
              <Text style={s.emoji}>{p.emoji}</Text>
              <Text style={s.name} numberOfLines={1}>{p.name}</Text>
              {st === 'busy' ? (
                <ActivityIndicator size="small" color={t.auraAqua} style={s.trailing} />
              ) : st === 'created' ? (
                <Text style={[s.statusTxt, s.createdTxt]}>✓ Added</Text>
              ) : st === 'skipped' ? (
                <Text style={[s.statusTxt, s.skippedTxt]}>Skipped</Text>
              ) : (
                <View style={s.actions}>
                  <Pressable onPress={() => create(p)} hitSlop={6} style={s.createBtn}>
                    <Text style={s.createBtnTxt}>Create</Text>
                  </Pressable>
                  <Pressable onPress={() => skip(p)} hitSlop={6} style={s.skipBtn}>
                    <Text style={s.skipBtnTxt}>Skip</Text>
                  </Pressable>
                </View>
              )}
            </View>
          );
        })}
      </View>

      {multi && anyPending && (
        <Pressable onPress={createAll} hitSlop={6} style={s.createAll}>
          <Text style={s.createAllTxt}>Create all</Text>
        </Pressable>
      )}

      <Text style={s.footnote}>You can change or delete any transaction anytime in the Wallet tab.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(14, 12, 26, 0.97)',
    borderRadius: t.rMd,
    borderWidth: 1,
    borderColor: t.glassLine2,
    overflow: 'hidden',
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
  },
  title: {
    fontSize: 15,
    fontFamily: fonts.bold,
    color: t.text,
  },
  footnote: {
    fontSize: 11,
    fontFamily: fonts.regular,
    color: t.text3,
    marginTop: 12,
  },
  sub: {
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: t.text3,
    marginTop: 2,
    marginBottom: 10,
  },
  rows: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  emoji: { fontSize: 18 },
  name: {
    flex: 1,
    fontSize: 14,
    fontFamily: fonts.semiBold,
    color: t.text,
  },
  trailing: { marginLeft: 'auto' },
  actions: { flexDirection: 'row', gap: 8 },
  createBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: t.auraIndigo,
  },
  createBtnTxt: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: '#fff',
  },
  skipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.glassLine2,
  },
  skipBtnTxt: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: t.text3,
  },
  statusTxt: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
  },
  createdTxt: { color: t.auraAqua },
  skippedTxt: { color: t.text3 },
  createAll: {
    marginTop: 12,
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.auraIndigo,
  },
  createAllTxt: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: t.auraIndigo,
  },
});
