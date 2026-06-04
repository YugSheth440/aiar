import React, { useEffect, useRef } from 'react';
import { View, StyleSheet, Text, Animated, Platform } from 'react-native';
import Svg, { Rect, Circle, Line, G, Path } from 'react-native-svg';

interface Detection {
  bbox: number[]; // [x_min, y_min, x_max, y_max]
  confidence: number;
  class: number;
  label: string;
}

interface DangerOverlayProps {
  detections: Detection[];
  active: boolean;
  scaleX: number;
  scaleY: number;
}

export const DangerOverlay: React.FC<DangerOverlayProps> = ({
  detections,
  active,
  scaleX,
  scaleY,
}) => {
  // Bouncing alert pulse animation
  const pulseAnim = useRef(new Animated.Value(0.7)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (active) {
      // Loop pulse animation
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.1,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 0.7,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      ).start();

      // Loop slow rotate animation
      Animated.loop(
        Animated.timing(rotateAnim, {
          toValue: 1,
          duration: 4000,
          useNativeDriver: true,
        })
      ).start();
    } else {
      pulseAnim.setValue(0.7);
      rotateAnim.setValue(0);
    }
  }, [active]);

  const spin = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  if (!active || detections.length === 0) return null;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {detections.map((det, index) => {
        const [x1, y1, x2, y2] = det.bbox;
        
        // Scale bounding box coordinates to fit screen layout
        const x = x1 * scaleX;
        const y = y1 * scaleY;
        const w = (x2 - x1) * scaleX;
        const h = (y2 - y1) * scaleY;

        // Correct for the scaleX(-1) mirror video transform on Web browsers
        const viewWidth = 640 * scaleX;
        const finalX = Platform.OS === 'web' ? (viewWidth - x - w) : x;

        const isFire = det.label.toLowerCase() === 'fire' || det.label.toLowerCase() === 'person'; // treating person as fire source for testing/demo
        const threatColor = isFire ? '#0052FF' : '#00C9FF'; // Cobalt Blue for Fire, Electric Cyan for Smoke/Others
        const threatLabel = isFire ? 'FIRE DETECTED' : 'HAZARD TRACKED';

        return (
          <View
            key={index}
            style={[
              styles.boxContainer,
              {
                left: finalX,
                top: y,
                width: w,
                height: h,
              },
            ]}
          >
            {/* 1. Neon SVG Targeting Box and Futuristic HUD Reticles */}
            <Svg width="100%" height="100%" style={styles.svg}>
              {/* Animated Glowing Rect */}
              <Rect
                x="2"
                y="2"
                width={w - 4}
                height={h - 4}
                stroke={threatColor}
                strokeWidth="2.5"
                fill={isFire ? 'rgba(0, 82, 255, 0.03)' : 'rgba(0, 201, 255, 0.03)'}
                strokeDasharray="15, 10"
              />

              {/* Reticle corners */}
              {/* Top Left */}
              <Path d="M 2,25 L 2,2 L 25,2" stroke={threatColor} strokeWidth="5" fill="none" />
              {/* Top Right */}
              <Path d={`M ${w-25},2 L ${w-2},2 L ${w-2},25`} stroke={threatColor} strokeWidth="5" fill="none" />
              {/* Bottom Left */}
              <Path d={`M 2,${h-25} L 2,${h-2} L 25,${h-2}`} stroke={threatColor} strokeWidth="5" fill="none" />
              {/* Bottom Right */}
              <Path d={`M ${w-25},${h-2} L ${w-2},${h-2} L ${w-2},${h-25}`} stroke={threatColor} strokeWidth="5" fill="none" />

              {/* Scanning Laser Line (Simulation) */}
              <Line
                x1="2"
                y1={h / 2}
                x2={w - 2}
                y2={h / 2}
                stroke={threatColor}
                strokeWidth="1.5"
                opacity="0.7"
              />
            </Svg>

            {/* 2. Cybernetic AR Telemetry Tags */}
            <View style={[styles.hudTextContainer, { borderColor: threatColor }]}>
              <View style={[styles.hudHeader, { backgroundColor: threatColor }]}>
                <Text style={styles.hudTitle}>{threatLabel}</Text>
              </View>
              <View style={styles.hudBody}>
                <Text style={styles.hudText}>ID: #HZ-{Math.floor(det.confidence * 10000)}</Text>
                <Text style={styles.hudText}>CLASS: {det.label.toUpperCase()}</Text>
                <Text style={styles.hudText}>CONF: {(det.confidence * 100).toFixed(1)}%</Text>
                <Text style={styles.hudText}>SYS_LEVEL: CRITICAL</Text>
              </View>
            </View>

            {/* 3. Floating 3D Sci-Fi Hologram Overlay */}
            <View style={styles.hologramContainer}>
              <Animated.View
                style={[
                  styles.holoRing,
                  {
                    borderColor: threatColor,
                    transform: [{ rotate: spin }, { scale: pulseAnim }],
                  },
                ]}
              >
                {/* 3D Holographic Triangular Alert */}
                <Svg width="40" height="40" viewBox="0 0 100 100">
                  <G transform="translate(0, 5)">
                    <Path
                      d="M 50,10 L 90,85 L 10,85 Z"
                      fill="none"
                      stroke={threatColor}
                      strokeWidth="6"
                      strokeLinejoin="round"
                    />
                    <Text
                      x="50"
                      y="70"
                      fill={threatColor}
                      fontSize="35"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      !
                    </Text>
                  </G>
                </Svg>
              </Animated.View>
            </View>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  boxContainer: {
    position: 'absolute',
    borderWidth: 0,
  },
  svg: {
    position: 'absolute',
    left: 0,
    top: 0,
  },
  hudTextContainer: {
    position: 'absolute',
    left: '102%',
    top: 0,
    width: 140,
    borderWidth: 1.5,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  hudHeader: {
    paddingVertical: 3,
    paddingHorizontal: 6,
  },
  hudTitle: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '900',
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  hudBody: {
    padding: 6,
    gap: 2,
  },
  hudText: {
    color: '#334155',
    fontSize: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    fontWeight: 'bold',
  },
  hologramContainer: {
    position: 'absolute',
    top: -65,
    left: '50%',
    marginLeft: -25,
    width: 50,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  holoRing: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 82, 255, 0.08)',
    shadowColor: '#0052FF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 8,
  },
});
