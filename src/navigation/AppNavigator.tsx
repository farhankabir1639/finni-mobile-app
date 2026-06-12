import React, { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../contexts/ProfileContext';
import MainTabs from './MainTabs';
import LoginScreen from '../screens/auth/LoginScreen';
import SignupScreen from '../screens/auth/SignupScreen';
import OnboardingScreen from '../screens/OnboardingScreen';
import SplashScreen from '../screens/SplashScreen';
import UpdatePrompt from '../components/UpdatePrompt';
import { checkForUpdate, dismissSoftUpdate, type UpdateStatus } from '../lib/updateCheck';
import { registerForPushNotifications, updateLastActive } from '../lib/notifications';

const Stack = createStackNavigator();

export default function AppNavigator() {
  const { user, loading: authLoading } = useAuth();
  const { profile, profileLoading } = useProfile();
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ type: 'up_to_date' });

  // Check for app update once on mount
  useEffect(() => {
    checkForUpdate().then(setUpdateStatus);
  }, []);

  // Register push token + seed last_active_at when user logs in
  useEffect(() => {
    if (!user?.id) return;
    registerForPushNotifications(user.id);
    updateLastActive(user.id);
  }, [user?.id]);

  // Keep last_active_at fresh whenever the app comes to the foreground
  useEffect(() => {
    if (!user?.id) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') updateLastActive(user.id!);
    });
    return () => sub.remove();
  }, [user?.id]);

  if (authLoading || (user && profileLoading)) {
    return <SplashScreen />;
  }

  return (
    <>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {user ? (
          profile?.onboardingComplete ? (
            <Stack.Screen name="MainTabs" component={MainTabs} />
          ) : (
            <Stack.Screen name="Onboarding" component={OnboardingScreen} />
          )
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Signup" component={SignupScreen} />
          </>
        )}
      </Stack.Navigator>

      {/* Update prompt — rendered above everything */}
      {updateStatus.type === 'force' && (
        <UpdatePrompt type="force" />
      )}
      {updateStatus.type === 'soft' && (
        <UpdatePrompt
          type="soft"
          onDismiss={async () => {
            await dismissSoftUpdate();
            setUpdateStatus({ type: 'up_to_date' });
          }}
        />
      )}
    </>
  );
}
