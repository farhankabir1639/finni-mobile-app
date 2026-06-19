// ── Data export (Pro) ────────────────────────────────────────────────────────
// CSV (full transaction history) + a styled PDF monthly report. Both write to
// the cache dir and hand off to the OS share sheet. Uses the stable legacy
// expo-file-system API (writeAsStringAsync) to avoid the SDK-54 new-API churn.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { supabase } from './supabase';

type TxRow = {
  date: string;
  description: string | null;
  type: string | null;
  withdrawal: number | null;
  deposit: number | null;
  category_id: string | null;
};

async function fetchExportData(userId: string) {
  const [{ data: txs }, { data: cats }] = await Promise.all([
    supabase
      .from('transactions')
      .select('date, description, type, withdrawal, deposit, category_id')
      .eq('user_id', userId)
      .order('date', { ascending: false }),
    supabase.from('categories').select('id, name').eq('user_id', userId),
  ]);
  const catMap = new Map<string, string>((cats ?? []).map((c: any) => [c.id, c.name]));
  return { txs: (txs ?? []) as TxRow[], catMap };
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function signedAmount(tx: TxRow): number {
  const isIncome = tx.type === 'income' || (Number(tx.deposit) || 0) > 0;
  return isIncome ? Number(tx.deposit) || 0 : -(Number(tx.withdrawal) || 0);
}

/** Export the full transaction history as a CSV via the share sheet. */
export async function exportTransactionsCSV(userId: string): Promise<{ ok: boolean; empty?: boolean }> {
  const { txs, catMap } = await fetchExportData(userId);
  if (!txs.length) return { ok: false, empty: true };

  const header = ['Date', 'Type', 'Category', 'Description', 'Amount'];
  const lines = [header.join(',')];
  for (const tx of txs) {
    lines.push([
      csvCell(tx.date),
      csvCell((tx.type === 'income' || (Number(tx.deposit) || 0) > 0) ? 'income' : 'expense'),
      csvCell(tx.category_id ? catMap.get(tx.category_id) ?? 'Uncategorized' : 'Uncategorized'),
      csvCell(tx.description),
      csvCell(signedAmount(tx).toFixed(2)),
    ].join(','));
  }
  const csv = lines.join('\n');
  const uri = FileSystem.cacheDirectory + 'finni-transactions.csv';
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });

  if (!(await Sharing.isAvailableAsync())) return { ok: false };
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export transactions (CSV)', UTI: 'public.comma-separated-values-text' });
  return { ok: true };
}

/** Export a styled monthly PDF report (current month) via the share sheet. */
export async function exportMonthlyReportPDF(userId: string, currencySymbol: string): Promise<{ ok: boolean; empty?: boolean }> {
  const { txs, catMap } = await fetchExportData(userId);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const inMonth = txs.filter((t) => new Date(t.date) >= monthStart);
  if (!inMonth.length) return { ok: false, empty: true };

  let income = 0;
  let expense = 0;
  const byCat = new Map<string, number>();
  for (const tx of inMonth) {
    const amt = signedAmount(tx);
    if (amt >= 0) income += amt;
    else {
      expense += -amt;
      const name = tx.category_id ? catMap.get(tx.category_id) ?? 'Uncategorized' : 'Uncategorized';
      byCat.set(name, (byCat.get(name) ?? 0) - amt);
    }
  }
  const net = income - expense;
  const fmt = (n: number) => `${currencySymbol}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const monthLabel = now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const catRows = [...byCat.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, v]) => `<tr><td>${name}</td><td class="r">${fmt(v)}</td><td class="r">${expense ? Math.round((v / expense) * 100) : 0}%</td></tr>`)
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"/>
    <style>
      * { font-family: -apple-system, system-ui, sans-serif; }
      body { padding: 32px; color: #111827; }
      h1 { font-size: 22px; margin: 0; }
      .sub { color: #6b7280; margin: 2px 0 24px; }
      .cards { display: flex; gap: 12px; margin-bottom: 24px; }
      .card { flex: 1; border: 1px solid #e5e7eb; border-radius: 14px; padding: 14px 16px; }
      .label { font-size: 11px; color: #6b7280; text-transform: uppercase; letter-spacing: .5px; }
      .val { font-size: 20px; font-weight: 800; margin-top: 4px; }
      .pos { color: #059669; } .neg { color: #dc2626; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { text-align: left; padding: 9px 6px; border-bottom: 1px solid #f0f0f3; font-size: 13px; }
      th { color: #6b7280; font-size: 11px; text-transform: uppercase; }
      .r { text-align: right; }
      .foot { margin-top: 28px; color: #9ca3af; font-size: 11px; }
    </style></head><body>
    <h1>Finni — Monthly Report</h1>
    <div class="sub">${monthLabel}</div>
    <div class="cards">
      <div class="card"><div class="label">Income</div><div class="val pos">${fmt(income)}</div></div>
      <div class="card"><div class="label">Spent</div><div class="val neg">${fmt(expense)}</div></div>
      <div class="card"><div class="label">Net</div><div class="val ${net >= 0 ? 'pos' : 'neg'}">${fmt(net)}</div></div>
    </div>
    <h3>Spending by category</h3>
    <table><thead><tr><th>Category</th><th class="r">Amount</th><th class="r">Share</th></tr></thead>
    <tbody>${catRows || '<tr><td colspan="3">No spending this month.</td></tr>'}</tbody></table>
    <div class="foot">Generated by Finni · ${now.toLocaleDateString()} · ${inMonth.length} transactions</div>
  </body></html>`;

  const { uri } = await Print.printToFileAsync({ html });
  if (!(await Sharing.isAvailableAsync())) return { ok: false };
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Export monthly report (PDF)', UTI: 'com.adobe.pdf' });
  return { ok: true };
}
