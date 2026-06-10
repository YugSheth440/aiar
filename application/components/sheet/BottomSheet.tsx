import React, { useCallback, useMemo, useRef, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import BottomSheetGorhom, { BottomSheetView } from '@gorhom/bottom-sheet';
import { useUiStore } from '../../store/uiStore';
import { useSceneStore } from '../../store/sceneStore';
import { operationalTheme, criticalTheme } from '../../theme/colors';
import { StepCard, ActionStep } from './StepCard';

const MOCK_STEPS: ActionStep[] = [
  { id: 'step-1', stepNumber: 1, title: 'Power Down Machinery', subtitle: 'Turn off the main breaker immediately' },
  { id: 'step-2', stepNumber: 2, title: 'Evacuate Area', subtitle: 'Clear all personnel within a 15ft radius' },
  { id: 'step-3', stepNumber: 3, title: 'Report to Supervisor', subtitle: 'Log the incident in the safety portal' }
];

export function BottomSheet() {
  const { sheetPosition, setSheetPosition, theme: themeMode } = useUiStore();
  const { capsuleState } = useSceneStore();
  const bottomSheetRef = useRef<BottomSheetGorhom>(null);
  const [completedSteps, setCompletedSteps] = useState<Set<string>>(new Set());

  // Define snap points: 15% (collapsed), 50% (half), 90% (full)
  const snapPoints = useMemo(() => ['15%', '50%', '90%'], []);
  const theme = themeMode === 'critical' ? criticalTheme : operationalTheme;

  const handleSheetChanges = useCallback((index: number) => {
    if (index === 0) setSheetPosition('collapsed');
    else if (index === 1) setSheetPosition('half');
    else if (index === 2) setSheetPosition('full');
  }, [setSheetPosition]);

  useEffect(() => {
    if (sheetPosition === 'collapsed') bottomSheetRef.current?.snapToIndex(0);
    else if (sheetPosition === 'half') bottomSheetRef.current?.snapToIndex(1);
    else if (sheetPosition === 'full') bottomSheetRef.current?.snapToIndex(2);
  }, [sheetPosition]);

  const toggleStep = (id: string) => {
    setCompletedSteps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <BottomSheetGorhom
      ref={bottomSheetRef}
      index={0}
      snapPoints={snapPoints}
      onChange={handleSheetChanges}
      backgroundStyle={{ backgroundColor: theme.sheetBg }}
      handleIndicatorStyle={{ backgroundColor: 'rgba(255,255,255,0.3)' }}
    >
      <BottomSheetView style={styles.contentContainer}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.textPrimary }]}>Guidance Procedures</Text>
          <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Follow these steps sequentially to resolve the issue safely.</Text>
        </View>

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
      </BottomSheetView>
    </BottomSheetGorhom>
  );
}

const styles = StyleSheet.create({
  contentContainer: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 8,
  },
  header: {
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    fontWeight: '400',
  },
  stepsContainer: {
    gap: 12,
  }
});
