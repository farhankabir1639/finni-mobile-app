import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { supabase } from './supabase';

const DISMISSED_KEY = 'update_soft_dismissed_at';
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

export type UpdateStatus =
  | { type: 'up_to_date' }
  | { type: 'soft'; latestCode: number }
  | { type: 'force'; minCode: number };

export async function checkForUpdate(): Promise<UpdateStatus> {
  try {
    const { data, error } = await supabase
      .from('app_config')
      .select('android_latest_version_code, android_min_version_code')
      .eq('id', 1)
      .single();

    if (error || !data) return { type: 'up_to_date' };

    const currentCode: number = (Constants.expoConfig?.android?.versionCode as number | undefined) ?? 0;
    if (currentCode === 0) return { type: 'up_to_date' }; // Expo Go / dev

    if (currentCode < data.android_min_version_code) {
      return { type: 'force', minCode: data.android_min_version_code };
    }

    if (currentCode < data.android_latest_version_code) {
      const raw = await AsyncStorage.getItem(DISMISSED_KEY);
      if (raw && Date.now() - Number(raw) < COOLDOWN_MS) {
        return { type: 'up_to_date' };
      }
      return { type: 'soft', latestCode: data.android_latest_version_code };
    }

    return { type: 'up_to_date' };
  } catch {
    return { type: 'up_to_date' };
  }
}

export async function dismissSoftUpdate(): Promise<void> {
  await AsyncStorage.setItem(DISMISSED_KEY, String(Date.now()));
}
