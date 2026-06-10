import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, { FadeInRight, FadeOutRight } from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import { useUiStore } from '../../store/uiStore';
import { X } from 'lucide-react-native';
import { operationalTheme, criticalTheme } from '../../theme/colors';
import { StepCard, ActionStep } from './StepCard';

const MOCK_STEPS: ActionStep[] = [
  { id: 'step-1', stepNumber: 1, title: 'Power Down Machinery', subtitle: 'Turn off the main breaker immediately' },
  { id: 'step-2', stepNumber: 2, title: 'Evacuate Area', subtitle: 'Clear all personnel within a 15ft radius' },
  { id: 'step-3', stepNumber: 3, title: 'Report to Supervisor', subtitle: 'Log the incident in the safety portal' }
];

export function GuidancePanel() {
  const { activeHazardId, setActiveHazardId, theme: themeMode } = useUiStore();
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  // Show panel even if activeHazardId is null so user can see it during testing, 
  // or default to true for demonstration if needed.
  const isOpen = true; // Hardcoded to true for demo purposes
  const theme = themeMode === 'critical' ? criticalTheme : operationalTheme;

  if (!isOpen) return null;

  const toggleStep = (id: string) => {
    setCompletedSteps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Animated.View 
      entering={FadeInRight.springify()} 
      exiting={FadeOutRight.springify()} 
      style={styles.container}
    >
      <BlurView intensity={70} tint="dark" style={[styles.panel, { backgroundColor: theme.sheetBg }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Guidance Procedures</Text>
          <Pressable onPress={() => setActiveHazardId(null)} style={styles.closeBtn}>
            <X color={theme.textPrimary} size={20} />
          </Pressable>
        </View>
        <View style={styles.content}>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Follow these steps sequentially to resolve the issue safely.</Text>
          <View style={styles.stepsContainer}>
            {MOCK_STEPS.map((step, index) => (
              <StepCard
                key={step.id}
                step={step}
                index={index + 1}
                isCompleted={completedSteps.has(step.id)}
                onToggle={toggleStep}
                isCriticalMode={themeMode === 'critical'}
              />
            ))}
          </View>
        </View>
      </BlurView>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 24,
    top: '10%',
    bottom: '10%',
    width: 400,
    zIndex: 40,
  },
  panel: {
    flex: 1,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.05)',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 14,
    marginBottom: 20,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  content: {
    flex: 1,
    padding: 24,
  },
  stepsContainer: {
    gap: 12,
  }
});
