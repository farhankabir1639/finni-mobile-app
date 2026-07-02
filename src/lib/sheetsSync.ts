// ── Google Sheets sync (Pro) ─────────────────────────────────────────────────
// One-way push: Finni → a user-owned "Finni Transactions" Google Sheet.
// OAuth is handled in the UI via expo-auth-session's Google provider (it derives
// the correct per-platform redirect from the Android client ID). This module is
// the token-agnostic REST + orchestration layer: given a Google access token
// (drive.file scope), it get-or-creates the sheet and clear+rewrites the rows.
//
// Gated behind SHEETS_SYNC_ENABLED. Needs a Google Cloud OAuth client +
// EXPO_PUBLIC_GOOGLE_SHEETS_CLIENT_ID + scope verification — see
// docs/sheets-sync-setup.md.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { captureError } from './sentry';

export const SHEETS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_SHEETS_CLIENT_ID ?? '';
export const SHEETS_CONFIGURED = !!SHEETS_CLIENT_ID;
export const SHEETS_SCOPES = ['https://www.googleapis.com/auth/drive.file'];

const sheetIdKey = (userId: string) => `sheets_sync_id_${userId}`;

export type SyncResult =
  | { ok: true; url: string; rows: number }
  | { ok: false; reason: 'not_configured' | 'cancelled' | 'error'; message?: string };

// ── Sheets REST helpers ──────────────────────────────────────────────────────
async function createSpreadsheet(token: string): Promise<string | null> {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title: 'Finni Transactions' } }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d?.spreadsheetId ?? null;
}

async function spreadsheetExists(token: string, id: string): Promise<boolean> {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}?fields=spreadsheetId`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.ok;
}

async function writeValues(token: string, id: string, values: (string | number)[][]): Promise<boolean> {
  // Clear then write so deleted/edited transactions don't leave stale rows.
  await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A:Z:clear`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` },
  });
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/A1?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    }
  );
  return res.ok;
}

// ── Build rows from the user's transactions ──────────────────────────────────
async function buildRows(userId: string): Promise<(string | number)[][]> {
  const [{ data: txs }, { data: cats }] = await Promise.all([
    supabase.from('transactions')
      .select('date, description, type, withdrawal, deposit, category_id')
      .eq('user_id', userId).order('date', { ascending: false }),
    supabase.from('categories').select('id, name').eq('user_id', userId),
  ]);
  const catMap = new Map<string, string>((cats ?? []).map((c: any) => [c.id, c.name]));
  const rows: (string | number)[][] = [['Date', 'Type', 'Category', 'Description', 'Amount']];
  for (const tx of (txs ?? []) as any[]) {
    const isIncome = tx.type === 'income' || (Number(tx.deposit) || 0) > 0;
    rows.push([
      tx.date ?? '',
      isIncome ? 'income' : 'expense',
      tx.category_id ? catMap.get(tx.category_id) ?? 'Uncategorized' : 'Uncategorized',
      tx.description ?? '',
      isIncome ? Number(tx.deposit) || 0 : -(Number(tx.withdrawal) || 0),
    ]);
  }
  return rows;
}

// ── Public: push everything to the sheet, given an OAuth token ───────────────
export async function pushTransactionsToSheet(userId: string, token: string): Promise<SyncResult> {
  if (!token) return { ok: false, reason: 'error', message: 'No Google access token.' };
  try {
    // Reuse the user's existing Finni sheet if it's still there, else create one.
    let id = await AsyncStorage.getItem(sheetIdKey(userId));
    if (id && !(await spreadsheetExists(token, id))) id = null;
    if (!id) {
      id = await createSpreadsheet(token);
      if (!id) return { ok: false, reason: 'error', message: 'Could not create the spreadsheet.' };
      await AsyncStorage.setItem(sheetIdKey(userId), id);
    }
    const rows = await buildRows(userId);
    const wrote = await writeValues(token, id, rows);
    if (!wrote) return { ok: false, reason: 'error', message: 'Could not write to the spreadsheet.' };
    return { ok: true, url: `https://docs.google.com/spreadsheets/d/${id}`, rows: rows.length - 1 };
  } catch (e) {
    captureError(e, { context: 'pushTransactionsToSheet' });
    return { ok: false, reason: 'error', message: 'Sync failed. Please try again.' };
  }
}
