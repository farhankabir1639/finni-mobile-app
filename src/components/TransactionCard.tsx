import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { supabase } from '../lib/supabase';
import { t, fonts } from '../theme/tokens';
import RecurringBanner from './RecurringBanner';

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', BDT: '৳', EUR: '€', GBP: '£', AUD: 'A$', CAD: 'C$', SGD: 'S$', INR: '₹',
};
function getCurrencySymbol(code?: string | null): string {
  return CURRENCY_SYMBOLS[code ?? 'USD'] ?? code ?? '$';
}

function getWeekStartISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  // Use local date parts to avoid UTC conversion shifting the day
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${monday.getFullYear()}-${pad(monday.getMonth() + 1)}-${pad(monday.getDate())}`;
}

function buildTagline(
  weeklyTotal: number,
  monthlyBudget: number | undefined,
  categoryName: string,
  type: 'expense' | 'income',
): string {
  if (type === 'income') return 'Income logged successfully! 💪';
  if (!monthlyBudget || monthlyBudget === 0) return '';
  const weeklyBudget = monthlyBudget / 4.33;
  const ratio = weeklyTotal / weeklyBudget;
  if (ratio >= 1.0) return `You've hit your weekly ${categoryName} pace. Consider slowing down 🎯`;
  if (ratio >= 0.8) return `You're at ${Math.round(ratio * 100)}% of your ${categoryName} weekly pace — watch out!`;
  return `You're doing great! Still within your ${categoryName} budget 👍`;
}

export interface TransactionCardProps {
  userId: string;
  amount: number;
  category: string;
  type: 'expense' | 'income';
  categories: { id: string; name: string; emoji?: string; budget?: number }[];
  currency: string;
  description?: string;        // originating transaction description (for recurring)
  date?: string;              // originating transaction date (recurring anchor)
  allowRecurring?: boolean;   // show the "🔁 Repeat this?" banner (fresh chat logs)
}

export default function TransactionCard({
  userId, amount, category, type, categories, currency, description, date, allowRecurring,
}: TransactionCardProps) {
  const [weeklyTotal, setWeeklyTotal] = useState<number | null>(null);

  const sym = getCurrencySymbol(currency);

  const matched = categories.find(c => c.name.toLowerCase() === category.toLowerCase())
    ?? categories.find(c =>
      c.name.toLowerCase().includes(category.toLowerCase()) ||
      category.toLowerCase().includes(c.name.toLowerCase())
    );

  const emoji = matched?.emoji ?? (type === 'income' ? '💰' : '📦');
  const displayCategory = matched?.name ?? category;

  useEffect(() => {
    if (!userId || !matched?.id) {
      setWeeklyTotal(0);
      return;
    }
    supabase
      .from('transactions')
      .select('withdrawal, deposit')
      .eq('user_id', userId)
      .eq('category_id', matched.id)
      .eq('type', type)
      .gte('date', getWeekStartISO())
      .then(
        ({ data }) => {
          const total = (data ?? []).reduce((sum, r) =>
            sum + (type === 'expense' ? (Number(r.withdrawal) || 0) : (Number(r.deposit) || 0)), 0);
          setWeeklyTotal(total);
        },
        () => setWeeklyTotal(0),
      );
  }, [userId, matched?.id, type]);

  const tagline = weeklyTotal !== null
    ? buildTagline(weeklyTotal, matched?.budget, displayCategory, type)
    : '';

  return (
    <View style={s.card}>
      <View style={s.header}>
        <Text style={s.headerText}>Got it! {emoji}</Text>
      </View>

      <View style={s.divider} />

      <View style={s.rows}>
        <View style={s.row}>
          <Text style={s.label}>Category</Text>
          <Text style={s.valueAccent}>{displayCategory}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>Amount</Text>
          <Text style={s.value}>{sym}{amount.toFixed(2)}</Text>
        </View>
        <View style={s.row}>
          <Text style={s.label}>This week</Text>
          <Text style={s.value}>
            {weeklyTotal !== null ? `${sym}${weeklyTotal.toFixed(2)}` : '…'}
          </Text>
        </View>
      </View>

      {tagline ? (
        <>
          <View style={s.divider} />
          <Text style={s.tagline}>{tagline}</Text>
        </>
      ) : null}

      {allowRecurring ? (
        <>
          <View style={s.divider} />
          <RecurringBanner
            userId={userId}
            amount={amount}
            type={type}
            categoryId={matched?.id ?? null}
            description={description ?? displayCategory}
            date={date}
          />
        </>
      ) : null}
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
  },
  header: {
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  headerText: {
    fontSize: 16,
    fontFamily: fonts.bold,
    color: t.auraAqua,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.glassLine2,
  },
  rows: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    gap: 9,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    fontFamily: fonts.regular,
    color: t.text3,
  },
  value: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: t.text,
  },
  valueAccent: {
    fontSize: 13,
    fontFamily: fonts.semiBold,
    color: t.auraAqua,
  },
  tagline: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 12.5,
    fontFamily: fonts.regular,
    color: t.text2,
  },
});
