import React, { useEffect, useRef } from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Platform,
  Text,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Polyline, Line, Rect, Circle } from 'react-native-svg';
import { t } from '../theme/tokens';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';

// ── Minimal stroke icons ──────────────────────────────────────────────────────

function IconHome({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="9,22 9,12 15,12 15,22" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconTransactions({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect x="2" y="5" width="20" height="14" rx="2" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      <Line x1="2" y1="10" x2="22" y2="10" stroke={color} strokeWidth={1.8} />
      <Line x1="6" y1="15" x2="10" y2="15" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function IconAnalytics({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path d="M18 20V10M12 20V4M6 20v-6" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconInvestments({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Polyline points="23,6 13.5,15.5 8.5,10.5 1,18" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Polyline points="17,6 23,6 23,12" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function IconSettings({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="3" stroke={color} strokeWidth={1.8} />
      <Path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke={color} strokeWidth={1.8} />
    </Svg>
  );
}

const TAB_ICONS: Record<string, (props: { color: string }) => JSX.Element> = {
  Home:         ({ color }) => <IconHome color={color} />,
  Transactions: ({ color }) => <IconTransactions color={color} />,
  Analytics:    ({ color }) => <IconAnalytics color={color} />,
  Investments:  ({ color }) => <IconInvestments color={color} />,
  Settings:     ({ color }) => <IconSettings color={color} />,
};

const TAB_LABELS: Record<string, string> = {
  Home:         'Home',
  Transactions: 'Wallet',
  Analytics:    'Insights',
  Investments:  'Invest',
  Settings:     'Settings',
};

// ── GlassDock component ───────────────────────────────────────────────────────

export default function GlassDock({ state, descriptors, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const routes = state.routes;
  const tabCount = routes.length;
  const tabWidth = 1 / tabCount;

  // Sliding indicator X position
  const indicatorAnim = useRef(new Animated.Value(state.index * tabWidth)).current;

  useEffect(() => {
    Animated.spring(indicatorAnim, {
      toValue: state.index * tabWidth,
      useNativeDriver: true,
      tension: 68,
      friction: 11,
    }).start();
  }, [state.index]);

  const dockContent = (
    <View style={styles.inner}>
      {/* sliding glow indicator */}
      <Animated.View
        style={[
          styles.indicator,
          {
            width: `${tabWidth * 100}%` as any,
            transform: [{
              translateX: indicatorAnim.interpolate({
                inputRange: [0, 1],
                outputRange: [0, DOCK_ESTIMATE_WIDTH],
              }),
            }],
          },
        ]}
        pointerEvents="none"
      />

      {routes.map((route, i) => {
        const focused = state.index === i;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        };
        const IconComp = TAB_ICONS[route.name];
        const label = TAB_LABELS[route.name] ?? route.name;
        const color = focused ? t.auraAqua : t.text3;

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            style={styles.tab}
            activeOpacity={0.7}
          >
            {IconComp ? <IconComp color={color} /> : <Text style={{ color }}>{label[0]}</Text>}
            <Text style={[styles.label, { color }]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <View style={[styles.wrapper, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {Platform.OS === 'ios' ? (
        <BlurView intensity={36} tint="dark" style={styles.dock}>
          {dockContent}
        </BlurView>
      ) : (
        <View style={[styles.dock, styles.androidDock]}>
          {dockContent}
        </View>
      )}
    </View>
  );
}

// Rough estimate for the translateX interpolation — real width measured at render
// The spring animation will self-correct once the tab bar renders at full width
const DOCK_ESTIMATE_WIDTH = 360;

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
  },
  dock: {
    borderRadius: 26,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: t.glassLine2,
  },
  androidDock: {
    backgroundColor: 'rgba(8,11,22,0.92)',
  },
  inner: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 4,
    position: 'relative',
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 4,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  indicator: {
    position: 'absolute',
    top: 6,
    height: 2,
    borderRadius: 2,
    backgroundColor: t.auraAqua,
    shadowColor: t.auraAqua,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 8,
  },
});
