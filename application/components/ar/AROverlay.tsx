import React, { useEffect } from 'react';
import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  withSpring,
  withDelay,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import Svg, { Rect, Line, Circle, Path, G } from 'react-native-svg';
import { useWorkflowStore } from '../../store/workflowStore';
import type { Hazard, RiskLevel } from '../../src/types';

// ── Color palette matching reference images ─────────────────────
const RISK_STROKE: Record<RiskLevel, string> = {
  CRITICAL: '#ef4444',   // bright red  
  HIGH:     '#ef4444',   // bright red
  MEDIUM:   '#fb923c',   // orange
  LOW:      '#4ade80',   // green
};

const TEMP_BG: Record<RiskLevel, string> = {
  CRITICAL: '#ef4444',
  HIGH:     '#ef4444',
  MEDIUM:   '#f97316',
  LOW:      '#22c55e',
};

// ── Scanning sweep (ANALYZING) ─────────────────────────────────
function ScanningOverlay() {
  const { width, height } = useWindowDimensions();
  const scanY = useSharedValue(0);
  const gridOp = useSharedValue(0);

  useEffect(() => {
    gridOp.value = withTiming(1, { duration: 400 });
    scanY.value = withRepeat(
      withSequence(
        withTiming(height, { duration: 2200 }),
        withTiming(0, { duration: 0 })
      ),
      -1
    );
    return () => { scanY.value = 0; };
  }, []);

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: scanY.value }],
    opacity: gridOp.value,
  }));

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      exiting={FadeOut.duration(600)}
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
    >
      {/* Corner brackets */}
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <G stroke="#60a5fa" strokeWidth="2" fill="none" strokeLinecap="round">
          {/* TL */}
          <Path d={`M 24 64 L 24 24 L 64 24`} />
          {/* TR */}
          <Path d={`M ${width - 24} 64 L ${width - 24} 24 L ${width - 64} 24`} />
          {/* BL */}
          <Path d={`M 24 ${height - 64} L 24 ${height - 24} L 64 ${height - 24}`} />
          {/* BR */}
          <Path d={`M ${width - 24} ${height - 64} L ${width - 24} ${height - 24} L ${width - 64} ${height - 24}`} />
        </G>
        <Circle cx={width / 2} cy={height / 2} r={3} fill="#60a5fa" opacity={0.6} />
        <Circle cx={width / 2} cy={height / 2} r={20} stroke="#60a5fa" strokeWidth={0.8} fill="none" opacity={0.2} />
      </Svg>

      {/* Horizontal scan line */}
      <Animated.View style={[styles.scanLine, lineStyle]} />
    </Animated.View>
  );
}

// ── Single temperature badge pill ──────────────────────────────
function TempBadge({
  x, y, reading, unit, risk,
}: {
  x: number; y: number; reading: string; unit: string; risk: RiskLevel;
}) {
  const bg = TEMP_BG[risk];

  return (
    <Animated.View
      entering={FadeIn.delay(300).duration(350)}
      style={[
        styles.tempBadge,
        {
          left: x - 64,
          top: y - 18,
          backgroundColor: bg,
        },
      ]}
      pointerEvents="none"
    >
      <Text style={styles.tempIcon}>🌡</Text>
      <Text style={styles.tempText}>{reading}{unit}</Text>
    </Animated.View>
  );
}

// ── Object label with anchor line ──────────────────────────────
function ObjectLabel({
  x, y, label, color,
}: {
  x: number; y: number; label: string; color: string;
}) {
  return (
    <Animated.View
      entering={FadeIn.delay(450).duration(350)}
      style={[styles.labelContainer, { left: x - 60, top: y }]}
      pointerEvents="none"
    >
      {/* Vertical anchor line */}
      <View style={[styles.anchorLine, { backgroundColor: color }]} />
      {/* Label text */}
      <View style={[styles.labelPill, { borderColor: `${color}60` }]}>
        <Text style={styles.labelText} numberOfLines={1}>{label}</Text>
      </View>
    </Animated.View>
  );
}

// ── Bounding box matching reference (solid colored border + corners) ─
function HazardBox({
  hazard,
  isSelected,
  index,
}: {
  hazard: Hazard;
  isSelected: boolean;
  index: number;
}) {
  const { width, height } = useWindowDimensions();

  const parseP = (v: string) => parseFloat(v) / 100;
  const bx = parseP(hazard.boundingBox.left) * width;
  const by = parseP(hazard.boundingBox.top) * height;
  const bw = parseP(hazard.boundingBox.width) * width;
  const bh = parseP(hazard.boundingBox.height) * height;

  const color = RISK_STROKE[hazard.riskLevel];

  const boxOp = useSharedValue(0);
  const boxScale = useSharedValue(0.93);
  const pulseOp = useSharedValue(0.7);

  useEffect(() => {
    const delay = index * 150;
    boxOp.value = withDelay(delay, withTiming(1, { duration: 500 }));
    boxScale.value = withDelay(delay, withSpring(1, { damping: 14, stiffness: 130 }));

    // Pulse the box border opacity for critical hazards
    if (hazard.riskLevel === 'CRITICAL' || hazard.riskLevel === 'HIGH') {
      pulseOp.value = withRepeat(
        withSequence(withTiming(1, { duration: 700 }), withTiming(0.55, { duration: 700 })),
        -1, true
      );
    }
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: boxOp.value,
    transform: [{ scale: boxScale.value }],
  }));

  // Selected hazard gets extra highlight
  const strokeWidth = isSelected ? 2.8 : 2;
  const opacity = isSelected ? 1 : 0.75;

  const tempX = bx + bw / 2;
  const tempY = by; // top of box

  // Second temp reading shown mid-height on selected hazard (from reference)
  const temp2X = bx + bw * 0.4;
  const temp2Y = by + bh * 0.52;

  // Label anchor below box
  const labelX = bx + bw / 2;
  const labelY = by + bh;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, containerStyle]} pointerEvents="none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} opacity={opacity}>
        {/* Main bounding rect — solid border (not dashed) */}
        <Rect
          x={bx} y={by} width={bw} height={bh}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          rx={4}
        />

        {/* Corner accent dots — 4 corners */}
        <Circle cx={bx} cy={by} r={4} fill={color} />
        <Circle cx={bx + bw} cy={by} r={4} fill={color} />
        <Circle cx={bx} cy={by + bh} r={4} fill={color} />
        <Circle cx={bx + bw} cy={by + bh} r={4} fill={color} />

        {/* Center crosshair */}
        <Line
          x1={bx + bw / 2 - 8} y1={by + bh / 2}
          x2={bx + bw / 2 + 8} y2={by + bh / 2}
          stroke={color} strokeWidth={1} opacity={0.5}
        />
        <Line
          x1={bx + bw / 2} y1={by + bh / 2 - 8}
          x2={bx + bw / 2} y2={by + bh / 2 + 8}
          stroke={color} strokeWidth={1} opacity={0.5}
        />

        {/* Anchor line for label (vertical, from bottom of box down) */}
        <Line
          x1={bx + bw / 2} y1={by + bh}
          x2={bx + bw / 2} y2={by + bh + 32}
          stroke={color} strokeWidth={1.5} opacity={0.6}
        />
      </Svg>

      {/* Temperature badge at top of box */}
      <TempBadge
        x={tempX}
        y={tempY}
        reading={hazard.reading}
        unit={hazard.readingUnit}
        risk={hazard.riskLevel}
      />

      {/* Object label below box */}
      <ObjectLabel
        x={labelX}
        y={labelY + 2}
        label={hazard.component}
        color={color}
      />
    </Animated.View>
  );
}

// ── Main AROverlay ─────────────────────────────────────────────
export function AROverlay() {
  const { workflowState, detectedHazards, selectedHazard } = useWorkflowStore();

  const showScan = workflowState === 'ANALYZING';
  const showBoxes = ['HAZARDS_DISCOVERED', 'HAZARD_FOCUSED', 'SHEET_OPEN'].includes(workflowState);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {showScan && <ScanningOverlay />}

      {showBoxes && detectedHazards.map((h, i) => (
        <HazardBox
          key={h.id}
          hazard={h}
          isSelected={selectedHazard?.id === h.id}
          index={i}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  scanLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: 'rgba(96,165,250,0.7)',
    shadowColor: '#60a5fa',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 10,
  },

  tempBadge: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 99,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 6,
    elevation: 8,
  },
  tempIcon: {
    fontSize: 13,
  },
  tempText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  labelContainer: {
    position: 'absolute',
    alignItems: 'center',
    width: 120,
  },
  anchorLine: {
    width: 1.5,
    height: 28,
    opacity: 0.6,
  },
  labelPill: {
    backgroundColor: 'rgba(10,10,18,0.75)',
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 120,
  },
  labelText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
});
