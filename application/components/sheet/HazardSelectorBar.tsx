import React from 'react';
import { View, Text, StyleSheet, Pressable, useWindowDimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  FadeInUp,
  FadeOutDown,
  Layout,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { AlertTriangle } from 'lucide-react-native';
import { useWorkflowStore } from '../../store/workflowStore';
import type { Hazard, RiskLevel } from '../../src/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const RISK_DOT: Record<RiskLevel, string> = {
  CRITICAL: '#ef4444',
  HIGH:     '#ef4444',
  MEDIUM:   '#fb923c',
  LOW:      '#4ade80',
};

function HazardPill({
  hazard,
  isSelected,
  onPress,
}: {
  hazard: Hazard;
  isSelected: boolean;
  onPress: () => void;
}) {
  const dot = RISK_DOT[hazard.riskLevel];
  const scale = useSharedValue(1);

  const handlePress = async () => {
    scale.value = withSequence(withTiming(0.93, { duration: 70 }), withSpring(1, { damping: 12 }));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  };

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  // Truncate title
  const shortTitle = hazard.title.length > 9
    ? hazard.title.slice(0, 8) + '...'
    : hazard.title;

  return (
    <Pressable onPress={handlePress}>
      <Animated.View style={pillStyle}>
        <BlurView
          intensity={75}
          tint="dark"
          style={[
            styles.pill,
            isSelected ? { borderColor: `${dot}80`, borderWidth: 1.5 } : {},
          ]}
        >
          <View style={[styles.pillDot, { backgroundColor: dot }]} />
          <Text style={styles.pillText} numberOfLines={1}>{shortTitle}</Text>
          {(hazard.riskLevel === 'CRITICAL' || hazard.riskLevel === 'HIGH') && (
            <AlertTriangle color={dot} size={12} strokeWidth={2.5} />
          )}
        </BlurView>
      </Animated.View>
    </Pressable>
  );
}

/**
 * HazardSelectorBar — floating hazard pill buttons at the bottom of camera.
 *
 * Visibility rules:
 *  - Shows when state is HAZARDS_DISCOVERED (no sheet yet)
 *  - Shows when state is HAZARD_FOCUSED AND sheetSnapIndex === 0 (sheet minimized/dragged down)
 *  - HIDES when sheet is at peek (index 1) or full (index 2) — goes behind the sheet
 *
 * Z-order: zIndex 50 — always BELOW the bottom sheet (zIndex 1000+)
 */
export function HazardSelectorBar() {
  const {
    workflowState,
    detectedHazards,
    selectedHazard,
    focusHazard,
    sheetSnapIndex,
  } = useWorkflowStore();
  const insets = useSafeAreaInsets();

  // Show pills if no sheet OR if sheet is dragged fully down (snap index 0)
  const pillsVisible =
    workflowState === 'HAZARDS_DISCOVERED' ||
    ((workflowState === 'HAZARD_FOCUSED' || workflowState === 'SHEET_OPEN') &&
      sheetSnapIndex <= 0);

  if (!pillsVisible || detectedHazards.length === 0) return null;

  // Vertical position — above bottom safe area
  const bottomPos = insets.bottom + 28;

  return (
    <Animated.View
      entering={FadeInUp.springify().damping(18).delay(200)}
      exiting={FadeOutDown.duration(200)}
      layout={Layout.springify()}
      style={[styles.wrapper, { bottom: bottomPos }]}
      pointerEvents="box-none"
    >
      <View style={styles.row}>
        {detectedHazards.map((h) => (
          <HazardPill
            key={h.id}
            hazard={h}
            isSelected={selectedHazard?.id === h.id}
            onPress={() => focusHazard(h)}
          />
        ))}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // zIndex BELOW the bottom sheet — sheet renders at zIndex 1000+
    zIndex: 50,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 99,
    backgroundColor: 'rgba(10,10,18,0.85)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    minWidth: 110,
    overflow: 'hidden',
  },
  pillDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    flexShrink: 0,
  },
  pillText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.1,
    flex: 1,
  },
});
