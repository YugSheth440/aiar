import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  Dimensions,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  withSpring,
  FadeInLeft,
  interpolate,
  Extrapolation,
} from 'react-native-reanimated';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import * as ScreenOrientation from 'expo-screen-orientation';
import {
  RefreshCcw,
  Flashlight,
  Smartphone,
  ScanLine,
  Zap,
} from 'lucide-react-native';
import { useWorkflowStore } from '../../store/workflowStore';
import { MOCK_HAZARDS } from '../../src/mockData';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BACKEND_URL } from '../../src/config';
import type { Hazard } from '../../src/types';

// ── Premium iOS-style glass button ─────────────────────────────
function GlassBtn({
  onPress,
  children,
  size = 48,
  tintColor,
  active,
  disabled,
}: {
  onPress: () => void;
  children: React.ReactNode;
  size?: number;
  tintColor?: string;
  active?: boolean;
  disabled?: boolean;
}) {
  const scale = useSharedValue(1);
  const pressOp = useSharedValue(1);

  const handlePress = async () => {
    if (disabled) return;
    scale.value = withSequence(
      withTiming(0.84, { duration: 90 }),
      withSpring(1, { damping: 10, stiffness: 280 })
    );
    pressOp.value = withSequence(withTiming(0.7, { duration: 90 }), withTiming(1, { duration: 120 }));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: pressOp.value,
  }));

  return (
    <Pressable onPress={handlePress} hitSlop={8}>
      <Animated.View style={[styles.btnWrap, { width: size, height: size, borderRadius: size / 2 }, animStyle]}>
        <BlurView
          intensity={85}
          tint="dark"
          style={[
            styles.btnBlur,
            { borderRadius: size / 2 },
            active && tintColor
              ? {
                  backgroundColor: `${tintColor}28`,
                  borderColor: `${tintColor}55`,
                }
              : {},
          ]}
        >
          {children}
        </BlurView>
      </Animated.View>
    </Pressable>
  );
}

// ── Premium Scan button ─────────────────────────────────────────
function ScanBtn() {
  const {
    workflowState,
    startAnalysis,
    onHazardsDiscovered,
    cameraRef,
    reset,
  } = useWorkflowStore();

  const isAnalyzing = workflowState === 'ANALYZING';

  const bgColor =
    workflowState === 'HAZARD_FOCUSED' || workflowState === 'SHEET_OPEN'
      ? '#d32f2f'
      : workflowState === 'HAZARDS_DISCOVERED'
      ? '#e65100'
      : '#1565c0';

  const glowColor =
    workflowState === 'HAZARD_FOCUSED' || workflowState === 'SHEET_OPEN'
      ? '#ef4444'
      : workflowState === 'HAZARDS_DISCOVERED'
      ? '#fb923c'
      : '#3b82f6';

  const pulseScale = useSharedValue(1);
  const glowOp = useSharedValue(0);
  const rotation = useSharedValue(0);

  useEffect(() => {
    if (isAnalyzing) {
      rotation.value = withRepeat(withTiming(360, { duration: 1800 }), -1);
      pulseScale.value = withRepeat(
        withSequence(withTiming(1.1, { duration: 700 }), withTiming(1, { duration: 700 })),
        -1,
        true
      );
      glowOp.value = withRepeat(
        withSequence(withTiming(0.8, { duration: 700 }), withTiming(0.2, { duration: 700 })),
        -1,
        true
      );
    } else {
      rotation.value = withTiming(0, { duration: 400 });
      pulseScale.value = withSpring(1, { damping: 12 });
      glowOp.value = withTiming(0.35, { duration: 400 });
    }
  }, [isAnalyzing]);

  const btnScale = useSharedValue(1);
  const scanBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: withSpring(pulseScale.value, { damping: 10 }) }],
  }));
  const rotStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));
  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOp.value,
  }));

  const handlePress = async () => {
    if (isAnalyzing) return;
    btnScale.value = withSequence(withTiming(0.88, { duration: 90 }), withSpring(1, { damping: 10 }));
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    startAnalysis();

    try {
      let base64Image = '';
      let photoUri = '';
      
      if (cameraRef) {
        // Capture frame from the mobile camera
        const photo = await cameraRef.takePictureAsync({
          base64: true,
          quality: 0.5,
          skipProcessing: true,
        });
        base64Image = photo.base64 || '';
        photoUri = photo.uri || '';
      }

      if (!cameraRef) {
        // Fallback: If no camera (e.g. running on web simulator), fallback to Mock Hazards
        console.warn('Camera reference is not registered (Web/Sim). Using MOCK_HAZARDS fallback.');
        setTimeout(async () => {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          onHazardsDiscovered(MOCK_HAZARDS);
        }, 3000);
        return;
      }

      // Create FormData
      const formData = new FormData();
      if (Platform.OS === 'web') {
        if (!base64Image) {
          throw new Error('No base64 image captured on web');
        }
        const byteCharacters = atob(base64Image);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/jpeg' });
        formData.append('file', blob, 'photo.jpg');
      } else {
        if (photoUri) {
          formData.append('file', {
            uri: photoUri,
            name: 'photo.jpg',
            type: 'image/jpeg',
          } as any);
        } else if (base64Image) {
          const byteCharacters = atob(base64Image);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'image/jpeg' });
          formData.append('file', blob, 'photo.jpg');
        } else {
          throw new Error('Failed to capture image');
        }
      }

      // Call FastAPI /detect endpoint
      const response = await fetch(`${BACKEND_URL}/detect`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Server returned status: ${response.status}`);
      }

      const data = await response.json();
      const detections = data.detections || [];
      const caption = data.caption || '';
      const analysis = data.analysis || { actions: [], priority: 'low', threat_level: 'safe' };

      // Map detections/analysis to Hazard[]
      const mappedHazards: Hazard[] = detections.map((det: any, index: number) => {
        const label = det.label || 'object';
        const confidence = Math.round((det.confidence || 1.0) * 100);
        const normBbox = det.normalized_bbox || [0.1, 0.1, 0.9, 0.9]; // [xmin, ymin, xmax, ymax]
        
        // Map bbox to percentages for AROverlay
        const left = `${(normBbox[0] * 100).toFixed(1)}%`;
        const top = `${(normBbox[1] * 100).toFixed(1)}%`;
        const width = `${((normBbox[2] - normBbox[0]) * 100).toFixed(1)}%`;
        const height = `${((normBbox[3] - normBbox[1]) * 100).toFixed(1)}%`;

        // Map threat level
        let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'LOW';
        const level = (analysis.threat_level || 'safe').toLowerCase();
        if (level === 'critical') riskLevel = 'CRITICAL';
        else if (level === 'warning') riskLevel = 'HIGH';
        else if (level === 'safe') riskLevel = 'LOW';
        else riskLevel = 'MEDIUM';

        // Map actions to ActionStep[]
        const actionSteps = (analysis.actions || []).map((actStr: string, actIdx: number) => ({
          id: `act-${index}-${actIdx}`,
          stepNumber: actIdx + 1,
          icon: actIdx === 0 ? 'shield-alert' : actIdx === 1 ? 'zap-off' : 'search',
          title: actStr,
          subtitle: actIdx === 0 ? 'Urgent precaution' : 'Safety action',
          isCritical: actIdx === 0 && (riskLevel === 'CRITICAL' || riskLevel === 'HIGH'),
          estimatedTime: actIdx === 0 ? '~30 sec' : '~2 min',
        }));

        // Simulated sensor reading (temp in °F) for visual UI
        let reading = '72.5';
        if (label === 'fire') reading = '185.2';
        else if (label === 'smoke') reading = '110.4';
        else if (label === 'overheating' || label === 'panel') reading = '98.9';

        return {
          id: `hz-${Date.now()}-${index}`,
          title: `${label.charAt(0).toUpperCase() + label.slice(1)} Detected`,
          subtitle: caption ? caption.slice(0, 50) + '...' : `Threat: ${analysis.threat_level || 'low'}`,
          riskLevel,
          confidence,
          component: label.charAt(0).toUpperCase() + label.slice(1),
          reading,
          readingUnit: '°F',
          description: caption || `A ${label} was detected in the environment.`,
          reason: `Pixtral identified ${label} at coordinate boundary.`,
          whyItMatters: caption || `The detected ${label} poses a potential safety risk.`,
          tags: [label.toUpperCase(), (analysis.priority || 'low').toUpperCase()],
          boundingBox: { top, left, width, height },
          actions: actionSteps.length > 0 ? actionSteps : [
            {
              id: `act-fallback-${index}`,
              stepNumber: 1,
              icon: 'shield-alert',
              title: 'Exercise caution',
              subtitle: 'Avoid close proximity',
              isCritical: false,
            }
          ],
        };
      });

      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      onHazardsDiscovered(mappedHazards);

    } catch (error) {
      console.error('Scan and detection pipeline failed:', error);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      reset();
    }
  };

  return (
    <Pressable onPress={handlePress} disabled={isAnalyzing}>
      <Animated.View style={[styles.scanWrapper, scanBtnStyle]}>
        {/* Ambient glow ring */}
        <Animated.View
          style={[
            styles.scanGlow,
            { backgroundColor: glowColor, shadowColor: glowColor },
            glowStyle,
          ]}
          pointerEvents="none"
        />

        {/* Button body */}
        <View style={[styles.scanBody, { backgroundColor: bgColor }]}>
          {/* Inner highlight for depth */}
          <View style={styles.scanHighlight} />

          {/* Icon */}
          <Animated.View style={rotStyle}>
            {isAnalyzing ? (
              <ScanLine color="#fff" size={24} strokeWidth={2} />
            ) : (
              <ScanLine color="#fff" size={24} strokeWidth={2} />
            )}
          </Animated.View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

// ── Screen rotate — uses expo-screen-orientation ──────────────────────
function RotateBtn() {
  const { setLandscape, isLandscape } = useWorkflowStore();

  const handlePress = async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newIsLandscape = !isLandscape;
    setLandscape(newIsLandscape);
    
    try {
      if (newIsLandscape) {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE_RIGHT);
      } else {
        await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      }
    } catch (e) {
      console.warn('Rotation lock failed:', e);
    }
  };

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: withTiming(isLandscape ? '90deg' : '0deg', { duration: 300 }) }],
  }));

  return (
    <GlassBtn onPress={handlePress} size={48}>
      <Animated.View style={animStyle}>
        <Smartphone color="rgba(255,255,255,0.88)" size={19} strokeWidth={2.2} />
      </Animated.View>
    </GlassBtn>
  );
}

// ── Main export ─────────────────────────────────────────────────
export function LeftControls() {
  const { toggleFacing, toggleTorch, torchEnabled, sheetSnapIndex } = useWorkflowStore();
  const insets = useSafeAreaInsets();

  // Hide left controls completely when sheet is expanded (snap index >= 1)
  // to prevent overlapping the bottom panel card.
  const isHidden = sheetSnapIndex >= 1;
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withTiming(isHidden ? 0 : 1, { duration: 250 });
  }, [isHidden]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: withTiming(isHidden ? -50 : 0, { duration: 250 }) }],
  }));

  return (
    <Animated.View
      entering={FadeInLeft.delay(200).springify().damping(20)}
      style={[styles.container, { top: insets.top + 60 }, containerStyle]}
      pointerEvents={isHidden ? 'none' : 'box-none'}
    >
      {/* ── Camera flip ── */}
      <GlassBtn onPress={toggleFacing} size={48}>
        <RefreshCcw color="rgba(255,255,255,0.88)" size={19} strokeWidth={2.2} />
      </GlassBtn>

      {/* ── Flash / Torch ── */}
      <GlassBtn
        onPress={toggleTorch}
        size={48}
        tintColor="#fbbf24"
        active={torchEnabled}
      >
        <Zap
          color={torchEnabled ? '#fbbf24' : 'rgba(255,255,255,0.88)'}
          size={19}
          strokeWidth={2.2}
          fill={torchEnabled ? '#fbbf24' : 'none'}
        />
      </GlassBtn>

      {/* ── Screen rotate ── */}
      <RotateBtn />

      {/* ── Separator ── */}
      <View style={styles.sep} />

      {/* ── Scan button ── */}
      <ScanBtn />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    zIndex: 80,
    gap: 10,
    alignItems: 'center',
  },

  // ── Glass icon button ──
  btnWrap: {
    overflow: 'hidden',
    // Deep shadow for depth / lifted look
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  btnBlur: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(28,28,32,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    // Inner top highlight for iOS glass look
    overflow: 'hidden',
  },

  // ── Scan button ──
  sep: {
    width: 30,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    marginVertical: 2,
  },
  scanWrapper: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanGlow: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 16,
    elevation: 12,
  },
  scanBody: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
    overflow: 'hidden',
    // Deep shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 14,
  },
  scanHighlight: {
    // Top specular highlight for glass/3D depth
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '45%',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
  },
});
