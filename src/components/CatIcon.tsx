import React from 'react';
import { View } from 'react-native';
import Svg, { Path, Circle, Rect } from 'react-native-svg';
import { t } from '../theme/tokens';

// Maps category name → design color + stroke icon
// Matches design's CAT object in ui.jsx exactly
const CAT_MAP: Record<string, { color: string; icon: string }> = {
  food:          { color: t.catFood,      icon: 'food' },
  transport:     { color: t.catTransport, icon: 'car' },
  shopping:      { color: t.catShopping,  icon: 'bag' },
  bills:         { color: t.catBills,     icon: 'bolt' },
  income:        { color: t.catIncome,    icon: 'briefcase' },
  salary:        { color: t.catIncome,    icon: 'briefcase' },
  uncategorized: { color: t.catUncat,     icon: 'box' },
};

export function getCatConfig(name: string | null | undefined) {
  if (!name) return CAT_MAP.uncategorized;
  return CAT_MAP[name.toLowerCase()] ?? CAT_MAP.uncategorized;
}

// Stroke icons taken directly from icons.jsx in the design file
function StrokeIcon({ icon, size, color }: { icon: string; size: number; color: string }) {
  const p = { stroke: color, strokeWidth: 1.9, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, fill: 'none' as const };
  switch (icon) {
    case 'food':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...p} d="M5 4v6a2.5 2.5 0 0 0 5 0V4M7.5 4v16" />
          <Path {...p} d="M16.5 4c-1.6 0-2.5 1.8-2.5 4.5s.9 3.5 2.5 3.5 2.5-.8 2.5-3.5S18.1 4 16.5 4Zm0 8v8" />
        </Svg>
      );
    case 'car':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...p} d="M4 16v-3.2l1.8-4.2A2 2 0 0 1 7.65 7.4h8.7a2 2 0 0 1 1.85 1.2L20 12.8V16" />
          <Path {...p} d="M3.5 16h17M5 16v1.8M19 16v1.8" />
          <Circle cx="7.5" cy="16" r="1.5" fill={color} stroke="none" />
          <Circle cx="16.5" cy="16" r="1.5" fill={color} stroke="none" />
        </Svg>
      );
    case 'bag':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...p} d="M5.5 8h13l-.8 11.2a1.5 1.5 0 0 1-1.5 1.4H7.8a1.5 1.5 0 0 1-1.5-1.4L5.5 8Z" />
          <Path {...p} d="M8.5 8V6.5a3.5 3.5 0 0 1 7 0V8" />
        </Svg>
      );
    case 'bolt':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...p} d="M13 3 5 13.5h5.5L10 21l8-10.5h-5.5L13 3Z" />
        </Svg>
      );
    case 'briefcase':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Rect {...p} x="3.5" y="7.5" width="17" height="12" rx="2" />
          <Path {...p} d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" />
          <Path {...p} d="M3.5 12.5h17" />
        </Svg>
      );
    default: // box — used for uncategorized and unknown categories
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24">
          <Path {...p} d="M12 3 20 7v10l-8 4-8-4V7Z" />
          <Path {...p} d="m4 7 8 4 8-4M12 11v10" />
        </Svg>
      );
  }
}

interface CatIconProps {
  name: string | null | undefined;
  size?: number;
  radius?: number;
}

// Tinted category icon tile — matches design's CatIcon exactly:
// background: color-mix(in srgb, color 16%, transparent) → color + '29' hex alpha
// border:     color-mix(in srgb, color 26%, transparent) → color + '42' hex alpha
export default function CatIcon({ name, size = 42, radius = 13 }: CatIconProps) {
  const cfg = getCatConfig(name);
  const iconSize = Math.round(size * 0.5);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: cfg.color + '29',
        borderWidth: 1,
        borderColor: cfg.color + '42',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
      }}
    >
      <StrokeIcon icon={cfg.icon} size={iconSize} color={cfg.color} />
    </View>
  );
}
