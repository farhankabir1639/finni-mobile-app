import React from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, {
  Path,
  Circle,
  Text as SvgText,
  Defs,
  LinearGradient,
  Stop,
} from 'react-native-svg';
import { t, fonts } from '../theme/tokens';

type TrendPoint = { label: string; value: number; isCurrent?: boolean };

interface TrendAreaProps {
  data: TrendPoint[];
  width?: number;
  height?: number;
}

export default function TrendArea({
  data,
  width = 300,
  height = 110,
}: TrendAreaProps) {
  if (data.length < 2) return null;

  const pad = 6;
  const labelH = 22;
  const max = Math.max(...data.map((d) => d.value)) * 1.08;
  const min = Math.min(...data.map((d) => d.value)) * 0.92;
  const range = max - min || 1;

  const xs = data.map((_, i) => pad + (i * (width - pad * 2)) / (data.length - 1));
  const ys = data.map(
    (d) => height - pad - ((d.value - min) / range) * (height - pad * 2 - 14)
  );

  // Smooth cubic bezier path
  let linePath = `M ${xs[0]} ${ys[0]}`;
  for (let i = 1; i < xs.length; i++) {
    const cx = (xs[i - 1] + xs[i]) / 2;
    linePath += ` C ${cx} ${ys[i - 1]}, ${cx} ${ys[i]}, ${xs[i]} ${ys[i]}`;
  }

  // Closed area path for gradient fill
  const areaPath = `${linePath} L ${xs[xs.length - 1]} ${height} L ${xs[0]} ${height} Z`;

  const lastIdx = data.length - 1;
  const endX = xs[lastIdx];
  const endY = ys[lastIdx];

  return (
    <View style={styles.container}>
      <Svg
        width={width}
        height={height + labelH}
        viewBox={`0 0 ${width} ${height + labelH}`}
      >
        <Defs>
          <LinearGradient id="trendAreaFill" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.auraViolet} stopOpacity="0.35" />
            <Stop offset="0.7" stopColor={t.auraViolet} stopOpacity="0.08" />
            <Stop offset="1" stopColor={t.auraViolet} stopOpacity="0" />
          </LinearGradient>
          <LinearGradient id="trendLine" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={t.auraAqua} />
            <Stop offset="1" stopColor={t.auraViolet} />
          </LinearGradient>
          <LinearGradient id="trendGlow1" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={t.auraAqua} stopOpacity="0.25" />
            <Stop offset="1" stopColor={t.auraViolet} stopOpacity="0.25" />
          </LinearGradient>
          <LinearGradient id="trendGlow2" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={t.auraAqua} stopOpacity="0.12" />
            <Stop offset="1" stopColor={t.auraViolet} stopOpacity="0.12" />
          </LinearGradient>
        </Defs>

        {/* Area fill */}
        <Path d={areaPath} fill="url(#trendAreaFill)" />

        {/* Glow layers — outermost to innermost */}
        <Path
          d={linePath}
          fill="none"
          stroke="url(#trendGlow2)"
          strokeWidth={16}
          strokeLinecap="round"
        />
        <Path
          d={linePath}
          fill="none"
          stroke="url(#trendGlow1)"
          strokeWidth={8}
          strokeLinecap="round"
        />

        {/* Main line */}
        <Path
          d={linePath}
          fill="none"
          stroke="url(#trendLine)"
          strokeWidth={3}
          strokeLinecap="round"
        />

        {/* Endpoint halo */}
        <Circle cx={endX} cy={endY} r={14} fill={t.auraAqua} opacity={0.12} />
        <Circle cx={endX} cy={endY} r={8} fill={t.auraAqua} opacity={0.22} />
        {/* Endpoint dot */}
        <Circle cx={endX} cy={endY} r={5} fill="#fff" />

        {/* Month labels */}
        {data.map((d, i) => (
          <SvgText
            key={i}
            x={xs[i]}
            y={height + 16}
            textAnchor="middle"
            fill={d.isCurrent ? t.text : t.text3}
            fontSize={10.5}
            fontWeight={d.isCurrent ? '700' : '500'}
            fontFamily={fonts.medium}
          >
            {d.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    alignItems: 'center',
  },
});
