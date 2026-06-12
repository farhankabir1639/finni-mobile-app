import { Platform } from 'react-native';
import { supabase } from './supabase';

// expo-notifications is a native module — guard every call so the app
// doesn't crash in Expo Go or on builds that predate the module addition.
async function getNotificationsModule() {
  try {
    const mod = await import('expo-notifications');
    return mod;
  } catch {
    return null;
  }
}

export async function registerForPushNotifications(userId: string): Promise<void> {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return;
  const Notifications = await getNotificationsModule();
  if (!Notifications) return;

  try {
    // Cast to any: PermissionResponse shape differs across expo package versions
    const existing = await Notifications.getPermissionsAsync() as any;
    let isGranted: boolean = existing.granted ?? existing.status === 'granted';

    if (!isGranted) {
      const result = await Notifications.requestPermissionsAsync() as any;
      isGranted = result.granted ?? result.status === 'granted';
    }

    if (!isGranted) return;

    const tokenData = await Notifications.getExpoPushTokenAsync({
      projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    });

    await supabase
      .from('profiles')
      .update({ push_token: tokenData.data })
      .eq('id', userId);
  } catch (e) {
    if (__DEV__) console.warn('[Notifications] registerForPushNotifications failed:', e);
  }
}

export async function clearPushToken(userId: string): Promise<void> {
  try {
    await supabase
      .from('profiles')
      .update({ push_token: null })
      .eq('id', userId);
  } catch {}
}

export async function updateLastActive(userId: string): Promise<void> {
  try {
    await supabase
      .from('profiles')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', userId);
  } catch {}
}
