// ── Feature flags ────────────────────────────────────────────────────────────
// Simple build-time flags for gating unfinished/unverified features out of
// production builds without removing the code.

// Email-forwarding auto-capture (Review inbox + Auto-import setup).
// Backend live as of 2026-06-19: SendGrid Inbound Parse → process-forwarded-email
// (deployed, --no-verify-jwt, INBOUND_WEBHOOK_SECRET set), MX on in.heyfinni.com,
// migrations applied. See docs/auto-capture-email-v1-plan.md §6b.
export const EMAIL_CAPTURE_ENABLED = true;

// Google Sheets sync (Pro). Keep FALSE until a Google Cloud OAuth client exists
// and EXPO_PUBLIC_GOOGLE_SHEETS_CLIENT_ID is set + the Sheets scope is verified.
// See docs/sheets-sync-setup.md. Flip to true to surface it in Settings.
export const SHEETS_SYNC_ENABLED = false;
