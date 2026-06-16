# Auto Transaction Capture (SMS / Notifications / Email) — Engineering Spec

Status: **proposal / not implemented**. Author: Claude (CTO planning pass).
Goal: auto-detect transactions from the user's messages, extract them with AI,
and let the user review them (accept AI's category or pick their own) in a new
"Review" navigation module — reducing manual logging.

> ⚠️ **Read §2 and §3 first.** This feature is heavily constrained by platform
> APIs and Google Play policy. The naive version ("read SMS + notifications +
> email everywhere") will get the app **rejected/removed** and is **impossible
> on iOS**. The viable feature is narrower than it sounds.

---

## 1. The dream vs. the reality

The pitch: grant read access to notifications, SMS, and email → AI decides
what's a transaction → user reviews category in a new module.

The reality is that **each channel behaves completely differently per platform**,
and one of them (SMS) is a Play-Store landmine.

## 2. Platform reality (the central constraint)

| Channel | Android | iOS |
|---|---|---|
| **Notifications** | ✅ `NotificationListenerService` (special access, user-enabled in system settings). Can read bank/MFS push alerts. **Most viable channel.** | ❌ Impossible. iOS apps cannot read other apps' notifications. |
| **SMS** | ⚠️ Technically possible (`READ_SMS`) but **Play-policy-restricted** — see §3. High rejection/takedown risk. | ❌ Impossible. iOS has no API to read Messages. |
| **Email** | ✅ via Gmail/provider **OAuth API** (not a device permission) | ✅ same OAuth API |

**Takeaways:**
- This is **primarily an Android feature.** On iOS, the *only* possible channel
  is email-via-OAuth.
- The lowest-risk, highest-value on-device channel is the **Android notification
  listener** (bank/bKash/Nagad/card push alerts), not SMS.
- "Read email" is not a phone permission — it's an OAuth integration with Gmail
  (and Google **restricted-scope verification**, see §3), which is a project of
  its own.

## 3. Google Play policy — the #1 risk

- **SMS/Call Log Permissions policy:** apps requesting `READ_SMS`/`RECEIVE_SMS`
  must be the user's **default SMS handler** or fit a short approved-exception
  list. **Expense tracking is NOT an approved use case.** You'd submit a
  Permissions Declaration and most likely be **rejected — and a live app can be
  removed** for non-compliant SMS access. **Recommendation: do NOT ship SMS
  reading.** It's the feature most likely to kill the app.
- **Notification access** (`BIND_NOTIFICATION_LISTENER_SERVICE`): allowed, but
  Play scrutinizes it — core functionality must genuinely need it, with a
  prominent disclosure + privacy-policy coverage. Reading financial alerts is a
  legitimate, defensible use. **This is the viable on-device path.**
- **Gmail API `gmail.readonly`** is a **restricted scope** → requires Google's
  OAuth verification **plus an annual third-party CASA security assessment**
  (real $ and effort). Budget for this before committing to email.

## 4. Privacy & compliance (non-negotiable)

You'd be touching the most sensitive data on the device — OTPs, 2FA codes,
personal messages. Mishandling this is an existential risk for a finance app.

- **On-device pre-filtering FIRST.** Never forward everything to the cloud. A
  cheap on-device filter (sender allowlist of bank/MFS senders + amount/keyword
  regex) decides "could this be a transaction." Everything else is **discarded
  immediately, never transmitted, never stored.**
- **OTP/2FA scrubbing.** Detect and drop one-time-codes; never store or send.
- **Data minimization to the AI.** Only the filtered candidate snippet goes to
  Gemini — and that's still sending a user's private message text to a third
  party (Google), so it requires **explicit, specific consent** and a privacy-
  policy clause. Prefer sending the *minimum* substring, redacted.
- **Prominent disclosure + consent BEFORE the permission prompt** (Play requires
  this for sensitive access): a screen explaining exactly what's read, why, where
  it goes, and how to turn it off.
- **Provenance + control:** every auto-detected item shows its source; one tap to
  disable capture; deleting Finni deletes the staged data.
- Update Privacy Policy + Play Data Safety form.

## 5. Architecture

```
[Capture]            [Filter]              [Extract]           [Review]          [Commit]
notif listener  ─┐                         Gemini (grounded)   new "Review" tab   transactions
SMS (if ever)   ─┼─►  on-device cheap  ─►  amount/merchant/  ─►  user confirms  ─►  table
email (OAuth)   ─┘    allowlist+regex      type/date/conf       or edits cat       (existing path)
                      + OTP scrub          + dedup
```

- **Capture (Android, native):** a `NotificationListenerService` via a custom
  Expo config plugin / native module (e.g. community `react-native-android-
  notification-listener`). Runs as a background service; hands posts to a
  headless JS task or buffers to local storage.
- **Filter (on-device, pure):** allowlist of known senders (bKash, Nagad, Rocket,
  bank short codes, card alerts) + amount/keyword regex + OTP detector. Discards
  non-financial immediately. **This is the privacy firewall.**
- **Extract (AI):** filtered candidates → Gemini → structured
  `{amount, merchant, type, date, account_hint, confidence}`. Grounded: validate
  the amount appears in the source text (reuse the number-validator pattern).
  Decision: run server-side (edge function — key safe, but message text leaves
  device) vs on-device. Given privacy, prefer sending the **redacted minimum**.
- **Dedup:** banks often send a notification *and* an SMS for one transaction;
  merge by (amount + time window + merchant). Also never re-import the same
  source message (store a hash).
- **Stage:** `pending_extracted_transactions` table (or local queue) for items
  awaiting review.
- **Commit:** on confirm, insert via the existing transactions path (reusing
  category resolution + the ask-to-create-category flow).

## 6. The "Review" module (new nav tab)

- A new tab (badge = pending count). Each card shows: extracted amount, merchant,
  date, **AI-suggested category + confidence**, and a "from: bKash SMS" source
  line.
- Actions per item: **Accept** (use AI category), **Change category**, **Reject**
  (not a transaction), and a global **"Let Finni auto-categorize"** toggle.
- **Confidence-driven flow:** high-confidence items can auto-approve after a grace
  period (opt-in); low-confidence always wait for review. Nothing hits the ledger
  without either review or the user's explicit auto-approve setting.
- Bulk accept/reject. Empty state. Clear "turn off auto-capture" entry point.

## 7. Accuracy / parsing

- Bank/MFS SMS+notification formats vary enormously (every bank, bKash, Nagad,
  card alerts differ). AI handles variety better than regex, but feed it the
  **sender + full snippet** for context.
- Category prediction reuses existing categorization; merchant→category mapping is
  a strong future use of the deferred **embeddings** work (a merchant name is
  exactly the semantic-match case).
- Confidence scoring gates auto-approve vs review.

## 8. Data model (sketch)

```sql
create table pending_extracted_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('notification','sms','email')),
  source_hash text not null,              -- dedup; never re-import same msg
  raw_snippet text,                       -- redacted minimum, OTPs scrubbed
  amount numeric, merchant text, type text,
  suggested_category text, confidence numeric,
  occurred_at timestamptz,
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  created_at timestamptz default now(),
  unique(user_id, source_hash)
);
-- RLS owner-only.
```

## 9. Native / build impact

- This **breaks the pure managed-Expo assumptions**: `NotificationListenerService`
  needs custom native Android code / a config plugin + `expo prebuild`. Background
  service lifecycle, headless JS, and OEM battery-killer quirks (the GigaX is a
  low-end device — aggressive process killing) are all real work.
- It's the most native-heavy, policy-sensitive feature in the app by far.

## 10. Recommended phasing

- **Phase 0 — decide channels (this doc).** Reality check: notifications (Android)
  is the viable MVP; SMS is a Play landmine; email is a separate OAuth project.
- **Phase 1 — MVP: Android notification capture.** Listener → on-device filter →
  extract → **Review tab** → confirm. Highest value, lowest policy risk, no SMS,
  no email. Ships the whole review UX on one channel.
- **Phase 2 — Email via Gmail OAuth** (adds iOS coverage; requires restricted-scope
  verification + CASA assessment — plan cost/time).
- **Phase 3 — SMS** *only* if you decide to become a default SMS handler or win a
  permissions declaration. High risk; may be "never."

## 11. Honest risk assessment

1. **SMS reading is likely app-takedown risk** — do not lead with it.
2. **iOS gets nothing but email** — set expectations; this is an Android-first feature.
3. **You're transmitting users' private messages to Gemini** — on-device filtering,
   redaction, explicit consent, and privacy-policy updates are mandatory, not nice-to-have.
4. **This is the most native + policy-heavy feature yet.** It's precisely where a
   contract senior Android engineer would de-risk you (native service + Play policy
   navigation). Worth revisiting the "no funds to hire" stance *for this feature
   specifically* — a rejection here hurts the whole app, not just the feature.

## 12. Open decisions for you

1. **Channel scope for v1:** Android notifications only (recommended), or push for
   SMS/email despite the risks?
2. **Extraction location:** server-side edge function (key-safe, text leaves device)
   vs on-device (more private, harder)? Privacy-first leans on-device or redacted-server.
3. **Auto-approve:** allow high-confidence auto-logging, or always require review in v1?
   (Recommended: always review in v1 to build trust.)
4. **iOS:** accept Android-only for now, or block the feature until email/OAuth is
   built for parity?
5. **Appetite for the Gmail restricted-scope verification + CASA cost** (if email).
