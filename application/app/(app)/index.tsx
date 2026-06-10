import React from 'react';
import { View, StyleSheet } from 'react-native';
import { CameraView } from '../../components/camera/CameraView';
import { AROverlay } from '../../components/ar/AROverlay';
import { StatusCapsule } from '../../components/capsule/StatusCapsule';
import { LeftControls } from '../../components/ui/LeftControls';
import { HazardSelectorBar } from '../../components/sheet/HazardSelectorBar';
import { HazardSheet } from '../../components/sheet/HazardSheet';

/**
 * CameraScreen — FixSight main screen.
 *
 * Layer order (bottom → top):
 *  1. Full-screen camera feed
 *  2. AR overlay (scan line, bounding boxes, temp badges, labels)
 *  3. Status capsule (top-center pill)
 *  4. Left action rail (camera flip, flash, rotate, scan)
 *  5. Hazard selector pills (bottom, appears after scan)
 *  6. Hazard sheet (bottom panel / right panel in landscape)
 */
export default function CameraScreen() {
  return (
    <View style={styles.container}>
      <CameraView />
      <AROverlay />
      <StatusCapsule />
      <LeftControls />
      <HazardSelectorBar />
      <HazardSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
});
