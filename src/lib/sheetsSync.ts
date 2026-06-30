// ── Google Sheets sync (Pro) ─────────────────────────────────────────────────
// One-way push: Finni → a "Finni Transactions" Google Sheet the user owns.
// "Sync now" flow: Google OAuth (implicit, drive.file scope — no client secret,
// only sheets Finni created) → get-or-create the spreadsheet → overwrite rows.
//
// Gated behind SHEETS_SYNC_ENABLED. Needs a Google Cloud OAuth client +
// EXPO_PUBLIC_GOOGLE_SHEETS_CLIENT_ID + scope verification — see
// docs/sheets-sync-setup.md. Background/auto sync (refresh tokens, server-side)
// is a later phase; this is manual "Sync now".

import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { captureError } from './sentry';

WebBrowser.maybeCompleteAuthSession();

const CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_SHEETS_CLIENT_ID ?? '';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const sheetIdKey = (userId: string) => `sheets_sync_id_${userId}`;

export type SyncResult =
  | { ok: true; url: string; rows: number }
  | { ok: false; reason: 'not_configured' | 'cancelled' | 'error'; message?: string };

export const SHEETS_CONFIGURED = !!CLIENT_ID;

// ── OAuth (implicit) — returns a short-lived access token ────────────────────
async function getAccessToken(): Promise<string | null> {
  if (!CLIENT_ID) return null;
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'finni-app', path: 'sheets/callback' });
  const url =
    `${AUTH_ENDPOINT}?client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=token` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&prompt=consent`;
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUri);
  if (result.type !== 'success' || !result.url) return null;
  // Implicit flow returns the token in the URL fragment.
  const frag = result.url.split('#')[1] ?? '';
  const params = new URLSearchParams(frag);
  return params.get('access_token');
}

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

// ── Public: manual "Sync now" ────────────────────────────────────────────────
export async function syncTransactionsToSheets(userId: string): Promise<SyncResult> {
  if (!SHEETS_CONFIGURED) return { ok: false, reason: 'not_configured', message: 'Google Sheets isn’t set up in this build yet.' };
  try {
    const token = await getAccessToken();
    if (!token) return { ok: false, reason: 'cancelled' };

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
    captureError(e, { context: 'syncTransactionsToSheets' });
    return { ok: false, reason: 'error', message: 'Sync failed. Please try again.' };
  }
}
