# Email-Forwarding Auto-Capture v1 — Build Spec

Status: **detailed plan / not started.** Builds on `auto-capture-email-v1-plan.md`
with concrete schemas, the extraction pipeline, security, and the **Review tab**.

**Goal:** a user forwards bank/MFS emails to a personal Finni address → Finni
extracts the transaction, suggests a category, and shows it in a dedicated
**Review** tab where the user **affirms or edits** before it hits their ledger.
Only auto-captured (email, later push) items appear in Review; manual chat
logging is unchanged.

---

## 1. End-to-end architecture

```
Bank/MFS email
   │  user's Gmail/Outlook auto-forward rule
   ▼
u-<token>@in.heyfinni.com   ──(inbound provider)──▶  webhook POST {from,to,subject,text}
   ▼
process-forwarded-email (rewritten)
   ├─ verify webhook secret/signature        (NEW — currently unauthenticated!)
   ├─ match user by `to` alias               (FIX multi-user bug)
   ├─ financial-sender/keyword filter → drop non-financial
   ├─ OTP/2FA scrub → keep redacted snippet
   ├─ dedup by source_hash (provider msg-id)
   ▼
extract (grounded Gemini, BDT-aware) → {amount,currency,direction,merchant,date,confidence}
   │  amount number-validated against source text
   ▼
categorize (reuse categorize-transaction, model-bumped) → suggested_category_id
   ▼
INSERT extracted_transactions (status='pending')
   ▼
App "Review" tab → Accept / Edit category / Reject → on Accept: INSERT transactions
```

---

## 2. Inbound email infrastructure (the gating decision)

Resend (current vendor) is **outbound-only** — can't receive. Two viable paths:

| Option | Cost | Effort | Notes |
|---|---|---|---|
| **Cloudflare Email Routing + Email Worker** (recommended *if* DNS is on Cloudflare) | Free | Medium | Catch-all `*@in.heyfinni.com` → Worker `email()` handler → `fetch()` to the function. No per-email cost, scales free. |
| **SendGrid Inbound Parse / Mailgun Routes** | Free tier | Low | POSTs the `{from,to,subject,text,html}` webhook the function already expects. Plug-and-play. |

**Deciding question:** where is `heyfinni.com` DNS hosted? If Cloudflare → use Email Routing (free, best). If elsewhere and you don't want to move DNS → SendGrid Inbound Parse (simplest webhook). Either needs **MX records** on a subdomain `in.heyfinni.com`.

---

## 3. Data model (concrete)

```sql
-- per-user forwarding connection + unguessable alias
create table if not exists email_sms_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_type text not null default 'email' check (connection_type in ('email','push')),
  forwarding_alias text unique,            -- e.g. u-9f3a2b@in.heyfinni.com
  is_active boolean not null default true,
  created_at timestamptz default now()
);
alter table email_sms_connections enable row level security;
create policy owner_all on email_sms_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ONE clean staging schema (resolves the conflict between the two old writers)
create table if not exists extracted_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('email','push')),
  source_hash text not null,               -- dedup: provider message-id (or from+amount+ts)
  raw_snippet text,                        -- REDACTED minimum, OTP-scrubbed
  amount numeric,
  direction text check (direction in ('expense','income')),
  merchant text,
  occurred_at timestamptz,
  suggested_category_id uuid references categories(id) on delete set null,
  confidence numeric,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz default now(),
  unique (user_id, source_hash)            -- idempotent: same email never re-imported
);
alter table extracted_transactions enable row level security;
create policy owner_all on extracted_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```
(The old `extracted_transactions` columns from the file-upload path get migrated/renamed; statement-import (P3) writes its own shape or a separate table.)

---

## 4. Webhook security (must-fix — currently open)

`process-forwarded-email` today has **no auth** — anyone could POST
`{to: victim_alias, text: "credited Tk 99999"}` and inject fake transactions.
Two layers:
1. **Unguessable alias** (random token) — attacker can't target a user without knowing their alias.
2. **Webhook secret/signature** — the inbound provider includes a shared secret header (or signs the request); the function rejects anything without it. Non-negotiable before launch.

---

## 5. Extraction pipeline (grounded, BD-aware)

- **Filter first:** sender allowlist (bKash, Nagad, Rocket, Upay, bank domains) + keyword check (Tk/৳/BDT, "debited/credited/payment/txn"). Non-financial → drop, never sent to Gemini.
- **OTP scrub:** strip 4–6 digit codes near "OTP/one-time/verification"; never store/send.
- **Grounded Gemini extraction** → `{amount, currency, direction, merchant, occurred_at, confidence}`. Handles ৳/Tk and bKash/Nagad/bank formats. **Amount must appear in the source text** (number-validator) or the item is dropped.
- **Categorize:** reuse `categorize-transaction` (bump `gemini-1.5-flash`→`2.5-flash`, drop the `[0]` fallback → unmatched stays uncategorized / "Other").
- **Dedup:** `source_hash` from the provider message-id (or `from|amount|occurred_at`), enforced by the unique index → the same email never creates two items.

---

## 6. The Review tab (the client half)

**Placement:** a dedicated bottom tab **"Review"** with a **count badge** (your explicit ask). Note: that's a 6th tab — tight on small devices. Recommended: show the tab always, badge it when items are pending; if crowding is a problem we fall back to an inbox icon + badge in the Home header. (Decision §9.)

**Empty state:** "Nothing to review yet. Forward your bank emails to **u-9f3a2b@in.heyfinni.com** and they'll show up here to confirm." + a "Set up forwarding" button.

**Pending list** — cards grouped by date, each showing:
- Merchant / description, **amount**, date
- Source chip: `📧 bKash email`
- **AI category** (tappable → opens the existing `CategoryPickerSheet` to change)
- Confidence cue: low-confidence items flagged "double-check this"

**Actions:**
- **Accept** ✓ → inserts a real `transactions` row (reusing the standard insert path + category resolution), marks the item `accepted`, removes it from Review.
- **Edit category** → pick, then Accept.
- **Reject** ✗ → marks `rejected` (not logged), removes it.
- **Accept all** for high-confidence items (opt-in; or P2).

**Trust rule:** nothing reaches the ledger without an explicit Accept in v1 (no silent auto-logging). Auto-approve high-confidence is a P2 setting.

---

## 7. Connect-email setup + consent UX

- **Settings → "Auto-import from email"** → a **consent screen** (what's read, that content goes to Finni's AI, how to turn off) → on enable, generate the alias and show it with a **copy button** + step-by-step Gmail/Outlook forwarding-filter instructions.
- Re-show the alias + a "test" hint ("forward one bank email to check it works").

---

## 8. Privacy & compliance
- On-receipt filter + OTP scrub + store only a **redacted snippet** (not full email).
- Explicit consent before enabling; **Privacy Policy + Play Data Safety** updated to disclose email content is processed by Gemini.
- Alias is per-user, revocable (deactivate connection = stop importing).

---

## 9. Edge cases
- **Non-financial / promo emails** → filtered out pre-AI.
- **Multiple transactions in one email** → v1 handles single-transaction bank alerts; statement-style multi-txn deferred to the file-upload path (P3).
- **Unparseable / low confidence** → still shown in Review, flagged, easy to reject.
- **Duplicate forwards** → `source_hash` unique index dedups.
- **Foreign currency** → captured with its currency; flagged if ≠ user's currency.
- **Wrong-user forward** (someone forwards to the wrong alias) → unguessable alias + it lands in the alias-owner's Review where they reject it.

---

## 10. Build milestones
1. **Infra:** pick provider (§2), MX on `in.heyfinni.com`, webhook secret.
2. **DB:** migrate to the clean `extracted_transactions` + `email_sms_connections` schema (§3).
3. **Backend:** rewrite `process-forwarded-email` (auth + alias match + filter + scrub + dedup); grounded extractor; wire `categorize-transaction`.
4. **Setup UX:** consent + alias display + forwarding instructions.
5. **Review tab:** list + accept/edit/reject + accept→transaction.
6. **Test E2E:** forward a real bKash/bank email → appears in Review → accept → in ledger.
7. **Compliance:** privacy policy + data-safety update before public release.

---

## 11. Open decisions (need your input to start)
1. **Inbound provider** — where's `heyfinni.com` DNS? (Cloudflare → Email Routing; else → SendGrid Inbound Parse). *Gates everything.*
2. **Alias subdomain** — `in.heyfinni.com`? (or your preference)
3. **Review surface** — dedicated 6th tab (your ask) vs Home-header inbox icon, if 6 tabs feels crowded.
4. **v1 auto-approve?** Recommend always-review in v1.
