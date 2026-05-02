```
███████╗██╗███╗   ██╗███╗   ██╗██╗
██╔════╝██║████╗  ██║████╗  ██║██║
█████╗  ██║██╔██╗ ██║██╔██╗ ██║██║
██╔══╝  ██║██║╚██╗██║██║╚██╗██║██║
██║     ██║██║ ╚████║██║ ╚████║██║
╚═╝     ╚═╝╚═╝  ╚═══╝╚═╝  ╚═══╝╚═╝
```

### AI-powered personal finance coach for your pocket

![Platform](https://img.shields.io/badge/Platform-Android-3DDC84?logo=android&logoColor=white)
![Expo](https://img.shields.io/badge/Built%20with-Expo%20SDK%2054-000020?logo=expo&logoColor=white)
![Supabase](https://img.shields.io/badge/Database-Supabase-3ECF8E?logo=supabase&logoColor=white)
![Gemini](https://img.shields.io/badge/AI-Gemini%202.5%20Flash-4285F4?logo=google&logoColor=white)

---

## Overview

Finni is a conversational AI finance coach built for people who want to take control of their money without the friction of traditional budgeting apps. Instead of manually tapping through menus and spreadsheets, you simply tell Finni what you spent — and it handles everything automatically.

**Who it's for:** Anyone who wants real-time insight into their finances without the overhead of manual bookkeeping. Finni is especially useful for individuals tracking variable income, managing multiple spending categories, or working toward savings goals.

**Core value proposition:**
- **Talk to log** — Type "Spent $12 on lunch" and Finni categorizes and records it instantly
- **AI that knows you** — Insights are personalized to your income, location, currency, and goals
- **Always up to date** — Spending stats, analytics, and AI summaries refresh automatically

---

## Features

### Conversational Expense Logging
Chat with Finni in natural language. Say "paid $45 for groceries" or "got $500 freelance payment" and Finni parses the intent, amount, type, and category — then saves it directly to your history.

### Smart Category Matching & Auto-Creation
Finni uses semantic similarity scoring to match transactions to your existing categories. If no strong match is found, it proposes and creates a new category automatically with an appropriate emoji — no manual setup needed.

### Analytics & Spending Trends
Visual pie charts and category breakdowns for any time period (week, month, 3 months, year). See exactly where your money goes, with progress bars for each category against its budget.

### AI-Powered Daily Insights
Each day, Finni generates 3–4 personalized insights based on your actual transaction history, income sources, financial goals, and location. Insight types include:
- **Warning** — Unusual spending detected
- **Tip** — Actionable saving suggestion
- **Goal** — Progress update toward a financial goal
- **Income Alert** — Triggered when spending exceeds 80% of monthly income

### Income Tracking
Record multiple income sources with flexible frequency (monthly, weekly, or annual). Finni normalizes everything to a monthly equivalent for budget calculations.

### Goal Setting & Progress Tracking
Set financial goals — saving, buying a home, education, travel, debt repayment, or custom — with target amounts and deadlines. Finni tracks progress and references goals in AI insights.

### Multi-Currency Support
Supports USD, BDT, EUR, GBP, INR, AUD, CAD, and SGD. Currency is set during onboarding and can be changed in Settings at any time.

### Onboarding Flow
New users are guided through a 3-step onboarding flow: profile setup (name, location, currency), financial setup (income and budget), and goal selection. Default spending categories are seeded automatically on completion.

### Settings & Profile Management
Full control over your account from Settings:
- Edit profile (name, location, budget)
- Manage and edit spending categories (name, emoji, color, budget)
- Add, view, and manage income sources
- Create and track financial goals
- Switch currency

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo SDK 54 |
| Language | TypeScript |
| Backend & Auth | Supabase (PostgreSQL + Row Level Security) |
| AI | Google Gemini 2.5 Flash Lite |
| Navigation | React Navigation 7 (Stack + Bottom Tabs) |
| Local Cache | AsyncStorage (AI insight and savings cache) |
| Build & Distribution | EAS Build (Expo Application Services) |

---

## Getting Started

### Prerequisites

- **Node.js** 18 or higher
- **Expo CLI** — `npm install -g expo-cli`
- **EAS CLI** (for builds) — `npm install -g eas-cli`
- A **Supabase** project (free tier works)
- A **Google AI Studio** API key with Gemini access

### Clone & Install

```bash
git clone https://github.com/farhankabir1639/finni-mobile-app.git
cd finni-mobile-app
npm install
```

### Environment Setup

Create a `.env` file in the root of the project. This file is gitignored and must never be committed.

```env
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_ANON_KEY=
EXPO_PUBLIC_GEMINI_API_KEY=
```

| Variable | Where to find it |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → `anon` `public` key |
| `EXPO_PUBLIC_GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com) → Get API Key |

### Run Locally

```bash
npx expo start
```

Scan the QR code with the **Expo Go** app on your phone, or press `a` to open an Android emulator.

---

## Building

Finni uses **EAS Build** for Android distribution. Before running any build, you must register your environment variables as EAS Secrets so they are injected securely at build time — never stored in `eas.json`.

### Register EAS Secrets (one-time setup)

```bash
eas secret:create --name EXPO_PUBLIC_SUPABASE_URL --value "your_value"
eas secret:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "your_value"
eas secret:create --name EXPO_PUBLIC_GEMINI_API_KEY --value "your_value"
```

### Preview APK (internal testing)

```bash
eas build --platform android --profile preview
```

Produces a `.apk` file that can be side-loaded on any Android device. Useful for sharing with testers.

### Production AAB (Play Store)

```bash
eas build --platform android --profile production
```

Produces a signed `.aab` bundle ready for submission to Google Play.

---

## Project Structure

```
finni-mobile-app/
├── App.tsx                   # Root component, providers, error boundary
├── src/
│   ├── screens/              # All app screens
│   │   ├── auth/             # LoginScreen, SignupScreen
│   │   ├── HomeScreen.tsx    # Dashboard + AI chat
│   │   ├── TransactionsScreen.tsx
│   │   ├── AnalyticsScreen.tsx
│   │   ├── SettingsScreen.tsx
│   │   ├── OnboardingScreen.tsx
│   │   └── InvestmentsScreen.tsx
│   ├── contexts/
│   │   ├── AuthContext.tsx   # Supabase auth state
│   │   └── ProfileContext.tsx # User profile, currency, onboarding state
│   ├── lib/
│   │   ├── agents.ts         # All Gemini AI agents (chat, insights, savings)
│   │   ├── supabase.ts       # Supabase client initialization
│   │   ├── seedCategories.ts # Default category seeding for new users
│   │   └── theme.ts          # App-wide color palette
│   └── navigation/
│       ├── AppNavigator.tsx  # Root stack (auth gate + onboarding gate)
│       └── MainTabs.tsx      # Bottom tab navigator
├── .env                      # Local secrets (gitignored — never commit)
├── eas.json                  # EAS build config (uses $VAR references, no raw keys)
└── app.json                  # Expo app config
```

---

## Database Schema

All tables are hosted on Supabase (PostgreSQL) with Row Level Security (RLS) enabled. Every table is scoped to the authenticated user.

| Table | Description |
|---|---|
| `profiles` | User profile data: name, currency, location, monthly budget, onboarding status |
| `transactions` | Every expense and income record: amount, description, category, date, type, AI matching score |
| `categories` | User-defined spending categories: name, emoji, color, budget amount, budget period |
| `income` | Income sources with label, amount, and frequency (monthly / weekly / annual) |
| `financial_goals` | Savings and financial goals: name, type, target amount, current progress, deadline, status |

### Required Migration

If you are setting up a fresh Supabase project, run the following to add the onboarding gate column:

```sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean DEFAULT false;

UPDATE profiles
  SET onboarding_complete = true
  WHERE onboarding_complete IS NULL;
```

---

## Team

| Name | Role |
|---|---|
| — | Add your team members here |

---

## License

© 2025 Finni AI. All rights reserved.

This codebase is proprietary and confidential. Unauthorized copying, distribution, or use of this software, in whole or in part, is strictly prohibited.

---

<p align="center">Built with care by the Finni team</p>
