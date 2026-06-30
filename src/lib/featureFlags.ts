// ── Feature flags ────────────────────────────────────────────────────────────
// Simple build-time flags for gating unfinished/unverified features out of
// production builds without removing the code.

// Email-forwarding auto-capture (Review inbox + Auto-import setup).
// Backend live as of 2026-06-19: SendGrid Inbound Parse → process-forwarded-email
// (deployed, --no-verify-jwt, INBOUND_WEBHOOK_SECRET set), MX on in.heyfinni.com,
// migrations applied. See docs/auto-capture-email-v1-plan.md §6b.
export const EMAIL_CAPTURE_ENABLED = true;
