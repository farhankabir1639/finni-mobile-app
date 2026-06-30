# Auto-Capture v1 — Email Forwarding (Build Plan)

Status: **plan / not started.** Supersedes the channel question in
`auto-transaction-capture-spec.md` with findings from the 2026-06-17 audit of
the **already-deployed** (but prototype-quality) backend.

> **Decision:** ship **email forwarding** as the v1 channel. It's cross-platform
> (works on iOS too), needs **no native code**, and **dodges the Play SMS /
> notification-listener policy minefield** entirely. The native notification
> listener is deferred (Android-only, native, policy-scrutinized).

---

## 1. What already exists (recovered into git 2026-06-17) — and its real state

| Function | What it is | Verdict |
|---|---|---|
| `process-forwarded-email` | Inbound-email webhook → calls extractor | **Salvage shell, FIX multi-user bug** (attributes every email to `connections[0]`) |
| `extract-transactions` | Regex extractor, **`$`/USD only** | **Replace** — fails on ৳/Tk/bKash/Nagad |
| `categorize-transaction` | Real **Gemini** categorizer w/ history | **Reuse** — bump `gemini-1.5-flash`→`2.5-flash`, fix `[0]` fallback, wire it in |
| `ai-extract-transactions` | CSV/XLSX/PDF **file-upload** parser | **Defer** — separate "statement import" feature (P3) |
| `ai-categorize-transactions` | File-upload categorizer | Defer with above |

Tables (exist remotely): `email_sms_connections`, `extracted_transactions`
(**two functions write conflicting shapes — define ONE schema**),
`user_uploaded_files` (upload path). **No client UI exists for any of it.**

The 6 problems from the audit (US-only, not-really-AI, multi-user bug, schema
conflict, full-content storage, no UI) define the rebuild scope below.

---

## 2. How email forwarding works (the model)

```
bank/MFS email ──(user's Gmail auto-forward rule)──▶ u_<token>@inbound.heyfinni.com
   │
   ▼  (inbound email provider → webhook)
process-forwarded-email
   │  1. match user by the alias in `to:` (FIX: not connections[0])
   │  2. on-device-style filter: financial-sender allowlist + keywords; drop the rest
   │  3. OTP/2FA scrub → keep redacted minimum
   ▼
grounded Gemini extractor  → {amount, currency, merchant, type, date, confidence}
   │  (number-validated: amount must appear in source)
   ▼
categorize (reuse categorize-transaction)  → suggested_category_id + confidence
   ▼
stage → extracted_transactions (status='pending')
   ▼
App "Review" tab → user accepts / edits / rejects → insert into transactions
```

**Unique-alias matching is the multi-user fix:** each user gets a unique
forwarding address; the webhook identifies the user by that `to:` address, not
by grabbing the first active connection.

---

## 3. Build scope

**Backend**
- `email_sms_connections`: per-user `forwarding_alias` (unique), `user_id`, `is_active`. Generate alias on enable.
- Rewrite `process-forwarded-email`: match user by alias; financial filter; OTP scrub; call grounded extractor + categorizer; stage result.
- New grounded extractor (replace `extract-transactions` logic): Gemini prompt over the email text → structured fields, **BDT/bKash/Nagad-aware**, amount number-guarded. Store only a **redacted snippet**, not the full email.
- Reuse `categorize-transaction` (model bump + drop `[0]` fallback → use the ask-to-create / "Other" pattern).
- **One clean `extracted_transactions` schema:** `id, user_id, source, source_hash (unique per user → dedup), raw_snippet (redacted), amount, merchant, type, occurred_at, suggested_category_id, confidence, status, created_at`. RLS owner-only.

**Client**
- **"Review" surface** (new tab or a Wallet section): pending cards showing amount / merchant / date / AI category + confidence / source line. Actions: **Accept**, **Change category**, **Reject**. On accept → insert via the existing transaction path.
- **"Auto-import from email" setup** (Settings): shows the user's unique forwarding alias + copy button + step-by-step ("In Gmail, make a filter forwarding bank emails here"), behind a **consent + privacy disclosure** screen.

**Compliance**
- Explicit consent before enabling; Privacy Policy + Play Data Safety updates (you're forwarding message content to Gemini — must be disclosed).

---

## 4. The one piece of new infrastructure you need

**An inbound-email → webhook provider.** Resend (your current email vendor) is
**outbound-only**, so it can't receive the forwarded emails. Options:
- **Cloudflare Email Routing** — free; routes `@inbound.heyfinni.com` to a Worker that POSTs to the function. Cheapest.
- **Postmark / SendGrid / Mailgun inbound parse** — paid; POST a webhook in exactly the `{from,to,subject,text,html}` shape `process-forwarded-email` already expects.

Either needs **MX records** on a subdomain (e.g. `inbound.heyfinni.com`). This
is the main setup task and a real open decision (§6).

---

## 5. Phasing

- **P1 (this build):** inbound provider + alias + fixed webhook + grounded BDT extractor + clean schema + Review tab + setup/consent UI. Email forwarding works end-to-end.
- **P2:** auto-approve high-confidence items (opt-in); dedup polish; weekly "you have N to review" nudge.
- **P3:** file-upload statement import (salvage the `ai-extract`/`user_uploaded_files` path).
- **P4 (maybe never):** native notification listener / SMS — only if email coverage proves insufficient.

---

## 6. Open decisions

1. **Inbound provider:** Cloudflare Email Routing (free, a bit more wiring) vs Postmark/SendGrid/Mailgun inbound parse (paid, plug-and-play)?
2. **Alias domain/subdomain** for forwarding (needs MX) — `inbound.heyfinni.com`?
3. **Review surface:** a new bottom-tab, or a section inside Wallet?
4. **v1 auto-approve?** Recommend **always-review in v1** to build trust, auto-approve in P2.
5. **Extraction location** confirmed server-side (edge function) — text already leaves the device to an inbound provider, so server extraction is consistent; still send Gemini the **redacted minimum**.

---

## 6b. Go-live checklist (code is DONE 2026-06-19 — these are infra steps)

**Provider decided: Resend** (already our outbound vendor → one account). Resend now
supports inbound. Note its model differs from SendGrid: the webhook is **metadata
-only** (`email.received` with an `email_id`), so the function fetches the body via
`GET https://api.resend.com/emails/receiving/{id}`, and webhooks are **Svix-signed**.
`process-forwarded-email` (v3) already implements this.

All app + backend code is built and committed behind `EMAIL_CAPTURE_ENABLED=false`.
To turn the feature on end-to-end:

1. **Apply the migration** `supabase/migrations/20260617_email_capture.sql` in prod
   (`email_sms_connections`, `extracted_transactions`, RLS, dedup index).
2. **Resend → Domains:** add `in.heyfinni.com` for **receiving** and add the **MX
   record** it gives you (use the subdomain, not the root, to avoid clashing with
   the sending domain). Verify it. (This is the alias domain in `emailCapture.ts`.)
3. **Resend → Webhooks:** create a webhook for the **`email.received`** event
   pointing at the deployed function URL
   `https://<project>.functions.supabase.co/process-forwarded-email`. Copy its
   **signing secret** (`whsec_…`).
4. **Set Supabase secrets** on the function: `RESEND_INBOUND_SIGNING_SECRET`
   (= the `whsec_…` from step 3). `RESEND_API_KEY` + `GEMINI_API_KEY` are already set.
5. **Deploy** `process-forwarded-email` **with `--no-verify-jwt`** (Resend's webhook
   has no Supabase JWT; signature auth is done in-function via Svix).
6. **Compliance:** update Privacy Policy + Play Data Safety — forwarded email
   content is sent to Gemini for extraction (already OTP-scrubbed + filtered).
7. **Flip** `EMAIL_CAPTURE_ENABLED = true` in `src/lib/featureFlags.ts` → build.
8. **Verify on device:** Settings → Auto-import shows your alias; forward a real
   bank/bKash email; confirm it appears in the **Review** tab to accept.

## 7. Honest take

The deployed backend is a **scaffold, not a head start you can ship** — it's
US-only, has a multi-user bug, stores raw content, and has no UI. But it
**validates the architecture and the channel choice**, and `categorize-transaction`
is directly reusable. The real work is: one infra decision (inbound provider),
a proper BDT-aware grounded extractor, the multi-user fix, and the entire client
Review/setup UX. This is a focused feature build of its own — **not** something to
bolt onto a release with other changes.
