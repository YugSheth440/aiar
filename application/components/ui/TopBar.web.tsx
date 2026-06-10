import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useWorkflowStore } from '../../store/workflowStore';
import { MOCK_HAZARDS } from '../../src/mockData';

// Web stub for TopBar — updated for new 6-state workflow
export function TopBar() {
  const { workflowState, startAnalysis, onHazardsDiscovered, reset } = useWorkflowStore();
  const isReady = workflowState === 'READY';
  const isAnalyzing = workflowState === 'ANALYZING';

  const handleScan = () => {
    if (isAnalyzing) return;
    if (!isReady) { reset(); return; }
    startAnalysis();
    setTimeout(() => onHazardsDiscovered(MOCK_HAZARDS), 3000);
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={handleScan}
        style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.scanText}>
          {isReady ? '⬤  Scan' : isAnalyzing ? '◌  Analyzing...' : '✕  Reset'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 20,
    right: 20,
    zIndex: 100,
  },
  scanBtn: {
    backgroundColor: 'rgba(29,106,229,0.9)',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  scanText: {
    color: '#FFF',
    fontWeight: '700',
    fontSize: 14,
  },
});
