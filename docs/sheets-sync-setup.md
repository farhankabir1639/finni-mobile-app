# Google Sheets Sync — setup (to flip `SHEETS_SYNC_ENABLED`)

Status: **code scaffolded 2026-06-19, gated off.** One-way "Sync now": Finni →
a `Finni Transactions` Google Sheet the user owns. Implicit OAuth (no client
secret), `drive.file` scope (Finni only touches sheets it created). Code:
`src/lib/sheetsSync.ts` + a gated Settings row. Background/auto sync is a later
phase (needs refresh tokens + a server-side job).

## What you need to set up

1. **Google Cloud Console** → create/select a project.
2. **Enable APIs:** Google Sheets API **and** Google Drive API.
3. **OAuth consent screen:** External. Add scope
   `https://www.googleapis.com/auth/drive.file`. While testing, add your account
   as a **Test user** (no verification needed for testers). For public release,
   Google **verification** of the scope is required and can take days — start early.
4. **Create OAuth client credentials.** With Expo's implicit flow + custom-scheme
   redirect, the registered **redirect URI must match** what the app generates:
   `AuthSession.makeRedirectUri({ scheme: 'finni-app', path: 'sheets/callback' })`
   → typically `finni-app://sheets/callback`. Create the client (Android client:
   package `com.finni.app` + your EAS SHA-1; and/or a Web client) and add that
   redirect URI. Run the app once and log the `redirectUri` to confirm the exact
   string, then register it verbatim.
5. **Env var:** set `EXPO_PUBLIC_GOOGLE_SHEETS_CLIENT_ID=<client id>` in `.env`
   **and recreate it in the EAS build environment** (EAS env vars don't carry over
   — past prod builds shipped blank because of this).
6. **Flip the flag:** `SHEETS_SYNC_ENABLED = true` in `src/lib/featureFlags.ts`.
7. **Build + test:** Settings → "Sync to Google Sheets" (Pro) → Google consent →
   a `Finni Transactions` sheet is created and filled; tapping again refreshes it.

## Notes
- `src/lib/sheetsSync.ts` reads `EXPO_PUBLIC_GOOGLE_SHEETS_CLIENT_ID`; if unset,
  `SHEETS_CONFIGURED` is false and sync returns `not_configured` (so a half-built
  build never errors).
- It stores the created `spreadsheetId` per user in AsyncStorage and **clears +
  rewrites** the sheet each sync, so deleted/edited transactions don't leave stale
  rows.
- The Settings row is Pro-gated via the paywall (feature `sheets_sync`) and only
  renders when `SHEETS_SYNC_ENABLED` is true.
