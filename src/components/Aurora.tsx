import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { t } from '../theme/tokens';

interface BlobConfig {
  color: string;
  size: number;
  topPct: number;
  leftPct: number;
  driftX: number;
  driftY: number;
  duration: number;
  opacity: number;
}

const BLOBS: BlobConfig[] = [
  { color: t.auraViolet, size: 320, topPct: -0.06, leftPct: -0.12, driftX: 30,  driftY: -18, duration: 18000, opacity: 0.16 },
  { color: t.auraIndigo, size: 360, topPct:  0.20, leftPct:  0.52, driftX: -28, driftY:  24, duration: 22000, opacity: 0.14 },
  { color: t.auraAqua,   size: 260, topPct:  0.54, leftPct: -0.10, driftX:  20, driftY: -14, duration: 26000, opacity: 0.09 },
  { color: t.auraRose,   size: 230, topPct:  0.66, leftPct:  0.58, driftX: -16, driftY:  18, duration: 24000, opacity: 0.07 },
  { color: t.auraBlue,   size: 220, topPct:  0.38, leftPct:  0.22, driftX:  22, driftY: -10, duration: 20000, opacity: 0.08 },
];

function AuroraBlob({ blob, screenWidth, screenHeight }: {
  blob: BlobConfig;
  screenWidth: number;
  screenHeight: number;
}) {
  const anim = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;

  useEffect(() => {
    // Skip complex animations on Android for performance
    if (Platform.OS === 'android') return;

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: { x: blob.driftX, y: blob.driftY },
          duration: blob.duration,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: { x: -blob.driftX * 0.6, y: blob.driftY * 0.5 },
          duration: blob.duration * 0.8,
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: { x: 0, y: 0 },
          duration: blob.duration * 0.7,
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const top = screenHeight * blob.topPct - blob.size / 2;
  const left = screenWidth * blob.leftPct - blob.size / 2;

  return (
    <Animated.View
      style={[
        styles.blobOuter,
        {
          width: blob.size,
          height: blob.size,
          top,
          left,
          opacity: blob.opacity,
          transform: [{ translateX: anim.x }, { translateY: anim.y }],
        },
      ]}
    >
      <LinearGradient
        colors={[blob.color, 'transparent']}
        style={{ width: blob.size, height: blob.size, borderRadius: blob.size / 2 }}
        start={{ x: 0.5, y: 0.5 }}
        end={{ x: 1, y: 1 }}
      />
    </Animated.View>
  );
}

interface AuroraProps {
  width: number;
  height: number;
}

export default function Aurora({ width, height }: AuroraProps) {
  return (
    <View style={[StyleSheet.absoluteFillObject, styles.container]} pointerEvents="none">
      {/* deep background gradient */}
      <LinearGradient
        colors={['#0d0d1c', '#07070e', '#050509']}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {/* animated colour blobs */}
      {BLOBS.map((blob, i) => (
        <AuroraBlob key={i} blob={blob} screenWidth={width} screenHeight={height} />
      ))}

      {/* star dust — static tiny dots */}
      {STARS.map((s, i) => (
        <View
          key={i}
          style={[
            styles.star,
            { top: s.top * height, left: s.left * width, opacity: s.opacity },
          ]}
        />
      ))}

      {/* grain veil — calms saturation */}
      <LinearGradient
        colors={['rgba(7,7,14,0.18)', 'rgba(7,7,14,0.50)']}
        style={StyleSheet.absoluteFillObject}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
      />
    </View>
  );
}

// Pre-computed static star positions
const STARS = [
  { top: 0.30, left: 0.20, opacity: 0.5 },
  { top: 0.20, left: 0.70, opacity: 0.5 },
  { top: 0.70, left: 0.40, opacity: 0.5 },
  { top: 0.60, left: 0.85, opacity: 0.4 },
  { top: 0.45, left: 0.55, opacity: 0.4 },
  { top: 0.80, left: 0.15, opacity: 0.4 },
  { top: 0.12, left: 0.45, opacity: 0.35 },
  { top: 0.55, left: 0.28, opacity: 0.35 },
];

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  blobOuter: {
    position: 'absolute',
  },
  star: {
    position: 'absolute',
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: '#ffffff',
  },
});
