import React, { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  FadeIn,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { RotateCcw } from 'lucide-react-native';
import { useWorkflowStore, WorkflowState } from '../../store/workflowStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type StateConfig = {
  dot: string;
  label: string;
  pulse: boolean;
  borderColor: string;
  bgColor: string;
};

const CONFIG: Record<WorkflowState, StateConfig> = {
  READY: {
    dot: '#4ade80',
    label: 'Ready',
    pulse: false,
    borderColor: 'rgba(255,255,255,0.15)',
    bgColor: 'rgba(10,10,16,0.82)',
  },
  ANALYZING: {
    dot: '#60a5fa',
    label: 'Analyzing...',
    pulse: true,
    borderColor: 'rgba(96,165,250,0.4)',
    bgColor: 'rgba(10,10,16,0.82)',
  },
  HAZARDS_DISCOVERED: {
    dot: '#fbbf24',
    label: 'Hazard Detected',
    pulse: false,
    borderColor: 'rgba(255,255,255,0.15)',
    bgColor: 'rgba(10,10,16,0.88)',
  },
  HAZARD_FOCUSED: {
    dot: '#ef4444',
    label: 'Critical Alert',
    pulse: true,
    borderColor: 'rgba(239,68,68,0.5)',
    bgColor: 'rgba(10,10,16,0.92)',
  },
  SHEET_OPEN: {
    dot: '#ef4444',
    label: 'Critical Alert',
    pulse: true,
    borderColor: 'rgba(239,68,68,0.5)',
    bgColor: 'rgba(10,10,16,0.92)',
  },
};

export function StatusCapsule() {
  const { workflowState, selectedHazard, reset } = useWorkflowStore();
  const insets = useSafeAreaInsets();
  const cfg = CONFIG[workflowState];

  // Override label from selected hazard when applicable
  const label =
    (workflowState === 'HAZARD_FOCUSED' || workflowState === 'SHEET_OPEN') && selectedHazard
      ? selectedHazard.riskLevel === 'CRITICAL' || selectedHazard.riskLevel === 'HIGH'
        ? 'Critical Alert'
        : 'Hazard Detected'
      : cfg.label;

  const dotColor =
    (workflowState === 'HAZARD_FOCUSED' || workflowState === 'SHEET_OPEN') && selectedHazard
      ? selectedHazard.riskLevel === 'CRITICAL' || selectedHazard.riskLevel === 'HIGH'
        ? '#ef4444'
        : '#fbbf24'
      : cfg.dot;

  const pulseScale = useSharedValue(1);
  const pulseOp = useSharedValue(0);

  useEffect(() => {
    if (cfg.pulse) {
      pulseScale.value = withRepeat(withTiming(2.2, { duration: 800 }), -1);
      pulseOp.value = withRepeat(
        withSequence(withTiming(0.55, { duration: 100 }), withTiming(0, { duration: 700 })),
        -1
      );
    } else {
      pulseScale.value = withTiming(1);
      pulseOp.value = withTiming(0);
    }
  }, [cfg.pulse]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
    opacity: pulseOp.value,
  }));

  const showReset =
    workflowState !== 'READY' && workflowState !== 'ANALYZING';

  return (
    <Animated.View
      entering={FadeIn.duration(400)}
      style={[styles.wrapper, { top: insets.top + 12 }]}
    >
      {/* Main capsule */}
      <BlurView
        intensity={70}
        tint="dark"
        style={[styles.capsule, { borderColor: cfg.borderColor, backgroundColor: cfg.bgColor }]}
      >
        {/* Dot with pulse */}
        <View style={styles.dotWrap}>
          <Animated.View style={[styles.dotPulse, { backgroundColor: dotColor }, pulseStyle]} />
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
        </View>
        <Text style={styles.label}>{label}</Text>

        {/* Sun / brightness icon — decorative in reference */}
        <View style={styles.iconBtn}>
          <Text style={styles.iconText}>☀</Text>
        </View>
      </BlurView>

      {/* Camera rotate icon — top right (from reference images) */}
      {showReset && (
        <Pressable onPress={reset} style={styles.resetBtn} hitSlop={8}>
          <BlurView intensity={60} tint="dark" style={styles.resetBlur}>
            <RotateCcw color="rgba(255,255,255,0.8)" size={16} strokeWidth={2.2} />
          </BlurView>
        </Pressable>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  capsule: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 14,
    paddingRight: 6,
    paddingVertical: 10,
    borderRadius: 99,
    borderWidth: 1,
    overflow: 'hidden',
    gap: 8,
  },
  dotWrap: {
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotPulse: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.7)',
  },
  resetBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  resetBlur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10,10,16,0.7)',
  },
});
