# Finni — AI-Powered Personal Finance Coach

> Your conversational finance companion. Log expenses, track goals, and get personalized AI insights — all through natural chat.

---

## Overview

Finni is an AI-first personal finance mobile app that lets users manage their finances through natural conversation. Instead of filling out forms, users simply say "Lunch $8.50" or "Uber 120 taka" and Finni automatically categorizes, logs, and analyzes their spending.

Built for an Android-first launch targeting Bangladesh and emerging markets.

---

## Features

- 💬 **Conversational expense logging** — log transactions in natural language
- 🧠 **AI category matching** — automatically maps expenses to categories with 70% similarity threshold
- 📊 **Analytics dashboard** — pie chart, monthly trends, spending breakdowns
- 🤖 **Personalized AI insights** — daily coaching based on income, goals, location, and spending patterns
- 💰 **Income tracking** — monthly, weekly, or annual income sources
- 🎯 **Goal setting** — savings, debt, investment, and custom goals
- 🌍 **Multi-currency support** — USD, BDT, EUR, GBP, AUD, CAD, SGD, INR
- 🚀 **Onboarding flow** — 3-step conversational onboarding
- ⚙️ **Settings** — categories, goals, income, profile, currency

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Mobile framework | React Native + Expo SDK 54 |
| Backend & Auth | Supabase (PostgreSQL + RLS) |
| AI | Google Gemini API (gemini-2.5-flash-lite) |
| Build system | EAS Build |
| Language | TypeScript |
| Navigation | React Navigation |

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
# Clone the repo
git clone https://github.com/MicroFinanace/finni-mobile-app-v2.git
cd finni-mobile-app-v2

# Install dependencies
npm install
```

### Environment Setup

Create a `.env` file at the project root:

```env
EXPO_PUBLIC_SUPABASE_URL=your_supabase_url
EXPO_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
```

Get these values from:
- Supabase: dashboard → Settings → Data API
- Gemini: aistudio.google.com → API Keys

### Run Locally

```bash
npx expo start --clear
# Press 'a' to open on Android emulator
```

---

## Building

```bash
# Preview APK (for testing)
eas build --platform android --profile preview

# Production AAB (for Google Play)
eas build --platform android --profile production
```

> EAS Secrets must be configured for `EXPO_PUBLIC_GEMINI_API_KEY` before building.
> Set with: `eas secret:create --scope project --name EXPO_PUBLIC_GEMINI_API_KEY --value your_key`

---

## Database Schema

| Table | Description |
|-------|-------------|
| `profiles` | User profile, currency, location, budget, onboarding status |
| `transactions` | All income and expense records |
| `categories` | User-defined spending categories with emoji and color |
| `income` | Income sources with frequency (monthly/weekly/annual) |
| `financial_goals` | Savings, debt, and investment goals |

All tables are protected by Supabase Row Level Security (RLS).

---

## Project Structure

```
finni-mobile-app/
├── src/
│   ├── screens/          # All app screens
│   │   ├── auth/         # LoginScreen, SignupScreen
│   │   ├── settings/     # CategoriesModal, GoalsModal, IncomeModal, CurrencyModal, EditProfileModal
│   │   ├── HomeScreen.tsx
│   │   ├── TransactionsScreen.tsx
│   │   ├── AnalyticsScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   └── OnboardingScreen.tsx
│   ├── contexts/         # React contexts
│   │   ├── AuthContext.tsx
│   │   └── ProfileContext.tsx
│   ├── lib/              # Core services
│   │   ├── agents.ts     # Gemini AI agents
│   │   ├── supabase.ts   # Supabase client
│   │   └── seedCategories.ts
│   └── navigation/       # App navigator
├── .env                  # Local env vars (gitignored)
├── eas.json              # EAS build config
├── app.json              # Expo config
└── README.md
```

---

## AI Architecture

Finni uses a multi-agent system powered by Gemini:

| Agent | Role |
|-------|------|
| **Agent 1 (chatAgent)** | Parses user messages, matches categories, logs transactions |
| **Agent 2 (getDailyInsights)** | Generates daily spending insights |
| **Agent 3 (getSavingsRecommendations)** | Weekly savings tips |

### Category Matching Logic
1. Fetch all user categories from Supabase
2. Score each against Gemini's returned category name
3. If best match ≥ 70% → use existing category
4. If best match < 70% → auto-create new category
5. Insert transaction with resolved UUID

---

## Security

- Supabase anon key is public by design — protected by RLS policies
- Gemini API key stored as EAS Secret — never committed to git
- All tables have RLS enabled — users can only access their own data
- No sensitive data logged in production

---

## Deployment

The app is deployed to Google Play Store under closed testing.

- **Package name:** `com.farhankabir1111.finni`
- **Target market:** Bangladesh (Android-first)
- **Min SDK:** Android API 34+

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
