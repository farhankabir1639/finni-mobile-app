import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

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

  const refreshProfile = useCallback(async () => {
    console.log('[ProfileContext] refreshProfile called, user.id =', user?.id);
    if (!user?.id) {
      setProfile(defaultProfile);
      setProfileLoading(false);
      return;
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('name, currency, onboarding_complete')
        .eq('id', user.id)
        .maybeSingle();
      console.log('[ProfileContext] fetched data:', data);
      console.log('[ProfileContext] onboarding_complete value:', (data as any)?.onboarding_complete);
      console.log('[ProfileContext] error:', error);
      if (data) {
        const nextProfile = {
          name: (data as any).name ?? null,
          currency: (data as any).currency ?? 'USD',
          location: null,
          monthlyBudget: 0,
          onboardingComplete: (data as any).onboarding_complete ?? true,
        };
        console.log('[ProfileContext] setting profile, onboardingComplete =', nextProfile.onboardingComplete);
        setProfile(nextProfile);
        console.log('[ProfileContext] profile state updated');
      } else {
        console.log('[ProfileContext] no data row found, setting onboardingComplete = false');
        setProfile({ ...defaultProfile, onboardingComplete: false });
      }
    } catch (e) {
      console.error('[ProfileContext] refreshProfile error:', e);
      setProfile({ ...defaultProfile, onboardingComplete: false });
    } finally {
      setProfileLoading(false);
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
