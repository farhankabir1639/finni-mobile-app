import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';
import { captureError } from '../lib/sentry';

export const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US Dollar' },
  { code: 'BDT', symbol: '৳', name: 'Bangladeshi Taka' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British Pound' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar' },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee' },
];

const CURRENCY_SYMBOL_MAP: Record<string, string> = Object.fromEntries(
  CURRENCIES.map((c) => [c.code, c.symbol])
);

export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOL_MAP[code] ?? code;
}

type ProfileData = {
  name: string | null;
  currency: string;
  location: string | null;
  monthlyBudget: number;
  onboardingComplete: boolean;
  plan: 'free' | 'pro';
  planExpiresAt: string | null;
  aiActionsUsed: number;
};

type ProfileContextType = {
  profile: ProfileData;
  currencySymbol: string;
  profileLoading: boolean;
  refreshProfile: () => Promise<void>;
};

const defaultProfile: ProfileData = {
  name: null,
  currency: 'USD',
  location: null,
  monthlyBudget: 0,
  onboardingComplete: false,
  plan: 'free',
  planExpiresAt: null,
  aiActionsUsed: 0,
};

const ProfileContext = createContext<ProfileContextType>({
  profile: defaultProfile,
  currencySymbol: '$',
  profileLoading: true,
  refreshProfile: async () => {},
});

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<ProfileData>(defaultProfile);
  const [profileLoading, setProfileLoading] = useState(true);
  const isFetchingRef = React.useRef(false);

  const refreshProfile = useCallback(async () => {
    if (!user?.id) {
      setProfile(defaultProfile);
      setProfileLoading(false);
      return;
    }
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      // Try with entitlement columns; if the migration hasn't been applied yet
      // (PostgREST 42703), fall back to the core columns so existing users are
      // never wrongly bounced into onboarding.
      type ProfileRow = {
        name?: string | null; currency?: string; onboarding_complete?: boolean;
        plan?: string | null; plan_expires_at?: string | null; ai_actions_used?: number | null;
      };
      let row: ProfileRow | null = null;
      const res = await supabase
        .from('profiles')
        .select('name, currency, onboarding_complete, plan, plan_expires_at, ai_actions_used')
        .eq('id', user.id)
        .maybeSingle();
      if (res.error) {
        const fallback = await supabase
          .from('profiles')
          .select('name, currency, onboarding_complete')
          .eq('id', user.id)
          .maybeSingle();
        row = fallback.data as ProfileRow | null;
      } else {
        row = res.data as ProfileRow | null;
      }
      if (row) {
        setProfile({
          name: row.name ?? null,
          currency: row.currency ?? 'USD',
          location: null,
          monthlyBudget: 0,
          onboardingComplete: row.onboarding_complete ?? true,
          plan: row.plan === 'pro' ? 'pro' : 'free',
          planExpiresAt: row.plan_expires_at ?? null,
          aiActionsUsed: row.ai_actions_used ?? 0,
        });
      } else {
        setProfile({ ...defaultProfile, onboardingComplete: false });
      }
    } catch (e) {
      if (__DEV__) console.error('[ProfileContext] refreshProfile error:', e);
      captureError(e, { context: 'refreshProfile', userId: user?.id });
      setProfile({ ...defaultProfile, onboardingComplete: false });
    } finally {
      setProfileLoading(false);
      isFetchingRef.current = false;
    }
  }, [user?.id]);

  useEffect(() => {
    setProfileLoading(true);
    refreshProfile();
  }, [refreshProfile]);

  const currencySymbol = getCurrencySymbol(profile.currency);

  return (
    <ProfileContext.Provider value={{ profile, currencySymbol, profileLoading, refreshProfile }}>
      {children}
    </ProfileContext.Provider>
  );
}

export function useProfile() {
  return useContext(ProfileContext);
}
