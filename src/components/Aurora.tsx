import React from 'react';
import { View, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

interface AuroraProps {
  width: number;
  height: number;
}

export default function Aurora({ width, height }: AuroraProps) {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {/* Deep base — matches #07070E from design */}
      <LinearGradient
        colors={['#0e0c1e', '#08071a', '#07070e']}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
      />
      {/* Subtle violet haze at top-left — the only color in the prototype bg */}
      <LinearGradient
        colors={['rgba(99,60,180,0.13)', 'transparent']}
        style={[StyleSheet.absoluteFillObject, { height: height * 0.45 }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0.6, y: 1 }}
      />
    </View>
  );
}
