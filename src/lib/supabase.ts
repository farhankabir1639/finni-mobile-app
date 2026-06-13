import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Treat empty / whitespace-only values as missing. A blank env var (e.g. an
// unset EAS variable that resolves to "") would otherwise slip past `??` and
// crash createClient with "Invalid supabaseUrl" before the JS runtime is ready.
const clean = (v: string | undefined): string | undefined => {
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
};

export const supabaseUrl = clean(process.env.EXPO_PUBLIC_SUPABASE_URL);
const supabaseAnonKey = clean(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

if (!supabaseUrl || !supabaseAnonKey) {
  // Surfaces in Sentry/logcat instead of a native SIGABRT on a blank config.
  console.error('[Supabase] Missing or empty env vars — using placeholder client:', {
    url: !!supabaseUrl,
    key: !!supabaseAnonKey,
  });
}

export const supabase = createClient(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);
