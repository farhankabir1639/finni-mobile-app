import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { t } from '../theme/tokens';

interface OrbProps {
  size?: number;
  rings?: boolean;
  talking?: boolean;
  style?: object;
}

export default function Orb({ size = 80, rings = true, talking = false, style }: OrbProps) {
  const pulseDuration = talking ? 1800 : 3200;

  // Halo breathe animation
  const haloAnim = useRef(new Animated.Value(0.8)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(haloAnim, { toValue: 1, duration: pulseDuration, useNativeDriver: true }),
        Animated.timing(haloAnim, { toValue: 0.8, duration: pulseDuration, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulseDuration]);

  return (
    <View style={[{ width: size, height: size }, style]}>
      {/* outer halo — only when rings enabled */}
      {rings && (
        <Animated.View
          style={[
            styles.halo,
            {
              width: size * 1.9,
              height: size * 1.9,
              borderRadius: size * 0.95,
              top: -(size * 0.45),
              left: -(size * 0.45),
              opacity: haloAnim,
            },
          ]}
          pointerEvents="none"
        />
      )}

      {/* sonar pulse rings */}
      {rings && [0, 1, 2].map(i => (
        <SonarRing key={i} size={size} index={i} duration={pulseDuration} />
      ))}

      {/* sphere */}
      <View style={[styles.sphere, { width: size, height: size, borderRadius: size / 2 }]}>
        <Svg width={size} height={size} style={StyleSheet.absoluteFillObject}>
          <Defs>
            <RadialGradient
              id="sphere-grad"
              cx="32%"
              cy="28%"
              r="65%"
              gradientUnits="objectBoundingBox"
            >
              <Stop offset="0%"   stopColor="#e9d5ff" stopOpacity={1} />
              <Stop offset="22%"  stopColor="#a78bfa" stopOpacity={1} />
              <Stop offset="52%"  stopColor="#6366f1" stopOpacity={1} />
              <Stop offset="82%"  stopColor="#3b2f8f" stopOpacity={1} />
              <Stop offset="100%" stopColor="#241a5e" stopOpacity={1} />
            </RadialGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#sphere-grad)" />
        </Svg>

        {/* specular highlight */}
        <View
          style={[
            styles.specular,
            {
              width: size * 0.22,
              height: size * 0.16,
              borderRadius: size * 0.11,
              top: size * 0.14,
              left: size * 0.20,
            },
          ]}
        />

        {/* aqua swirl */}
        <View
          style={[
            styles.swirl,
            {
              width: size * 0.28,
              height: size * 0.22,
              borderRadius: size * 0.14,
              bottom: size * 0.14,
              right: size * 0.14,
            },
          ]}
        />
      </View>
    </View>
  );
}

function SonarRing({ size, index, duration }: { size: number; index: number; duration: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const delay = index * (duration / 3);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(anim, {
            toValue: 1,
            duration: duration,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(opacityAnim, {
              toValue: 0.55,
              duration: duration * 0.18,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 0,
              duration: duration * 0.82,
              useNativeDriver: true,
            }),
          ]),
        ]),
        Animated.parallel([
          Animated.timing(anim, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(opacityAnim, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [duration, index]);

  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.62, 1.5] });

  return (
    <Animated.View
      style={[
        styles.sonarRing,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: t.auraAqua,
          transform: [{ scale }],
          opacity: opacityAnim,
        },
      ]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  halo: {
    position: 'absolute',
    backgroundColor: 'rgba(139,92,246,0.18)',
  },
  sphere: {
    position: 'absolute',
    overflow: 'hidden',
    shadowColor: t.auraViolet,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 16,
  },
  specular: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.28)',
  },
  swirl: {
    position: 'absolute',
    backgroundColor: 'rgba(94,234,212,0.22)',
  },
  sonarRing: {
    position: 'absolute',
    borderWidth: 1.5,
  },
});
