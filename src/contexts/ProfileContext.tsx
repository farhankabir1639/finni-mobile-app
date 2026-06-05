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
      const { data, error } = await supabase
        .from('profiles')
        .select('name, currency, onboarding_complete')
        .eq('id', user.id)
        .maybeSingle();
      if (data) {
        setProfile({
          name: (data as any).name ?? null,
          currency: (data as any).currency ?? 'USD',
          location: null,
          monthlyBudget: 0,
          onboardingComplete: (data as any).onboarding_complete ?? true,
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
