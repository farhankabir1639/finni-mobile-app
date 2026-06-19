import React, { useEffect, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet, Platform, Animated } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Polyline, Line, Rect, Circle } from 'react-native-svg';
import { t } from '../theme/tokens';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// ── Stroke icons ──────────────────────────────────────────────────────────────
function IconHome({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="9,22 9,12 15,12 15,22" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function IconTransactions({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="5" width="20" height="14" rx="2" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Line x1="2" y1="10" x2="22" y2="10" stroke={color} strokeWidth={1.9} />
      <Line x1="6" y1="15" x2="10" y2="15" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}
function IconAnalytics({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M18 20V10M12 20V4M6 20v-6" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function IconInvestments({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Polyline points="23,6 13.5,15.5 8.5,10.5 1,18" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="17,6 23,6 23,12" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
function IconReview({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M22 12h-6l-2 3h-4l-2-3H2" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

const TAB_ICONS: Record<string, (props: { color: string }) => React.ReactElement> = {
  Home: ({ color }) => <IconHome color={color} />,
  Transactions: ({ color }) => <IconTransactions color={color} />,
  Analytics: ({ color }) => <IconAnalytics color={color} />,
  Investments: ({ color }) => <IconInvestments color={color} />,
  Review: ({ color }) => <IconReview color={color} />,
};

// ── Floating glass dock — icon-only pill with a sliding indicator ──────────────
const ITEM = 56;
const GAP = 4;
const PAD = 7;
const IND_H = 50;
const STEP = ITEM + GAP;

export default function GlassDock({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const routes = state.routes;
  const indicator = useRef(new Animated.Value(state.index)).current;

  useEffect(() => {
    Animated.timing(indicator, { toValue: state.index, duration: 340, useNativeDriver: true }).start();
  }, [state.index, indicator]);

  const translateX = indicator.interpolate({
    inputRange: routes.map((_, i) => i),
    outputRange: routes.map((_, i) => i * STEP),
  });

  const dockContent = (
    <View style={styles.inner}>
      <Animated.View style={[styles.indicatorWrap, { transform: [{ translateX }] }]} pointerEvents="none">
        <LinearGradient
          colors={['rgba(139,92,246,0.9)', 'rgba(99,102,241,0.7)']}
          start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }}
          style={styles.indicator}
        />
      </Animated.View>
      {routes.map((route, i) => {
        const focused = state.index === i;
        const IconComp = TAB_ICONS[route.name];
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        return (
          <TouchableOpacity key={route.key} onPress={onPress} style={styles.tab} activeOpacity={0.8}>
            {IconComp && <IconComp color={focused ? '#ffffff' : t.text3} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, 16) }]} pointerEvents="box-none">
      {Platform.OS === 'ios' ? (
        <BlurView intensity={34} tint="dark" style={styles.dock}>{dockContent}</BlurView>
      ) : (
        <View style={[styles.dock, styles.androidDock]}>{dockContent}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  dock: {
    borderRadius: 999,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.glassLine2,
  },
  androidDock: { backgroundColor: 'rgba(18,16,32,0.92)' },
  inner: { flexDirection: 'row', alignItems: 'center', gap: GAP, padding: PAD, position: 'relative' },
  indicatorWrap: { position: 'absolute', top: PAD, left: PAD, width: ITEM, height: IND_H },
  indicator: {
    width: ITEM, height: IND_H, borderRadius: 999,
    shadowColor: t.auraIndigo, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.5, shadowRadius: 12, elevation: 8,
  },
  tab: { width: ITEM, height: IND_H, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
