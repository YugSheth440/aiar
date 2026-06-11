import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CameraView as ExpoCameraView, useCameraPermissions } from 'expo-camera';
import { useWorkflowStore } from '../../store/workflowStore';

export function CameraView() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isReady, setIsReady] = useState(false);
  const { facing, torchEnabled, setCameraRef, cameraRef } = useWorkflowStore();

  useEffect(() => {
    return () => {
      setCameraRef(null);
    };
  }, [setCameraRef]);

  useEffect(() => {
    if (!permission?.granted) {
      requestPermission().then(() => setIsReady(true));
    } else {
      setIsReady(true);
    }
  }, [permission?.granted]);

  if (!permission || !isReady) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Requesting Camera…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.text}>Camera permission denied.</Text>
      </View>
    );
  }

  return (
    <ExpoCameraView
      ref={(ref) => {
        if (ref !== cameraRef) {
          setCameraRef(ref);
        }
      }}
      style={StyleSheet.absoluteFill}
      facing={facing}
      // enableTorch keeps the flashlight on continuously as a torch
      enableTorch={torchEnabled}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { color: 'rgba(255,255,255,0.5)', fontSize: 14 },
});
