import React from 'react';
import { View, StyleSheet, Platform, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { t } from '../theme/tokens';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  intensity?: number;
  borderRadius?: number;
  borderColor?: string;
}

export default function GlassCard({
  children,
  style,
  intensity = 28,
  borderRadius = t.rXl,
  borderColor = t.glassLine,
}: GlassCardProps) {
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={intensity}
        tint="dark"
        style={[
          styles.base,
          { borderRadius, borderColor },
          style,
        ]}
      >
        {children}
      </BlurView>
    );
  }

  // Android fallback — semi-transparent surface
  return (
    <View
      style={[
        styles.base,
        styles.androidCard,
        { borderRadius, borderColor },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    borderWidth: 1,
  },
  androidCard: {
    backgroundColor: 'rgba(13,19,34,0.82)',
  },
});
