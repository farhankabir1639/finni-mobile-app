import React, { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop, Filter, FeGaussianBlur } from 'react-native-svg';

interface OrbProps {
  size?: number;
  rings?: boolean; // legacy prop — kept for call-site compat, no longer renders ring artifacts
  talking?: boolean;
  style?: object;
}

export default function Orb({ size = 80, rings = true, talking = false, style }: OrbProps) {
  const floatY = useRef(new Animated.Value(0)).current;
  const glowOp = useRef(new Animated.Value(0.65)).current;
  const orbSc  = useRef(new Animated.Value(1.0)).current;

  const dur = talking ? 1400 : 3000;

  useEffect(() => {
    const float = Animated.loop(Animated.sequence([
      Animated.timing(floatY, { toValue: -6, duration: dur, useNativeDriver: true }),
      Animated.timing(floatY, { toValue:  6, duration: dur, useNativeDriver: true }),
    ]));
    const glow = Animated.loop(Animated.sequence([
      Animated.timing(glowOp, { toValue: 1.0,  duration: dur, useNativeDriver: true }),
      Animated.timing(glowOp, { toValue: 0.50, duration: dur, useNativeDriver: true }),
    ]));
    const pulse = Animated.loop(Animated.sequence([
      Animated.timing(orbSc, { toValue: 1.05, duration: dur, useNativeDriver: true }),
      Animated.timing(orbSc, { toValue: 1.00, duration: dur, useNativeDriver: true }),
    ]));

    float.start();
    glow.start();
    pulse.start();
    return () => { float.stop(); glow.stop(); pulse.stop(); };
  }, [dur]);

  // Blurred glow is expensive — only render for larger orbs (hero, not tiny avatars)
  const showGlow = rings && size > 40;
  const GLOW_PAD = Math.round(size * 0.65);
  const glowCanvas = size + GLOW_PAD * 2;
  const blurSD = Math.round(size * 0.22);

  return (
    <Animated.View
      style={[
        { width: size, height: size },
        { transform: [{ translateY: floatY }] },
        style,
      ]}
    >
      {/* SVG blurred glow halo — matches design's radial purple/indigo bloom */}
      {showGlow && (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: -GLOW_PAD,
            left: -GLOW_PAD,
            width: glowCanvas,
            height: glowCanvas,
            opacity: glowOp,
          }}
        >
          <Svg width={glowCanvas} height={glowCanvas}>
            <Defs>
              <RadialGradient id="og" cx="50%" cy="50%" r="50%">
                <Stop offset="0%"   stopColor="#8B5CF6" stopOpacity="0.95" />
                <Stop offset="50%"  stopColor="#6366F1" stopOpacity="0.40" />
                <Stop offset="100%" stopColor="#4338CA" stopOpacity="0" />
              </RadialGradient>
              <Filter id="ogf" x="-60%" y="-60%" width="220%" height="220%">
                <FeGaussianBlur stdDeviation={String(blurSD)} />
              </Filter>
            </Defs>
            <Circle
              cx={glowCanvas / 2}
              cy={glowCanvas / 2}
              r={size * 0.62}
              fill="url(#og)"
              filter="url(#ogf)"
            />
          </Svg>
        </Animated.View>
      )}

      {/* Sphere body — scale breathes independently of the float */}
      <Animated.View
        style={[
          styles.sphere,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [{ scale: orbSc }],
          },
        ]}
      >
        <Svg width={size} height={size} style={StyleSheet.absoluteFillObject}>
          <Defs>
            <RadialGradient
              id="sg"
              cx="35%"
              cy="25%"
              r="70%"
              gradientUnits="objectBoundingBox"
            >
              <Stop offset="0%"   stopColor="#f5f0ff" stopOpacity={1} />
              <Stop offset="18%"  stopColor="#c4b5fd" stopOpacity={1} />
              <Stop offset="46%"  stopColor="#818cf8" stopOpacity={1} />
              <Stop offset="76%"  stopColor="#4338ca" stopOpacity={1} />
              <Stop offset="100%" stopColor="#1e1b4b" stopOpacity={1} />
            </RadialGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill="url(#sg)" />
        </Svg>

        {/* Specular highlight — top-left white glint */}
        <View
          style={{
            position: 'absolute',
            width:  size * 0.30,
            height: size * 0.20,
            borderRadius: size * 0.15,
            top:  size * 0.10,
            left: size * 0.16,
            backgroundColor: 'rgba(255,255,255,0.46)',
          }}
        />

        {/* Aqua swirl — bottom-right teal accent from design */}
        <View
          style={{
            position: 'absolute',
            width:  size * 0.34,
            height: size * 0.26,
            borderRadius: size * 0.17,
            bottom: size * 0.10,
            right:  size * 0.10,
            backgroundColor: 'rgba(94,234,212,0.30)',
          }}
        />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sphere: {
    position: 'absolute',
    overflow: 'hidden',
    shadowColor: '#8B5CF6',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.85,
    shadowRadius: 20,
    elevation: 20,
  },
});
