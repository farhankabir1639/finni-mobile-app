import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  Defs,
  Filter,
  FeGaussianBlur,
  Circle,
  RadialGradient,
  LinearGradient as SvgGradient,
  Stop,
  Rect,
} from 'react-native-svg';

// Matches design exactly: position = top-left edge as % of screen, size in px
const BLOBS = [
  { color: '#8B5CF6', size: 460, tPct: -0.12, lPct: -0.18, opacity: 0.50 },
  { color: '#6366F1', size: 520, tPct:  0.18, lPct:  0.52, opacity: 0.50 },
  { color: '#5EEAD4', size: 360, tPct:  0.54, lPct: -0.14, opacity: 0.32 },
  { color: '#FB7185', size: 320, tPct:  0.68, lPct:  0.58, opacity: 0.28 },
  { color: '#60A5FA', size: 300, tPct:  0.40, lPct:  0.22, opacity: 0.30 },
];

// Star positions from design (fine star dust)
const STARS = [
  { t: 0.30, l: 0.20, o: 0.5 },
  { t: 0.20, l: 0.70, o: 0.5 },
  { t: 0.70, l: 0.40, o: 0.5 },
  { t: 0.60, l: 0.85, o: 0.4 },
  { t: 0.45, l: 0.55, o: 0.4 },
  { t: 0.80, l: 0.15, o: 0.4 },
  { t: 0.12, l: 0.45, o: 0.35 },
  { t: 0.55, l: 0.28, o: 0.35 },
];

interface AuroraProps {
  width: number;
  height: number;
}

export default function Aurora({ width, height }: AuroraProps) {
  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          {/* Base radial gradient — design: radial-gradient(120% 90% at 50% -10%, #0d0d1c 0%, #07070E 55%, #050509 100%) */}
          <RadialGradient id="base" cx="50%" cy="-10%" r="120%" fx="50%" fy="-10%">
            <Stop offset="0"    stopColor="#0d0d1c" stopOpacity="1" />
            <Stop offset="0.55" stopColor="#07070E" stopOpacity="1" />
            <Stop offset="1"    stopColor="#050509" stopOpacity="1" />
          </RadialGradient>

          {/* Shared Gaussian blur — matches design's filter:blur(34px) */}
          <Filter id="blur" x="-60%" y="-60%" width="220%" height="220%">
            <FeGaussianBlur stdDeviation="34" />
          </Filter>

          {/* Per-blob radial gradient fills */}
          {BLOBS.map((b, i) => (
            <RadialGradient key={i} id={`bg${i}`} cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <Stop offset="0"    stopColor={b.color} stopOpacity="1" />
              <Stop offset="0.66" stopColor={b.color} stopOpacity="0" />
            </RadialGradient>
          ))}

          {/* Grain veil gradient — design: linear-gradient(180deg, rgba(7,7,14,.18), rgba(7,7,14,.5)) */}
          <SvgGradient id="veil" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#07070E" stopOpacity="0.18" />
            <Stop offset="1" stopColor="#07070E" stopOpacity="0.50" />
          </SvgGradient>
        </Defs>

        {/* Background */}
        <Rect width={width} height={height} fill="url(#base)" />

        {/* Blobs — each positioned by top-left edge % → center = edge + size/2 */}
        {BLOBS.map((b, i) => (
          <Circle
            key={i}
            cx={width  * b.lPct + b.size / 2}
            cy={height * b.tPct + b.size / 2}
            r={b.size / 2}
            fill={`url(#bg${i})`}
            opacity={b.opacity}
            filter="url(#blur)"
          />
        ))}

        {/* Star dust */}
        {STARS.map((s, i) => (
          <Circle key={`s${i}`} cx={s.l * width} cy={s.t * height} r={1} fill="#fff" opacity={s.o} />
        ))}

        {/* Grain veil */}
        <Rect width={width} height={height} fill="url(#veil)" />
      </Svg>
    </View>
  );
}
