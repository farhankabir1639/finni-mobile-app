import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Path, Circle } from 'react-native-svg';
import { fonts } from '../theme/tokens';

interface Props {
  size?: number;
  showWordmark?: boolean;
  wordmarkSize?: number;
}

export default function FinniLogo({ size = 40, showWordmark = true, wordmarkSize = 22 }: Props) {
  const iconSize = size * 0.6;
  const borderRadius = size * 0.32;

  return (
    <View style={styles.row}>
      <LinearGradient
        colors={['#9D85FF', '#7C5CFC', '#3FE0C0']}
        locations={[0, 0.42, 1]}
        start={{ x: 0.09, y: 0.21 }}
        end={{ x: 0.91, y: 0.79 }}
        style={[styles.mark, { width: size, height: size, borderRadius }]}
      >
        <Svg width={iconSize} height={iconSize} viewBox="0 0 24 24">
          {/* Chat bubble */}
          <Path
            d="M4 6.4C4 5.07 5.07 4 6.4 4h11.2C18.93 4 20 5.07 20 6.4v8.5c0 1.32-1.07 2.4-2.4 2.4H9.7L5.6 20.6a.8.8 0 0 1-1.3-.62V6.4Z"
            fill="rgba(255,255,255,0.95)"
          />
          {/* Trend line */}
          <Path
            d="M8 13.2l2.7-2.9 2 1.9 3.1-3.6"
            stroke="#7C5CFC"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Teal dot */}
          <Circle cx={16.4} cy={8.4} r={1.15} fill="#3FE0C0" />
        </Svg>
      </LinearGradient>

      {showWordmark && (
        <Text style={[styles.wordmark, { fontSize: wordmarkSize, letterSpacing: -0.03 * wordmarkSize }]}>
          finni
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#7C5CFC',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 18,
    elevation: 12,
  },
  wordmark: {
    fontFamily: fonts.extraBold,
    color: '#FFFFFF',
  },
});
