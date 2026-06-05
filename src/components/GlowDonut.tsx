import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { t, fonts } from '../theme/tokens';

type Slice = { name: string; pct: number; color: string };

interface GlowDonutProps {
  data: Slice[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerSub?: string;
}

export default function GlowDonut({
  data,
  size = 180,
  strokeWidth = 22,
  centerLabel,
  centerSub,
}: GlowDonutProps) {
  const radius = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  // Build arcs — each slice is a separate Circle with dasharray/dashoffset
  let accumulated = 0;
  const arcs = data.map((slice) => {
    const len = (slice.pct / 100) * circumference;
    const offset = circumference - len;
    // rotation: start from -90° (top), add accumulated %
    const rotation = -90 + (accumulated / 100) * 360;
    accumulated += slice.pct;
    return { ...slice, len, offset, rotation };
  });

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {/* Glow layer — blurred version of the donut behind */}
      <View
        style={[
          styles.glow,
          {
            top: -14,
            left: -14,
            right: -14,
            bottom: -14,
            borderRadius: size,
            opacity: 0.4,
          },
        ]}
      >
        <Svg width={size + 28} height={size + 28}>
          {arcs.map((arc, i) => (
            <Circle
              key={i}
              cx={cx + 14}
              cy={cy + 14}
              r={radius}
              stroke={arc.color}
              strokeWidth={strokeWidth + 8}
              fill="none"
              strokeDasharray={`${arc.len} ${circumference - arc.len}`}
              strokeDashoffset={arc.offset}
              rotation={arc.rotation}
              origin={`${cx + 14}, ${cy + 14}`}
              strokeLinecap="butt"
            />
          ))}
        </Svg>
      </View>

      {/* Main donut */}
      <Svg width={size} height={size}>
        {arcs.map((arc, i) => (
          <Circle
            key={i}
            cx={cx}
            cy={cy}
            r={radius}
            stroke={arc.color}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${arc.len} ${circumference - arc.len}`}
            strokeDashoffset={arc.offset}
            rotation={arc.rotation}
            origin={`${cx}, ${cy}`}
            strokeLinecap="butt"
          />
        ))}
      </Svg>

      {/* Center text */}
      <View style={[styles.center, { top: strokeWidth + 4, left: strokeWidth + 4, right: strokeWidth + 4, bottom: strokeWidth + 4, borderRadius: size }]}>
        {centerLabel && (
          <Text style={styles.centerLabel}>{centerLabel}</Text>
        )}
        {centerSub && (
          <Text style={styles.centerSub}>{centerSub}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
  },
  center: {
    position: 'absolute',
    backgroundColor: 'rgba(12,11,22,0.82)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerLabel: {
    fontSize: 22,
    fontFamily: fonts.extraBold,
    fontWeight: '800',
    color: t.text,
    letterSpacing: -0.5,
  },
  centerSub: {
    fontSize: 10.5,
    fontFamily: fonts.medium,
    color: t.text3,
    marginTop: 3,
  },
});
