import React, { useEffect, useRef, useState } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Platform, Dimensions } from 'react-native';
import { Camera, CameraView } from 'expo-camera';

interface CameraBridgeProps {
  active: boolean;
  onFrame: (base64Frame: string) => void;
  frameIntervalMs?: number;
}

export const CameraBridge: React.FC<CameraBridgeProps> = ({
  active,
  onFrame,
  frameIntervalMs = 500, // grabbing every 500ms balances bandwidth and response time
}) => {
  const [hasPermission, setHasPermission] = useState<boolean | null>(
    Platform.OS === 'web' ? true : null
  );
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  
  // Mobile Ref
  const cameraRef = useRef<any>(null);
  
  // Web Ref
  const videoRef = useRef<any>(null);
  const webStreamRef = useRef<MediaStream | null>(null);

  // 1. Request Camera Permissions
  useEffect(() => {
    if (Platform.OS !== 'web') {
      (async () => {
        const { status } = await Camera.requestCameraPermissionsAsync();
        setHasPermission(status === 'granted');
      })();
    }
  }, []);

  // 2a. Web Stream Controller (Avoids infinite loop re-runs by only reacting to active change)
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (active) {
        startWebCamera();
      } else {
        stopWebCamera();
      }
    }
    return () => {
      if (Platform.OS === 'web') {
        stopWebCamera();
      }
    };
  }, [active]);

  // 2b. Mobile Stream Controller
  useEffect(() => {
    if (Platform.OS !== 'web') {
      setIsStreaming(active && hasPermission === true);
    }
  }, [active, hasPermission]);

  // 3. WebRTC Stream Handling
  const startWebCamera = async () => {
    try {
      setErrorMessage('');
      if (typeof window === 'undefined' || !navigator || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera API (getUserMedia) is not supported in this browser or context. Note: Camera access requires a secure context (https:// or localhost/127.0.0.1).");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // prefer back camera on mobile browsers
          width: { ideal: 640 },
          height: { ideal: 480 },
        }
      });
      webStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch((e: any) => console.log("Video play interrupted", e));
      }
      setIsStreaming(true);
      setHasPermission(true);
    } catch (err: any) {
      console.error("Failed to start browser camera:", err);
      setErrorMessage(err.message || String(err));
      setHasPermission(false);
    }
  };

  const stopWebCamera = () => {
    if (webStreamRef.current) {
      webStreamRef.current.getTracks().forEach(track => track.stop());
      webStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsStreaming(false);
  };

  // 4. Frame Grabber Loop (Periodic snapshot extraction)
  useEffect(() => {
    if (!isStreaming || !active) return;

    let intervalId: any;

    if (Platform.OS === 'web') {
      // High frequency frame extraction on web using Offscreen Canvas
      intervalId = setInterval(() => {
        const video = videoRef.current;
        if (video && video.readyState >= 2) { // >= 2 ensures frame data is available
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            // Compress frame into JPEG for fast network delivery
            const dataUrl = canvas.toDataURL('image/jpeg', 0.5);
            onFrame(dataUrl);
          }
        }
      }, frameIntervalMs);
    } else {
      // Mobile frame extraction using expo-camera snapshot
      intervalId = setInterval(async () => {
        if (cameraRef.current && isStreaming) {
          try {
            const photo = await cameraRef.current.takePictureAsync({
              quality: 0.3, // Compressed for mobile network
              base64: true,
              skipProcessing: true, // extremely fast, bypasses normal processing
            });
            if (photo && photo.base64) {
              onFrame(`data:image/jpeg;base64,${photo.base64}`);
            }
          } catch (err) {
            console.log("Error capturing mobile camera frame:", err);
          }
        }
      }, frameIntervalMs);
    }

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isStreaming, active, frameIntervalMs]);

  // 5. Render Layout states
  if (Platform.OS !== 'web') {
    if (hasPermission === null) {
      return (
        <View style={styles.centered}>
          <Text style={styles.statusText}>Requesting camera authorization...</Text>
        </View>
      );
    }

    if (hasPermission === false) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>Camera Access Denied.</Text>
          <Text style={styles.subErrorText}>Please grant camera permissions in settings to utilize hazard overlays.</Text>
        </View>
      );
    }
  }

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' ? (
        <>
          <video
            ref={videoRef}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              backgroundColor: '#05050A',
              transform: 'scaleX(-1)', // Mirrored web preview is natural for users
              display: hasPermission === false ? 'none' : 'block',
            }}
            autoPlay
            playsInline
            muted
          />
          {hasPermission === false && (
            <View style={StyleSheet.absoluteFillObject}>
              <View style={styles.centered}>
                <Text style={styles.errorText}>Camera Access Denied.</Text>
                <Text style={styles.subErrorText}>Please grant camera permissions to utilize hazard overlays.</Text>
                {errorMessage ? (
                  <Text style={styles.errorDetailsText}>Details: {errorMessage}</Text>
                ) : null}
                <TouchableOpacity 
                  style={styles.retryButton} 
                  onPress={() => {
                    setHasPermission(true);
                    startWebCamera();
                  }}
                >
                  <Text style={styles.retryButtonText}>RETRY CAMERA ACCESS</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </>
      ) : (
        // Mobile Render using Expo CameraView
        <CameraView
          ref={cameraRef}
          style={StyleSheet.absoluteFillObject}
          facing="back"
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#05050A',
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0A0A0F',
    padding: 24,
  },
  statusText: {
    color: '#8A8D9F',
    fontSize: 15,
  },
  errorText: {
    color: '#FF3E3E',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subErrorText: {
    color: '#8A8D9F',
    fontSize: 13,
    textAlign: 'center',
  },
  errorDetailsText: {
    color: '#FF7875',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 8,
    backgroundColor: 'rgba(255, 77, 79, 0.08)',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 77, 79, 0.15)',
    maxWidth: '90%',
  },
  retryButton: {
    marginTop: 16,
    backgroundColor: '#0052FF',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  retryButtonText: {
    color: '#FFF',
    fontSize: 12,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
});
