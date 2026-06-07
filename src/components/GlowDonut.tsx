import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { t, fonts } from '../theme/tokens';

type Slice = { name: string; pct: number; color: string };

interface GlowDonutProps {
  data: Slice[];
  size?: number;
  strokeWidth?: number;
  centerLabel?: string;
  centerSub?: string;
}

const GLOW_PAD = 10;

// Single tight inner glow — just enough to give vibrancy without bleeding
const GLOW_RINGS = [
  { extra: 3, opacity: 0.18 },
] as const;

// Gap between segments for clean separation
const SEG_GAP = 3;

export default function GlowDonut({
  data,
  size = 180,
  strokeWidth = 20,
  centerLabel,
  centerSub,
}: GlowDonutProps) {
  const canvasSize = size + GLOW_PAD * 2;
  const radius = (size - strokeWidth) / 2;
  const cx = canvasSize / 2;
  const cy = canvasSize / 2;
  const circumference = 2 * Math.PI * radius;

  let accumulated = 0;
  const arcs = data
    .filter((slice) => slice.pct > 0)
    .map((slice) => {
      const len = Math.max(0, (slice.pct / 100) * circumference - SEG_GAP);
      const offset = circumference - len;
      const rotation = -90 + (accumulated / 100) * 360;
      accumulated += slice.pct;
      return { ...slice, len, offset, rotation };
    });

  // Center hole insets within the canvas
  const holeInset = GLOW_PAD + strokeWidth + 4;

  return (
    <View style={[styles.container, { width: canvasSize, height: canvasSize }]}>
      <Svg width={canvasSize} height={canvasSize} style={StyleSheet.absoluteFill}>
        {/* Bloom rings — outermost to innermost */}
        {GLOW_RINGS.map(({ extra, opacity }, gi) =>
          arcs.map((arc, i) => (
            <Circle
              key={`g${gi}-${i}`}
              cx={cx}
              cy={cy}
              r={radius}
              stroke={arc.color}
              strokeWidth={strokeWidth + extra}
              fill="none"
              strokeDasharray={`${arc.len} ${circumference - arc.len}`}
              strokeDashoffset={arc.offset}
              rotation={arc.rotation}
              origin={`${cx}, ${cy}`}
              opacity={opacity}
              strokeLinecap="butt"
            />
          ))
        )}

        {/* Main donut */}
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

      {/* Center label — sits inside the donut hole */}
      <View
        style={[
          styles.center,
          {
            top: holeInset,
            left: holeInset,
            right: holeInset,
            bottom: holeInset,
            borderRadius: canvasSize,
          },
        ]}
      >
        {centerLabel && <Text style={styles.centerLabel}>{centerLabel}</Text>}
        {centerSub && <Text style={styles.centerSub}>{centerSub}</Text>}
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
