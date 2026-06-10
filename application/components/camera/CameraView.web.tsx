import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

/**
 * Web stub for CameraView.
 * react-native-vision-camera is native-only and cannot run in a browser.
 * This file is automatically selected by Metro on the web platform
 * because of the `.web.tsx` extension.
 */
export function CameraView() {
  return (
    <View style={styles.container}>
      <Text style={styles.icon}>📷</Text>
      <Text style={styles.title}>Camera Unavailable</Text>
      <Text style={styles.subtitle}>
        Live camera feed is only available on the mobile app.{'\n'}
        Open in Expo Go on your device to use the camera.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  icon: {
    fontSize: 64,
  },
  title: {
    color: '#e2e8f0',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: '#64748b',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
});
