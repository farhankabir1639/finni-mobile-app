import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Aurora from '../components/Aurora';
import Orb from '../components/Orb';
import { t, fonts } from '../theme/tokens';

export default function SplashScreen() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const progressAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Fade in content
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 600,
      useNativeDriver: true,
    }).start();

    // Progress bar fills over 2.2 s
    Animated.timing(progressAnim, {
      toValue: 1,
      duration: 2200,
      useNativeDriver: false,
    }).start();
  }, []);

  const barWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['8%', '100%'],
  });

  return (
    <View style={styles.container}>
      <Aurora width={width} height={height} />

      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
        <Orb size={140} rings talking />
        <Text style={[styles.title, { fontFamily: fonts.extraBold }]}>Finni</Text>
        <Text style={[styles.sub, { fontFamily: fonts.medium }]}>
          Your calm AI finance coach
        </Text>
      </Animated.View>

      {/* loading bar */}
      <View style={[styles.progressWrap, { bottom: insets.bottom + 60 }]}>
        <View style={styles.progressTrack}>
          <Animated.View style={[styles.progressFill, { width: barWidth }]} />
        </View>
        <Text style={[styles.loadingText, { fontFamily: fonts.medium }]}>
          Tuning your space…
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: t.auraBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    alignItems: 'center',
    gap: 18,
  },
  title: {
    fontSize: 34,
    color: t.text,
    letterSpacing: 0.5,
    marginTop: 12,
  },
  sub: {
    fontSize: 15,
    color: t.text3,
    letterSpacing: 0.2,
  },
  progressWrap: {
    position: 'absolute',
    left: 44,
    right: 44,
    alignItems: 'center',
    gap: 12,
  },
  progressTrack: {
    width: '100%',
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: t.auraAqua,
    shadowColor: t.auraAqua,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 6,
  },
  loadingText: {
    fontSize: 12,
    color: t.text3,
    letterSpacing: 0.3,
  },
});
