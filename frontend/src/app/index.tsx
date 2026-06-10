import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Switch,
  Platform,
  Vibration,
  ActivityIndicator,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraBridge } from '../components/CameraBridge';
import { DangerOverlay } from '../components/DangerOverlay';

interface Detection {
  bbox: number[];
  confidence: number;
  class: number;
  label: string;
}

interface LogEntry {
  id: string;
  time: string;
  type: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

export default function HomeScreen() {
  // Connection states
  const [ipAddress, setIpAddress] = useState<string>('localhost');
  const [port, setPort] = useState<string>('8000');
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isConnecting, setIsConnecting] = useState<boolean>(false);
  const [wsUrl, setWsUrl] = useState<string>('ws://localhost:8000/ws');
  
  // State for AI safety recommendations
  const [hazards, setHazards] = useState<string[]>([]);
  const [nonHazards, setNonHazards] = useState<string[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  
  // Camera & Stream control states
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [fps, setFps] = useState<number>(0);
  const [latency, setLatency] = useState<number>(0);
  const [activeModel, setActiveModel] = useState<string>('Searching...');
  
  // Console logging state
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: '1', time: '11:57:00', type: 'info', message: 'Hazard Core UI initialized.' },
    { id: '2', time: '11:57:02', type: 'info', message: 'Camera bridge loaded in browser container.' }
  ]);
  
  // System control toggles
  const [audioAlertEnabled, setAudioAlertEnabled] = useState<boolean>(true);
  const [falseAlarmFilter, setFalseAlarmFilter] = useState<boolean>(true);
  
  // Layout scaling measurements
  const [viewportWidth, setViewportWidth] = useState<number>(640);
  const [viewportHeight, setViewportHeight] = useState<number>(480);

  const socketRef = useRef<WebSocket | null>(null);
  const lastFrameTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const fpsTimerRef = useRef<any>(null);
  const isWaitingForFrameResponseRef = useRef<boolean>(false);

  // Auto-fill network IP for development
  useEffect(() => {
    if (Platform.OS !== 'web') {
      // If testing on a physical phone, localhost won't work, so help remind the user to put their local PC IP address
      addLog('warn', 'Mobile client detected. Configure backend IP to match your developer PC local IPv4 address (e.g. 192.168.1.XX)');
    }
  }, []);

  // System logs function
  const addLog = (type: 'info' | 'warn' | 'error' | 'success', message: string) => {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
    setLogs(prev => [
      { id: Date.now().toString() + Math.random().toString(), time: timeStr, type, message },
      ...prev.slice(0, 49) // Keep last 50 entries
    ]);
  };

  // FPS and Metrics calculation timer
  useEffect(() => {
    fpsTimerRef.current = setInterval(() => {
      setFps(frameCountRef.current);
      frameCountRef.current = 0;
    }, 1000);

    return () => {
      if (fpsTimerRef.current) clearInterval(fpsTimerRef.current);
    };
  }, []);

  // Poll /analyze endpoint for Groq response recommendations
  useEffect(() => {
    let interval: any = null;

    const fetchAnalysis = async () => {
      if (!isConnected) return;
      try {
        setIsAnalyzing(true);
        const res = await fetch(`http://${ipAddress}:${port}/analyze`);
        const data = await res.json();
        if (data.status === 'success') {
          setHazards(data.hazards || []);
          setNonHazards(data.non_hazards || []);
          setActions(data.actions || []);
        }
      } catch (err) {
        console.error("Error fetching safety analysis:", err);
      } finally {
        setIsAnalyzing(false);
      }
    };

    if (isConnected) {
      fetchAnalysis();
      interval = setInterval(fetchAnalysis, 4000);
    } else {
      setHazards([]);
      setNonHazards([]);
      setActions([]);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isConnected, ipAddress, port]);

  // WebSocket Connection controller
  const toggleConnection = () => {
    if (isConnected || isConnecting) {
      disconnectBackend();
    } else {
      connectBackend();
    }
  };

  const connectBackend = () => {
    const url = `ws://${ipAddress}:${port}/ws`;
    setWsUrl(url);
    setIsConnecting(true);
    addLog('info', `Establishing telemetry link to ${url}...`);

    try {
      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        isWaitingForFrameResponseRef.current = false;
        setIsConnected(true);
        setIsConnecting(false);
        addLog('success', 'Telemetry connection established successfully.');
        
        // Reset the backend CSV database logs at the start of a session
        fetch(`http://${ipAddress}:${port}/reset`, { method: 'POST' })
          .then(res => res.json())
          .then(data => {
            if (data.status === 'success') {
              addLog('info', 'Active session telemetry logs cleared / reset.');
            }
          })
          .catch(err => {
            console.error("Failed to reset session logs:", err);
          });
        
        // Fetch health stats from REST
        fetch(`http://${ipAddress}:${port}/`)
          .then(res => res.json())
          .then(data => {
            if (data.model) setActiveModel(data.model);
            addLog('info', `Active backend model verified: ${data.model || 'Unknown'}`);
          })
          .catch(() => {
            setActiveModel('YOLO API v8');
          });
      };

      socket.onmessage = (event) => {
        isWaitingForFrameResponseRef.current = false;
        try {
          const data = JSON.parse(event.data);
          
          if (data.detections) {
            let receivedDetections = data.detections as Detection[];
            
            // Apply false alarm mitigation threshold if filter toggle is active
            if (falseAlarmFilter) {
              receivedDetections = receivedDetections.filter(d => d.confidence > 0.45);
            }

            setDetections(receivedDetections);
            frameCountRef.current += 1;

            // Compute packet latency
            if (lastFrameTimeRef.current > 0) {
              setLatency(Date.now() - lastFrameTimeRef.current);
            }
            lastFrameTimeRef.current = Date.now();

            // Threat mitigation triggers
            if (receivedDetections.length > 0) {
              const fireCount = receivedDetections.filter(d => d.label.toLowerCase() === 'fire' || d.label.toLowerCase() === 'person').length;
              if (fireCount > 0) {
                addLog('warn', `ALERT: Fire/Hazard threat vector locks active: ${fireCount} targets.`);
                if (audioAlertEnabled) {
                  triggerHardwareAlert();
                }
              }
            }
          }
          
          // Handle Groq analysis from WebSocket
          if (data.analysis && data.analysis.actions) {
            setActions(data.analysis.actions || []);
            addLog('info', `Safety Analysis: Threat Level ${data.analysis.threat_level?.toUpperCase() || 'UNKNOWN'} - Priority ${data.analysis.priority?.toUpperCase() || 'UNKNOWN'}`);
          }
        } catch (err) {
          console.error("Error decoding websocket frame payload:", err);
        }
      };

      socket.onerror = (err) => {
        isWaitingForFrameResponseRef.current = false;
        console.error("Telemetry link error:", err);
        addLog('error', 'Telemetry link connection failure occurred.');
      };

      socket.onclose = () => {
        isWaitingForFrameResponseRef.current = false;
        setIsConnected(false);
        setIsConnecting(false);
        setDetections([]);
        addLog('warn', 'Telemetry connection severed.');
      };

    } catch (err: any) {
      setIsConnecting(false);
      setIsConnected(false);
      addLog('error', `Socket initiation failure: ${err.message}`);
    }
  };

  const disconnectBackend = () => {
    isWaitingForFrameResponseRef.current = false;
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
    setDetections([]);
  };

  // Hardware Haptic / audio warning triggers
  const triggerHardwareAlert = () => {
    if (Platform.OS !== 'web') {
      Vibration.vibrate([100, 150, 100]); // Pulse vibrate
    }
  };

  // Feed Frame Framebuffer Streamer callback
  const handleFrameCaptured = (base64Frame: string) => {
    if (isWaitingForFrameResponseRef.current) {
      return; // Skip frame if we are still waiting for backend response
    }
    if (socketRef.current && socketRef.current.readyState === WebSocket.OPEN) {
      isWaitingForFrameResponseRef.current = true;
      // Send raw base64 frame directly to WebSocket
      socketRef.current.send(base64Frame);
    }
  };

  // Trigger diagnostic REST-based test frame detection
  const runDiagnosticsTest = async () => {
    addLog('info', 'Executing REST diagnostics loop test on /detect...');
    
    // Create an offscreen white box simulation frame
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0,0,100,100);
      
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        const formData = new FormData();
        formData.append('file', blob, 'test_frame.jpg');
        
        try {
          const res = await fetch(`http://${ipAddress}:${port}/detect`, {
            method: 'POST',
            body: formData,
          });
          const data = await res.json();
          addLog('success', `Diagnostics loop healthy. Detections returned: ${JSON.stringify(data.detections || [])}`);
        } catch (err: any) {
          addLog('error', `Diagnostics endpoint failure: ${err.message}`);
        }
      }, 'image/jpeg');
    }
  };

  const handleLayoutChange = (event: any) => {
    const { width, height } = event.nativeEvent.layout;
    setViewportWidth(width);
    setViewportHeight(height);
  };

  // Derived threat stats
  const isThreatActive = detections.length > 0;
  const activeThreatColor = isThreatActive ? '#0052FF' : '#0052FF';

  return (
    <SafeAreaView style={styles.container}>
      {/* HEADER BANNER */}
      <View style={styles.header}>
        <View style={styles.titleGroup}>
          <Text style={styles.title}>ANTIGRAVITY <Text style={styles.subTitle}>HAZARD HUD</Text></Text>
          <Text style={styles.modelTag}>YOLO INF: <Text style={{ color: '#0052FF' }}>{activeModel}</Text></Text>
        </View>
        <View style={[
          styles.statusIndicator, 
          { 
            backgroundColor: isConnected ? 'rgba(5, 199, 126, 0.08)' : isConnecting ? 'rgba(255, 204, 0, 0.08)' : 'rgba(138, 141, 159, 0.08)',
            borderColor: isConnected ? 'rgba(5, 199, 126, 0.25)' : isConnecting ? 'rgba(255, 204, 0, 0.25)' : 'rgba(138, 141, 159, 0.25)',
            borderWidth: 1,
          }
        ]}>
          <Text style={[
            styles.statusIndicatorText,
            { color: isConnected ? '#05C77E' : isConnecting ? '#FFCC00' : '#8A8D9F' }
          ]}>
            {isConnected ? 'LIVE FEED ACTIVE' : isConnecting ? 'LINKING...' : 'OFFLINE'}
          </Text>
        </View>
      </View>

      {/* DASHBOARD GRID CONTENT */}
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.mainGrid}>
          
          {/* COLUMN 1: LIVE VIEWER CONTAINER */}
          <View style={styles.viewerColumn}>
            <View 
              style={[
                styles.viewerWrapper, 
                isThreatActive && { borderColor: '#0052FF', borderWidth: 2, shadowColor: '#0052FF', shadowRadius: 15 }
              ]} 
              onLayout={handleLayoutChange}
            >
              {/* Camera view */}
              <CameraBridge 
                active={isCameraActive && isConnected} 
                onFrame={handleFrameCaptured} 
                frameIntervalMs={3000} // Fetch browser camera frame every 3000ms
              />

              {/* Glowing Dynamic SVG Bounding Box and 3D Hologram Overlay */}
              <DangerOverlay
                detections={detections}
                active={isThreatActive}
                scaleX={viewportWidth / 640} // Scaled to actual layout aspect width
                scaleY={viewportHeight / 480} // Scaled to actual layout aspect height
              />

              {/* Viewfinder Reticles when offline */}
              {(!isCameraActive || !isConnected) && (
                <View style={styles.cameraPlaceholder}>
                  <Text style={styles.placeholderTitle}>TELEMETRY STREAM INACTIVE</Text>
                  <Text style={styles.placeholderDesc}>Connect telemetry and engage camera stream to start spatial analysis.</Text>
                  <TouchableOpacity 
                    style={[styles.primaryButton, { marginTop: 16 }]} 
                    onPress={() => {
                      if(!isConnected) connectBackend();
                      setIsCameraActive(true);
                    }}
                  >
                    <Text style={styles.buttonText}>AUTO-ENGAGE HUD</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Threat Indicator Tag */}
              {isThreatActive && (
                <View style={styles.alertBar}>
                  <Text style={styles.alertText}>🚨 ALERT: ACTIVE HAZARD ENVELOPE DETECTED 🚨</Text>
                </View>
              )}
            </View>

            {/* REAL-TIME SYSTEM TELEMETRY STRIP */}
            <View style={styles.telemetryStrip}>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>STREAM RATE</Text>
                <Text style={[styles.metricValue, { color: isConnected ? '#05C77E' : '#FF4D4F' }]}>
                  {fps} FPS
                </Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>RTT LATENCY</Text>
                <Text style={[styles.metricValue, { color: latency < 100 ? '#05C77E' : '#FFCC00' }]}>
                  {latency} ms
                </Text>
              </View>
              <View style={styles.metric}>
                <Text style={styles.metricLabel}>TARGET CONFLICTS</Text>
                <Text style={[styles.metricValue, { color: isThreatActive ? '#0052FF' : '#64748B' }]}>
                  {detections.length} ACTIVE
                </Text>
              </View>
            </View>

            {/* PANEL: AI EMERGENCY ADVISOR */}
            <View style={styles.glassPanel}>
              <View style={styles.advisorHeader}>
                <View style={styles.advisorTitleGroup}>
                  <View style={[
                    styles.pulseDot,
                    { backgroundColor: isThreatActive ? '#FF3E3E' : '#05C77E' }
                  ]} />
                  <Text style={[styles.panelTitle, { marginBottom: 0 }]}>AI EMERGENCY RESPONSE ADVISOR</Text>
                </View>
                {isAnalyzing && (
                  <ActivityIndicator size="small" color="#0052FF" style={{ marginRight: 8 }} />
                )}
              </View>

              {/* Hazards and Context Badges */}
              <View style={styles.badgeContainer}>
                {/* Active Hazards */}
                <View style={styles.badgeSection}>
                  <Text style={styles.badgeSectionTitle}>ACTIVE THREATS</Text>
                  <View style={styles.badgeList}>
                    {hazards.length === 0 ? (
                      <Text style={styles.emptyBadgeText}>None detected</Text>
                    ) : (
                      hazards.map((h, i) => (
                        <View key={`h-${i}`} style={styles.hazardBadge}>
                          <Text style={styles.hazardBadgeText}>{h.toUpperCase()}</Text>
                        </View>
                      ))
                    )}
                  </View>
                </View>

                {/* Available Objects */}
                <View style={[styles.badgeSection, { borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.06)', paddingLeft: 16 }]}>
                  <Text style={styles.badgeSectionTitle}>ENVIRONMENT OBJECTS</Text>
                  <View style={styles.badgeList}>
                    {nonHazards.length === 0 ? (
                      <Text style={styles.emptyBadgeText}>None detected</Text>
                    ) : (
                      nonHazards.map((nh, i) => (
                        <View key={`nh-${i}`} style={styles.objectBadge}>
                          <Text style={styles.objectBadgeText}>{nh}</Text>
                        </View>
                      ))
                    )}
                  </View>
                </View>
              </View>

              <View style={styles.divider} />

              {/* Safety Action Steps */}
              <View style={styles.actionsContainer}>
                <Text style={styles.actionsTitle}>RECOMMENDED MITIGATION ACTIONS (REAL-TIME)</Text>
                {actions.length === 0 ? (
                  <View style={styles.noActionsBox}>
                    <Text style={styles.noActionsText}>
                      System monitoring. Standing by for hazard response recommendations.
                    </Text>
                  </View>
                ) : (
                  <View style={styles.actionsList}>
                    {actions.map((action, i) => (
                      <View key={`act-${i}`} style={styles.actionItem}>
                        <View style={styles.actionNumberBox}>
                          <Text style={styles.actionNumberText}>{i + 1}</Text>
                        </View>
                        <Text style={styles.actionText}>{action}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            </View>

          </View>

          {/* COLUMN 2: OPERATIONS PANEL */}
          <View style={styles.controlsColumn}>
            
            {/* PANEL A: TELEMETRY CONNECTION CONTROLS */}
            <View style={styles.glassPanel}>
              <Text style={styles.panelTitle}>TELEMETRY LINK SETUP</Text>
              <View style={styles.formRow}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>SERVER IP</Text>
                  <TextInput
                    style={styles.textInput}
                    value={ipAddress}
                    onChangeText={setIpAddress}
                    placeholder="localhost"
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <View style={[styles.inputGroup, { flex: 0.4 }]}>
                  <Text style={styles.inputLabel}>PORT</Text>
                  <TextInput
                    style={styles.textInput}
                    value={port}
                    onChangeText={setPort}
                    placeholder="8000"
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                  />
                </View>
              </View>
              
              <TouchableOpacity
                style={[
                  styles.connectionBtn,
                  isConnected ? styles.disconnectBtn : isConnecting ? styles.connectingBtn : styles.connectBtn
                ]}
                onPress={toggleConnection}
                disabled={isConnecting}
              >
                {isConnecting ? (
                  <ActivityIndicator size="small" color="#FFCC00" />
                ) : (
                  <Text style={[
                    styles.connectBtnText,
                    { color: isConnected ? '#FF4D4F' : isConnecting ? '#FFCC00' : '#0052FF' }
                  ]}>
                    {isConnected ? 'DISENGAGE TELEMETRY' : 'ENGAGE TELEMETRY'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            {/* PANEL B: MISSION CONTROL TOGGLES */}
            <View style={styles.glassPanel}>
              <Text style={styles.panelTitle}>STREAM CONTROLS</Text>
              
              <View style={styles.toggleRow}>
                <View>
                  <Text style={styles.toggleLabel}>Camera Feed Active</Text>
                  <Text style={styles.toggleDesc}>Engages camera capture hardware.</Text>
                </View>
                <Switch
                  value={isCameraActive}
                  onValueChange={setIsCameraActive}
                  trackColor={{ false: '#26293B', true: '#00F2FE' }}
                  thumbColor="#FFF"
                  disabled={!isConnected}
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.toggleRow}>
                <View>
                  <Text style={styles.toggleLabel}>Haptic Alarm System</Text>
                  <Text style={styles.toggleDesc}>Triggers hardware alert states.</Text>
                </View>
                <Switch
                  value={audioAlertEnabled}
                  onValueChange={setAudioAlertEnabled}
                  trackColor={{ false: '#26293B', true: '#00F2FE' }}
                  thumbColor="#FFF"
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.toggleRow}>
                <View>
                  <Text style={styles.toggleLabel}>False Alarm Filter</Text>
                  <Text style={styles.toggleDesc}>Throttles sensitive confidence locks.</Text>
                </View>
                <Switch
                  value={falseAlarmFilter}
                  onValueChange={setFalseAlarmFilter}
                  trackColor={{ false: '#26293B', true: '#00F2FE' }}
                  thumbColor="#FFF"
                />
              </View>
            </View>

            {/* PANEL C: LOGGING CONSOLE TERMINAL */}
            <View style={[styles.glassPanel, { flex: 1, minHeight: 200 }]}>
              <View style={styles.consoleHeader}>
                <Text style={styles.panelTitle}>TELEMETRY LOG TERMINAL</Text>
                <TouchableOpacity onPress={runDiagnosticsTest} disabled={!isConnected}>
                  <Text style={[styles.diagnosticsBtnText, { color: isConnected ? '#00F2FE' : '#4E5164' }]}>
                    RUN DIAG
                  </Text>
                </TouchableOpacity>
              </View>
              <ScrollView 
                style={styles.consoleBody} 
                contentContainerStyle={{ paddingBottom: 8 }}
                showsVerticalScrollIndicator={true}
              >
                {logs.map((log) => {
                  const logColor = log.type === 'warn' ? '#FFA940' : log.type === 'error' ? '#F5222D' : log.type === 'success' ? '#05C77E' : '#94A3B8';
                  return (
                    <View key={log.id} style={styles.logLine}>
                      <Text style={styles.logTime}>[{log.time}]</Text>
                      <Text style={[styles.logMessage, { color: logColor }]}> {log.message}</Text>
                    </View>
                  );
                })}
              </ScrollView>
            </View>

          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F7FA', // Off-white premium background
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderColor: '#E2E8F0', // clean slate border
    backgroundColor: '#FFFFFF',
  },
  titleGroup: {
    gap: 2,
  },
  title: {
    color: '#0F172A', // Slate 900
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
  },
  subTitle: {
    color: '#0052FF', // Electric Cobalt Blue
    fontWeight: '900',
  },
  modelTag: {
    color: '#64748B', // Slate 500
    fontSize: 10,
    fontWeight: 'bold',
  },
  statusIndicator: {
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  statusIndicatorText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  scrollContent: {
    padding: 16,
    flexGrow: 1,
  },
  mainGrid: {
    flex: 1,
    flexDirection: Platform.OS === 'web' && Dimensions.get('window').width > 800 ? 'row' : 'column',
    gap: 16,
  },
  viewerColumn: {
    flex: 1.4,
    gap: 16,
  },
  controlsColumn: {
    flex: 1,
    gap: 16,
  },
  viewerWrapper: {
    aspectRatio: 1.333, // Standard 4:3 camera aspect ratio
    backgroundColor: '#0A0B10', // Dark camera viewer box retains professional focus
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    position: 'relative',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
  },
  cameraPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F8FAFC',
    padding: 32,
  },
  placeholderTitle: {
    color: '#64748B',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 8,
  },
  placeholderDesc: {
    color: '#94A3B8',
    fontSize: 12,
    textAlign: 'center',
    maxWidth: 320,
    lineHeight: 16,
  },
  alertBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0, 82, 255, 0.9)', // Beautiful Royal Blue alert bar!
    paddingVertical: 8,
    alignItems: 'center',
  },
  alertText: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  telemetryStrip: {
    flexDirection: 'row',
    backgroundColor: 'rgba(15, 15, 25, 0.6)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  metric: {
    flex: 1,
    alignItems: 'center',
    borderRightWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.04)',
  },
  metricLabel: {
    color: '#4E5164',
    fontSize: 9,
    fontWeight: 'bold',
    letterSpacing: 1,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  glassPanel: {
    backgroundColor: 'rgba(10, 10, 16, 0.75)',
    borderRadius: 16,
    borderWidth: 1.2,
    borderColor: 'rgba(255, 255, 255, 0.035)',
    padding: 18,
    ...Platform.select({
      web: {
        backdropFilter: 'blur(20px)',
      },
    }),
  },
  panelTitle: {
    color: '#FFF',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
    marginBottom: 14,
  },
  formRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 12,
  },
  inputGroup: {
    flex: 1,
    gap: 6,
  },
  inputLabel: {
    color: '#4E5164',
    fontSize: 8,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  textInput: {
    backgroundColor: '#05050A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.035)',
    borderRadius: 8,
    color: '#FFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
  },
  connectionBtn: {
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  connectBtn: {
    borderColor: 'rgba(0, 242, 254, 0.35)',
    backgroundColor: 'rgba(0, 242, 254, 0.08)',
  },
  disconnectBtn: {
    borderColor: 'rgba(255, 62, 62, 0.35)',
    backgroundColor: 'rgba(255, 62, 62, 0.08)',
  },
  connectingBtn: {
    borderColor: 'rgba(255, 204, 0, 0.35)',
    backgroundColor: 'rgba(255, 204, 0, 0.08)',
  },
  connectBtnText: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.5,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleLabel: {
    color: '#E0E1E8',
    fontSize: 12,
    fontWeight: 'bold',
  },
  toggleDesc: {
    color: '#4E5164',
    fontSize: 9,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    marginVertical: 12,
  },
  consoleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  diagnosticsBtnText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  consoleBody: {
    flex: 1,
    backgroundColor: '#05050A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.03)',
    borderRadius: 10,
    padding: 10,
  },
  logLine: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  logTime: {
    color: '#4E5164',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
  },
  logMessage: {
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace',
    flex: 1,
  },
  primaryButton: {
    borderColor: 'rgba(255, 62, 62, 0.45)',
    backgroundColor: 'rgba(255, 62, 62, 0.08)',
    borderWidth: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FF3E3E',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1.5,
  },
  advisorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  advisorTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  badgeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    marginBottom: 8,
  },
  badgeSection: {
    flex: 1,
    gap: 8,
  },
  badgeSectionTitle: {
    color: '#94A3B8',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  badgeList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  hazardBadge: {
    backgroundColor: 'rgba(255, 62, 62, 0.12)',
    borderColor: 'rgba(255, 62, 62, 0.4)',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  hazardBadgeText: {
    color: '#FF4D4F',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
  },
  objectBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.15)',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  objectBadgeText: {
    color: '#E0E1E8',
    fontSize: 9,
    fontWeight: 'bold',
  },
  emptyBadgeText: {
    color: '#64748B',
    fontSize: 12,
    fontStyle: 'italic',
  },
  actionsContainer: {
    gap: 10,
  },
  actionsTitle: {
    color: '#0052FF',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  noActionsBox: {
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  noActionsText: {
    color: '#94A3B8',
    fontSize: 13,
    textAlign: 'center',
  },
  actionsList: {
    gap: 8,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.15)',
    gap: 10,
  },
  actionNumberBox: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 82, 255, 0.15)',
    borderColor: 'rgba(0, 82, 255, 0.4)',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionNumberText: {
    color: '#0052FF',
    fontSize: 10,
    fontWeight: 'bold',
  },
  actionText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
});
