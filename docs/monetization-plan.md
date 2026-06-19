# Finni Monetization Plan & Roadmap

_Owner: Farhan · Status: approved scope = Phase 0+1 · Last updated: 2026-06-19_

---

## 1. Strategy in one paragraph

Finni launches with a **single paid tier — Pro** — on a **freemium** model. Free nails
the core promise ("Know where your money goes"): unlimited manual logging + capped AI +
this-month analytics. Pro unlocks **the coach** (AI insights, email reports, Smart Budget)
and **automation** (recurring, investments, multi-currency, export, Sheets sync, and later
auto-capture). Pricing goes **visible in-app first**; AppSumo (a lifetime deal) comes later
as a paid-acquisition channel once the in-app plan is validated.

**Why monetization is a foundation, not a final phase:** building all features before
charging delays revenue and learning. We ship the paywall with 1–2 hero Pro features
(Phase 0+1), turn pricing on, learn what converts, then expand Pro depth phase by phase.

---

## 2. Pricing

| Plan | Price | Notes |
|---|---|---|
| **Free** | $0 | The hook. Generous, capped on cost drivers (AI). |
| **Pro — Monthly** | **$9.99 / mo** | Visible anchor. |
| **Pro — Annual** | **$79 / yr** | ~34% off monthly; pushes LTV + cash up front. |
| _Pro — Lifetime (AppSumo)_ | _~$59 one-time (Phase 4)_ | Channel deal only. Fair-use + bank-linking carve-out apply. |

Billing: **RevenueCat** as the single entitlement brain — native IAP (Google Play / App
Store) now; RevenueCat Web Billing reserved for AppSumo/web later. **No Chargebee/Stripe
in-app** (Apple/Google require native IAP for digital subscriptions).

---

## 3. Free vs Pro gating map

Principle: **logging is free, the coach + automation are Pro.** Never gate access to the
user's own historical data — cap AI *usage*, not data *retention*.

| Feature | Free | Pro |
|---|---|---|
| Manual transaction logging | ✅ Unlimited | ✅ |
| AI chat logging ("Message Finni") | ⚠️ 50 AI actions/mo | ✅ Fair use (500/mo) |
| Voice logging | ❌ | ✅ |
| This-month analytics + donut | ✅ | ✅ |
| History, 6-mo trends, custom ranges | ❌ | ✅ |
| **CSV / PDF export** _(new, Phase 1)_ | ❌ | ✅ |
| **Google Sheets sync** _(new, Phase 1)_ | ❌ | ✅ |
| Grounded AI insights ("Finni noticed") | ❌ (teaser) | ✅ |
| Email coach (daily/weekly reports) | ❌ | ✅ |
| Smart Budget (50/30/20 auto-budgeting) | ❌ | ✅ |
| Goals | ✅ 1 | ✅ Unlimited |
| Recurring transactions | ❌ | ✅ |
| Investments portfolio | ❌ | ✅ |
| Multi-currency | ⚠️ 1 currency | ✅ |
| Auto-capture / email forwarding _(Phase 2)_ | ❌ | ✅ |

### Free AI cap — definition
**50 "AI actions" per calendar month**, free tier. An AI action = any call that hits the
Gemini proxy: a Finni chat message, an insights generation/refresh, a voice transcription,
and (later) a receipt scan. **Counted and enforced server-side** in the `gemini-proxy` edge
function — the client can show the counter but cannot bypass the gate. On hitting the cap:
soft paywall ("You've used your 50 free AI actions this month — upgrade for unlimited").
Pro fair-use cap = 500/mo (protects margins on the eventual lifetime cohort).

---

## 4. Entitlement model

**DB (Supabase) — add to the user profile / a `subscriptions` row:**
- `plan` text default `'free'` — `'free' | 'pro'`
- `plan_source` text — `'iap' | 'appsumo' | 'web' | 'comp'`
- `plan_expires_at` timestamptz null — for subscription expiry / grace
- `ai_actions_used` int default 0
- `ai_actions_period_start` date — rolls the counter monthly

**App:**
- `useEntitlement()` hook → `{ isPro, plan, aiRemaining }` from ProfileContext.
- `<ProGate feature="...">` component — wraps gated UI, renders the paywall CTA for free users.
- RevenueCat SDK → entitlement webhook updates the DB row (source of truth synced both ways).

**Server (chokepoint):** `gemini-proxy` edge function checks `plan` + `ai_actions_used`
before calling Gemini; increments the counter; returns a `429 cap_reached` the app turns
into the paywall. This is the only bypass-proof place to enforce the AI cap.

---

## 5. Feature gaps to build (monetizable), ranked

1. **CSV / PDF export + monthly report** — cheap, low marginal cost, universally expected. _(Phase 1)_
2. **Google Sheets sync** — one-way push (Finni → Sheet, auto-append). Strong hook. _(Phase 1)_
   - ⚠️ Sensitive Google OAuth scope → requires Google app verification (days–weeks). **Start the paperwork early.**
3. **Auto-capture (email forwarding)** — ~80% built, gated. Flagship + AppSumo headline. _(Phase 2)_
4. **Receipt scanning (photo → vision AI)** — high wow, cap the cost. _(Phase 3)_
5. **Net-worth dashboard** — cash + investments + debts, near-zero marginal cost. _(Phase 3)_
6. **Bill reminders / due-dates** — extends recurring, drives re-engagement. _(Phase 3)_
7. **Year-in-review / shareable report** — viral + Pro. _(Phase 3)_
8. **Bank / SMS linking (Plaid/Mono)** — killer feature + recurring per-user cost. **Future higher tier; excluded from lifetime.** _(Phase 5)_

---

## 6. Phased roadmap

| Phase | Scope | Outcome |
|---|---|---|
| **0 — Foundation** | Entitlement model + server enforcement, `<ProGate>`, paywall screen, RevenueCat ($9.99/mo + $79/yr), 50-action free cap w/ soft upsell | Purchase flow works; nothing locked yet |
| **1 — Monetization launch** 🚀 | CSV/PDF export + Sheets sync (new); flip insights/email/Smart Budget/recurring/investments/multi-currency to Pro | **Pricing LIVE.** Start measuring conversion |
| **2 — Flagship automation** | Finish auto-capture (email forwarding) | Strongest Pro hook live |
| **3 — Depth/wow** | Receipt scan, net-worth, bill reminders, year-in-review | More upgrade drivers + AppSumo value |
| **4 — AppSumo channel** | Lifetime tier + code redemption + Web Billing; fair-use + bank-linking carve-out | Paid-acquisition channel opens |
| **5 — Future tier** | Bank/SMS linking (excluded from lifetime) | Higher-tier expansion |

**Approved now: Phase 0 + Phase 1 as one build.**

---

## 7. Phase 0+1 — implementation task list

**Foundation (0):**
1. DB migration: entitlement columns + monthly AI-counter reset logic.
2. `gemini-proxy` edge function: entitlement check + counter increment + `cap_reached` response.
3. RevenueCat: SDK install, configure entitlement ("pro"), products (monthly/annual), offering.
4. `useEntitlement()` hook + ProfileContext wiring + RevenueCat→DB webhook (edge function).
5. Paywall screen (Aurora design system) + `<ProGate>` component + upgrade CTAs at gates.
6. Free AI-cap UX: counter + soft paywall on `cap_reached`.

**Monetization launch (1):**
7. CSV / PDF export (transactions + monthly report) — Pro-gated.
8. Google Sheets sync: Google OAuth (Sheets scope) + sync edge function (one-way append). Pro-gated.
9. Apply `<ProGate>` to existing premium features (insights, email coach, Smart Budget, recurring, investments, multi-currency).

---

## 8. Prerequisites the founder must do (out-of-band)

- [ ] Create RevenueCat account + connect Play Console / App Store Connect.
- [ ] Create the IAP products in **Google Play Console** and **App Store Connect** ($9.99/mo, $79/yr) — RevenueCat references these by product ID.
- [ ] Start **Google OAuth app verification** for the Sheets scope (privacy policy already exists at heyfinni.com).
- [ ] Confirm legal: in-app purchase terms / restore-purchases flow (store requirement).

---

## 8b. Go-live switches (ship dormant, flip to enable)

Phase 0+1 ships **dormant** so it can't strand users before billing works:

- **`MONETIZATION_LIVE`** (`src/lib/entitlements.ts`, `false`) — while false, everyone
  is treated as Pro; no feature locks, but the paywall is reachable so **pricing is
  visible now** (the stated goal). Flip `true` to enforce gates.
- **`METERING_ENABLED`** (gemini-proxy env var, off) — proxy only counts AI actions
  when set to `'true'`. Deploying the function never caps users prematurely.

**Go-live checklist (flip both together):** RevenueCat wired (`PURCHASES_ENABLED`) →
entitlement migration applied in prod → set `METERING_ENABLED=true` on the edge
function → set `MONETIZATION_LIVE = true` → build.

### Build status (2026-06-19)
- ✅ Entitlement migration + `consume_ai_action` RPC
- ✅ gemini-proxy metering (402 cap, env-gated) + `AiCapError` → paywall
- ✅ ProfileContext entitlement read + `useEntitlement`
- ✅ Paywall screen + `ProGate`/`useRequirePro` + purchases.ts seam
- ✅ CSV/PDF export (Pro-gated) in Settings
- ✅ Dormant master switches
- ⬜ Apply gates to existing premium features (voice, Smart Budget, recurring,
  investments, insights, email coach) — dormant until `MONETIZATION_LIVE`; UX of the
  heavier ones (whole Investments tab, insights teaser) to confirm
- ⬜ Google Sheets sync — needs a Google Cloud OAuth client + scope verification
- ⬜ RevenueCat SDK install + purchase/restore + entitlement webhook — needs the
  RevenueCat account + store products

## 9. Margin protection (carry into Phase 4)

- Pro fair-use cap (500 AI actions/mo) even at lifetime — frame as "fair use," not stingy.
- **Bank/SMS linking is NOT included in any lifetime deal** — it carries a recurring per-user
  cost and must stay a separate future tier or paid add-on.
- AppSumo = customer acquisition, not profit (they take the majority of deal revenue).
