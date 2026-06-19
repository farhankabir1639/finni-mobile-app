// ── Feature flags ────────────────────────────────────────────────────────────
// Simple build-time flags for gating unfinished/unverified features out of
// production builds without removing the code.

// Email-forwarding auto-capture (Review inbox + Auto-import setup).
// Keep FALSE until the SendGrid inbound provider + MX + INBOUND_WEBHOOK_SECRET
// are configured and the flow is verified end-to-end. See
// docs/email-forwarding-v1-spec.md. Flip to true to surface it in the app.
export const EMAIL_CAPTURE_ENABLED = false;
