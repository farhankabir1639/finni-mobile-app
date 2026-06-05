import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

WebBrowser.maybeCompleteAuthSession();

const REDIRECT_URL = 'finni-app://auth/callback';

const parseParams = (str: string): Record<string, string> => {
  const out: Record<string, string> = {};
  str.split('&').forEach(pair => {
    const eq = pair.indexOf('=');
    if (eq < 0) return;
    const key = decodeURIComponent(pair.slice(0, eq));
    const val = decodeURIComponent(pair.slice(eq + 1));
    if (key) out[key] = val;
  });
  return out;
};

async function handleRedirectUrl(url: string): Promise<{ error: Error | null }> {
  const [, afterHash] = url.split('#');
  const [, afterQuery] = url.split('?');
  const hashParams = parseParams(afterHash ?? '');
  const queryParams = parseParams((afterQuery ?? '').split('#')[0]);
  const combined = { ...queryParams, ...hashParams };

  if (combined.access_token && combined.refresh_token) {
    const { error } = await supabase.auth.setSession({
      access_token: combined.access_token,
      refresh_token: combined.refresh_token,
    });
    return { error: error as Error | null };
  }

  if (combined.code) {
    const { error } = await supabase.auth.exchangeCodeForSession(combined.code);
    return { error: error as Error | null };
  }

  return { error: new Error('No authentication tokens received') };
}

export async function signInWithGoogle(): Promise<{ error: Error | null }> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: REDIRECT_URL,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    return { error: error ?? new Error('Could not get Google sign-in URL') };
  }

  // Race: browser session vs Linking deep link (fallback for Expo Go)
  return new Promise((resolve) => {
    let settled = false;

    const settle = (result: { error: Error | null }) => {
      if (settled) return;
      settled = true;
      linkingSub.remove();
      resolve(result);
    };

    // Linking listener catches the deep link in Expo Go where
    // openAuthSessionAsync may not intercept the custom scheme redirect
    const linkingSub = Linking.addEventListener('url', async ({ url }) => {
      if (!url.startsWith(REDIRECT_URL)) return;
      WebBrowser.dismissBrowser();
      settle(await handleRedirectUrl(url));
    });

    WebBrowser.openAuthSessionAsync(data.url, REDIRECT_URL)
      .then(async (result) => {
        if (result.type === 'cancel' || result.type === 'dismiss') {
          settle({ error: null });
          return;
        }
        if (result.type !== 'success') {
          settle({ error: new Error('Authentication was not completed') });
          return;
        }
        settle(await handleRedirectUrl(result.url));
      })
      .catch((err) => {
        settle({ error: err instanceof Error ? err : new Error(String(err)) });
      });
  });
}
