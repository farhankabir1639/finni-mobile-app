import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop } from 'react-native-svg';
import { t } from '../theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface ArcMeterProps {
  pct: number;       // 0-100 — how much of budget is spent (the arc fill)
  markerPct?: number; // 0-100 — how far through the month (white dot)
  size?: number;
  stroke?: number;
  children?: React.ReactNode;
  gradientStart?: string;
  gradientEnd?: string;
}

const SWEEP = 0.72; // 259° of a full circle

export default function ArcMeter({
  pct,
  markerPct,
  size = 220,
  stroke = 13,
  children,
  gradientStart = t.auraAqua,
  gradientEnd = t.auraIndigo,
}: ArcMeterProps) {
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const trackLen = circumference * SWEEP;

  // Animated arc progress
  const animPct = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(animPct, {
      toValue: Math.min(100, pct),
      duration: 1300,
      useNativeDriver: false,
    }).start();
  }, [pct]);

  const strokeDashoffset = animPct.interpolate({
    inputRange: [0, 100],
    outputRange: [trackLen, 0],
    extrapolate: 'clamp',
  });

  // Marker position along the arc
  const markerOffset = markerPct != null
    ? trackLen * Math.min(100, markerPct) / 100
    : null;

  // SVG is rotated 129° so the arc gap sits at the bottom
  return (
    <View style={{ width: size, height: size }}>
      <Svg
        width={size}
        height={size}
        style={{ transform: [{ rotate: '129deg' }] }}
      >
        <Defs>
          <SvgGradient id="arc-grad" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0%" stopColor={gradientStart} stopOpacity={1} />
            <Stop offset="100%" stopColor={gradientEnd} stopOpacity={1} />
          </SvgGradient>
        </Defs>

        {/* track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${trackLen} ${circumference}`}
        />

        {/* progress arc */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="url(#arc-grad)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${trackLen} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
        />

        {/* time-of-month marker */}
        {markerOffset != null && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="#ffffff"
            strokeWidth={stroke + 6}
            strokeLinecap="round"
            strokeDasharray={`3 ${circumference}`}
            strokeDashoffset={-markerOffset}
            opacity={0.95}
          />
        )}
      </Svg>

      {/* centred children (e.g. Orb + numbers) */}
      <View style={[StyleSheet.absoluteFillObject, styles.center]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
