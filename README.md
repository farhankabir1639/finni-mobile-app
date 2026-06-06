# Finni — AI-Powered Personal Finance Coach

> Your conversational finance companion. Log expenses, track goals, manage investments, and get personalized AI insights — all through natural chat.

![Version](https://img.shields.io/badge/version-1.0.0-brightgreen) ![Platform](https://img.shields.io/badge/platform-Android-blue) ![Build](https://img.shields.io/badge/build-production-success)

---

## Last Updated: June 5, 2026

### Recent Changes (for agents picking up this codebase)

**Design System:** The app uses the **Aurora design system** — a dark, glassmorphic theme with animated blobs, breathing Orb AI avatar, and frosted glass cards. All design tokens live in `src/theme/tokens.ts`. Font: Plus Jakarta Sans.

**UI Redesign Status (Phases 1-7 complete):**
- Phase 1: Design foundation — tokens, Aurora background, Orb, GlassDock nav, GlassCard, ArcMeter
- Phase 2: Auth screens — Orb hero, glass inputs, gradient CTA, Google Sign-In
- Phase 3: Home screen — ArcMeter budget gauge, glass chat bubbles, AI actions (thumbs/regen/report), composer with voice UI
- Phase 4: Transactions — vertical timeline, category picker sheet, spent/income summary
- Phase 5: Analytics/Insights — GlowDonut + TrendArea SVG charts, "Finni noticed" AI insights at top, chart-level insights
- Phase 6: Settings + all modals — gradient avatar, glass rows, Aurora-styled Categories/Goals/Income/Currency/EditProfile modals
- Phase 7: Investments — portfolio dashboard, allocation bar, holdings list, AI chat integration (INVESTMENT_DATA tag), manual CRUD

**Security hardening applied:**
- Sentry `beforeSend` sanitizes PII (email, tokens, userMessage)
- PostHog identify no longer sends email
- Rate limiting fails closed
- All `console.log` wrapped with `__DEV__` guards
- `.gitignore` blocks `*.keystore`
- Gemini proxy edge function created at `supabase/functions/gemini-proxy/` (not yet deployed — needs `supabase login` + `supabase functions deploy gemini-proxy --project-ref ntsisizkaitqdtcuchpk`)
- Client-side agents.ts uses proxy-first with legacy key fallback

**Known remaining items:**
- Deploy the Gemini proxy edge function — run `supabase login` then `supabase functions deploy gemini-proxy --project-ref ntsisizkaitqdtcuchpk`
- Rotate Gemini API key in Google Cloud Console (key was previously exposed client-side)
- Verify Supabase RLS is enabled on all tables (profiles, transactions, categories, financial_goals, income, investments)

**Completed items (June 5, 2026):**
- ✅ Removed `EXPO_PUBLIC_GEMINI_API_KEY` from `eas.json` (all 3 build profiles)
- ✅ Removed `react-native-chart-kit` from package.json
- ✅ OnboardingScreen migrated from old `colors` import to Aurora tokens (`t` from `src/theme/tokens`)
- ✅ `investments` table created with RLS policies in place

**Supabase project:** `ntsisizkaitqdtcuchpk.supabase.co`

---

## Overview

Finni is an AI-first personal finance mobile app that lets users manage their finances through natural conversation. Instead of filling out forms, users simply say "Lunch $8.50" or "Uber 120 taka" and Finni automatically categorizes, logs, and analyzes their spending.

Built for an Android-first launch targeting Bangladesh and emerging markets.

---

## Features

- 💬 **Conversational expense logging** — log transactions in natural language
- 📸 **Image-based transaction extraction** — photograph receipts to auto-extract transactions
- 🧠 **AI category matching** — automatically maps expenses to categories with 70% similarity threshold
- 📊 **Analytics dashboard** — glowing donut chart, trend area chart, spending breakdowns, AI chart insights
- 🤖 **Personalized AI insights** — daily coaching based on income, goals, location, and spending patterns
- 💰 **Income tracking** — monthly, weekly, or annual income sources
- 🎯 **Goal setting** — savings, debt, investment, and custom goals
- 📈 **Investment tracking** — manual portfolio with AI chat integration ("bought 10 shares of GP at 450")
- 🌍 **Multi-currency support** — USD, BDT, EUR, GBP, AUD, CAD, SGD, INR
- 🚀 **Onboarding flow** — 3-step conversational onboarding
- ⚙️ **Settings** — categories, goals, income, profile, currency
- 🔒 **Error monitoring** — Sentry integration with PII sanitization
- 📈 **Product analytics** — PostHog integration for usage insights

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile framework | React Native + Expo SDK 54 |
| Backend & Auth | Supabase (PostgreSQL + RLS) |
| AI | Google Gemini API (gemini-2.5-flash) |
| Design system | Aurora (dark glassmorphic, Plus Jakarta Sans) |
| Build system | EAS Build |
| Language | TypeScript |
| Navigation | React Navigation |
| Error tracking | Sentry (with PII sanitization) |
| Analytics | PostHog |

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn
- Expo CLI: `npm install -g expo-cli`
- EAS CLI: `npm install -g eas-cli`
- Android Studio (for emulator)

### Installation

```bash
git clone https://github.com/farhankabir1639/finni-mobile-app.git
cd finni-mobile-app
npm install
```

### Environment Setup

Create a `.env` file at the project root:

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
EXPO_PUBLIC_SENTRY_DSN=your_sentry_dsn
EXPO_PUBLIC_POSTHOG_API_KEY=your_posthog_key
```

- **Supabase:** dashboard → Settings → Data API
- **Gemini:** aistudio.google.com → API Keys
- **Sentry:** sentry.io → Project → Settings → Client Keys
- **PostHog:** app.posthog.com → Project → Settings

### Run Locally

```bash
npx expo start --clear
# Press 'a' to open on Android emulator
```

---

## Building

```bash
# Preview APK (internal testing)
eas build --platform android --profile preview

# Production AAB (Google Play)
eas build --platform android --profile production
```

The production profile uses `credentialsSource: local` — ensure `credentials.json` and the keystore file are present before building.

---

## Database Schema

| Table | Description |
|-------|-------------|
| `profiles` | User profile, currency, location, budget, onboarding status |
| `transactions` | All income and expense records |
| `categories` | User-defined spending categories with emoji and color |
| `income` | Income sources with frequency (monthly/weekly/annual) |
| `financial_goals` | Savings, debt, and investment goals |
| `investments` | Manual portfolio holdings (stock, crypto, mutual_fund, gold, other) |

All tables are protected by Supabase Row Level Security (RLS).

---

## Project Structure

```
finni-mobile-app/
├── src/
│   ├── screens/              # All app screens
│   │   ├── auth/             # LoginScreen, SignupScreen
│   │   ├── settings/         # CategoriesModal, GoalsModal, IncomeModal, CurrencyModal, EditProfileModal
│   │   ├── HomeScreen.tsx
│   │   ├── TransactionsScreen.tsx
│   │   ├── AnalyticsScreen.tsx
│   │   ├── InvestmentsScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   ├── SplashScreen.tsx
│   │   └── OnboardingScreen.tsx
│   ├── components/           # Reusable UI components
│   │   ├── Aurora.tsx        # 5-blob animated atmosphere background
│   │   ├── Orb.tsx           # Breathing AI avatar with sonar rings
│   │   ├── ArcMeter.tsx      # SVG circular budget gauge
│   │   ├── GlassDock.tsx     # Floating glass tab bar
│   │   ├── GlassCard.tsx     # BlurView card wrapper
│   │   ├── GlowDonut.tsx     # SVG donut chart with glow
│   │   ├── TrendArea.tsx     # SVG area chart with gradient
│   │   └── CategoryPickerSheet.tsx
│   ├── theme/
│   │   └── tokens.ts         # Aurora design system tokens (colors, spacing, radii, fonts)
│   ├── contexts/             # React contexts
│   │   ├── AuthContext.tsx
│   │   └── ProfileContext.tsx
│   ├── lib/                  # Core services
│   │   ├── agents.ts         # Gemini AI agents (chat, insights, savings, image, investments)
│   │   ├── supabase.ts       # Supabase client
│   │   ├── sentry.ts         # Error reporting with PII sanitization
│   │   ├── analytics.ts      # PostHog analytics
│   │   ├── googleAuth.ts     # Google OAuth flow
│   │   └── seedCategories.ts
│   └── navigation/           # App navigator + tab bar
├── supabase/
│   └── functions/
│       └── gemini-proxy/     # Edge function to proxy Gemini API (not yet deployed)
├── assets/                   # Icons, splash screen
├── .env                      # Local env vars (gitignored)
├── credentials.json          # Local keystore config (gitignored)
├── eas.json                  # EAS build config
├── app.json                  # Expo config
└── README.md
```

---

## AI Architecture

Finni uses a multi-agent system powered by Gemini:

| Agent | Role |
|-------|------|
| **chatAgent** | Parses user messages, matches categories, logs transactions and investments |
| **imageExtractionAgent** | Extracts transactions from receipt photos |
| **getDailyInsights** | Generates daily spending insights |
| **getSavingsRecommendations** | Weekly savings tips |

### Structured Data Tags (emitted by Gemini, parsed by agents.ts)

| Tag | Purpose |
|-----|---------|
| `TRANSACTION_DATA:{...}` | Log an expense or income |
| `INVESTMENT_DATA:{...}` | Log a buy/sell investment |
| `NEW_CATEGORY:{...}` | Create a new spending category |
| `GOAL_CREATE:{...}` | Create a financial goal |
| `GOAL_UPDATE:{...}` | Update goal progress |
| `CATEGORY_BUDGET:{...}` | Set a category budget |

### Category Matching Logic
1. Fetch all user categories from Supabase
2. Score each against Gemini's returned category name
3. If best match >= 70% → use existing category
4. If best match < 70% → auto-create new category
5. Insert transaction with resolved UUID

### Investment Logic
1. "bought 10 shares of GP at 450" → `INVESTMENT_DATA:{"name":"Grameenphone","ticker":"GP","asset_type":"stock","quantity":10,"buy_price":450,"action":"buy"}`
2. If holding exists → weighted average price update
3. If new → insert
4. Sell validates ownership (can't sell more than owned)

---

## Security

- Supabase anon key is public by design — protected by RLS policies
- Gemini API key: proxy edge function created (pending deployment), client uses proxy-first with legacy fallback
- All tables have RLS enabled — users can only access their own data
- Sentry `beforeSend` strips sensitive fields (email, tokens, userMessage, transactionData)
- PostHog identify sends user ID only — no email
- Rate limiting fails closed (returns "limit hit" on check failure)
- No sensitive data logged in production (`__DEV__` guards on all console statements)
- `.gitignore` blocks `*.keystore`, `*.jks`, `credentials.json`, `.env`

---

## Deployment

| Field | Value |
|-------|-------|
| Store | Google Play Store |
| Package | `com.finni.app` |
| Version | 1.0.0 (versionCode 7) |
| Target market | Bangladesh (Android-first) |
| Distribution | Production |
| Build type | AAB (Android App Bundle) |

---

## Team

| Name | Role |
|------|------|
| Farhan | Founder & Lead Developer |
| Towsif | Backend |
| Pranab | Frontend |
| Prionto | Frontend |
| Vishal | ML/AI |
| Chigozirim | Design |
| Mayank | Backend |

---

## License

© 2026 Finni AI. All rights reserved.
