import { useState, useEffect, useRef, useCallback } from 'react';
import SimplePeer from 'simple-peer';
import ReconnectingWebSocket from 'reconnecting-websocket';

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  iceCandidatePoolSize: number;
  iceTransportPolicy?: 'all' | 'relay';
  bundlePolicy?: 'balanced' | 'max-compat' | 'max-bundle';
}

export interface ConnectionMetrics {
  connectionState: RTCPeerConnectionState;
  iceConnectionState: RTCIceConnectionState;
  signallingState: RTCSignalingState;
  bytesReceived: number;
  bytesSent: number;
  packetsLost: number;
  roundTripTime: number;
  jitter: number;
  bandwidth: number;
}

export interface MediaConstraints {
  video: boolean | MediaTrackConstraints;
  audio: boolean | MediaTrackConstraints;
}

export interface WebRTCHookOptions {
  userId: string;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  heartbeatInterval?: number;
  qualityMonitoring?: boolean;
  enableScreenShare?: boolean;
  enableRecording?: boolean;
  enableBackgroundBlur?: boolean;
  enableNoiseSuppression?: boolean;
  maxParticipants?: number;
}

export interface WebRTCState {
  connectionState: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected' | 'failed';
  iceConnectionState: RTCIceConnectionState | null;
  sessionId: string | null;
  peerId: string | null;
  isInitiator: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  screenShareStream: MediaStream | null;
  isAudioMuted: boolean;
  isVideoDisabled: boolean;
  isAudioOnly: boolean;
  isScreenSharing: boolean;
  isPeerScreenSharing: boolean;
  isRecording: boolean;
  recordingId: string | null;
  hasRecordingConsent: boolean;
  backgroundBlur: boolean;
  virtualBackground: string | null;
  noiseSuppression: boolean;
  volume: number;
  connectionQuality: 'excellent' | 'good' | 'poor' | 'unknown';
  metrics: ConnectionMetrics | null;
  participants: Map<string, MediaStream>;
  maxParticipants: number;
  error: string | null;
}

export function useWebRTC(options: WebRTCHookOptions) {
  const [state, setState] = useState<WebRTCState>({
    connectionState: 'idle',
    iceConnectionState: null,
    sessionId: null,
    peerId: null,
    isInitiator: false,
    localStream: null,
    remoteStream: null,
    screenShareStream: null,
    isAudioMuted: false,
    isVideoDisabled: false,
    isAudioOnly: false,
    isScreenSharing: false,
    isPeerScreenSharing: false,
    isRecording: false,
    recordingId: null,
    hasRecordingConsent: false,
    backgroundBlur: false,
    virtualBackground: null,
    noiseSuppression: true,
    volume: 1.0,
    connectionQuality: 'unknown',
    metrics: null,
    participants: new Map(),
    maxParticipants: 2,
    error: null,
  });

  const wsRef = useRef<ReconnectingWebSocket | null>(null);
  const peerRef = useRef<SimplePeer.Instance | null>(null);
  const screenSharePeerRef = useRef<SimplePeer.Instance | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenShareStreamRef = useRef<MediaStream | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const metricsIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const webrtcConfigRef = useRef<WebRTCConfig | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const participantPeersRef = useRef<Map<string, SimplePeer.Instance>>(new Map());

  const { 
    userId, 
    autoReconnect = true, 
    maxReconnectAttempts = 3, 
    heartbeatInterval = 30000, 
    qualityMonitoring = true,
    enableScreenShare = true,
    enableRecording = true,
    enableBackgroundBlur = false,
    enableNoiseSuppression = true,
    maxParticipants = 2
  } = options;

  // Initialize WebSocket connection
  const initializeWebSocket = useCallback(() => {
    if (wsRef.current) return;

    const wsUrl = `${process.env.NEXT_PUBLIC_WEBSOCKET_URL || 'ws://localhost:3001'}?userId=${encodeURIComponent(userId)}`;
    wsRef.current = new ReconnectingWebSocket(wsUrl, [], {
      maxReconnectionDelay: 10000,
      minReconnectionDelay: 1000,
      reconnectionDelayGrowFactor: 1.3,
      maxRetries: autoReconnect ? maxReconnectAttempts : 0,
      connectionTimeout: 4000,
      debug: process.env.NODE_ENV === 'development'
    });

    wsRef.current.onopen = () => {
      console.log('WebSocket connected');
      reconnectAttemptsRef.current = 0;
      
      // Start heartbeat
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      heartbeatIntervalRef.current = setInterval(() => {
        sendMessage({ type: 'heartbeat' });
      }, heartbeatInterval);
    };

    wsRef.current.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleSignalingMessage(message);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    };

    wsRef.current.onclose = () => {
      console.log('WebSocket disconnected');
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };

    wsRef.current.onerror = (error) => {
      console.error('WebSocket error:', error);
      setState(prev => ({ ...prev, error: 'WebSocket connection failed' }));
    };
  }, [userId, autoReconnect, maxReconnectAttempts, heartbeatInterval]);

  // Handle signaling messages
  const handleSignalingMessage = useCallback(async (message: any) => {
    switch (message.type) {
      case 'connected':
        console.log('Connected to signaling server');
        break;

      case 'match-found':
        await handleMatchFound(message);
        break;

      case 'offer':
      case 'answer':
      case 'ice-candidate':
        handleWebRTCSignal(message);
        break;

      case 'ice-restart':
        await handleIceRestart(message);
        break;

      case 'peer-disconnected':
        handlePeerDisconnected(message);
        break;

      case 'session-ended':
        handleSessionEnded(message);
        break;

      case 'peer-media-update':
        handlePeerMediaUpdate(message);
        break;

      case 'screen-share-started':
        handleScreenShareStarted(message);
        break;

      case 'screen-share-stopped':
        handleScreenShareStopped(message);
        break;

      case 'screen-share-offer':
      case 'screen-share-answer':
        handleScreenShareSignal(message);
        break;

      case 'recording-consent-request':
        handleRecordingConsentRequest(message);
        break;

      case 'recording-consent-response':
        handleRecordingConsentResponse(message);
        break;

      case 'recording-enabled':
        setState(prev => ({ ...prev, hasRecordingConsent: true }));
        break;

      case 'recording-started':
        handleRecordingStarted(message);
        break;

      case 'recording-stopped':
        handleRecordingStopped(message);
        break;

      case 'peer-audio-only-mode':
        handlePeerAudioOnlyMode(message);
        break;

      case 'peer-virtual-background':
        handlePeerVirtualBackground(message);
        break;

      case 'peer-noise-suppression':
        handlePeerNoiseSuppression(message);
        break;

      case 'peer-bitrate-update':
        handlePeerBitrateUpdate(message);
        break;

      case 'participant-joined':
        handleParticipantJoined(message);
        break;

      case 'participant-left':
        handleParticipantLeft(message);
        break;

      case 'volume-control':
        handleVolumeControl(message);
        break;

      case 'error':
        setState(prev => ({ ...prev, error: message.error }));
        break;

      default:
        console.log('Unknown signaling message:', message);
    }
  }, []);

  // Handle match found
  const handleMatchFound = useCallback(async (message: any) => {
    const { sessionId, peerId, isInitiator, webrtcConfig, mediaConstraints, peerPreferences } = message;
    
    setState(prev => ({
      ...prev,
      sessionId,
      peerId,
      isInitiator,
      connectionState: 'connecting',
      isAudioOnly: mediaConstraints.video === false,
      maxParticipants: maxParticipants
    }));

    webrtcConfigRef.current = webrtcConfig;
    
    try {
      await initializePeerConnection(isInitiator, webrtcConfig, mediaConstraints);
    } catch (error) {
      console.error('Failed to initialize peer connection:', error);
      setState(prev => ({ ...prev, error: 'Failed to initialize peer connection' }));
    }
  }, [maxParticipants]);

  // Initialize peer connection
  const initializePeerConnection = useCallback(async (
    isInitiator: boolean, 
    webrtcConfig: WebRTCConfig, 
    mediaConstraints: MediaConstraints
  ) => {
    try {
      // Get user media
      const stream = await getUserMedia(mediaConstraints);
      localStreamRef.current = stream;
      setState(prev => ({ ...prev, localStream: stream }));

      // Create peer connection
      peerRef.current = new SimplePeer({
        initiator: isInitiator,
        trickle: false,
        stream,
        config: webrtcConfig
      });

      // Set up peer event handlers
      peerRef.current.on('signal', (data: any) => {
        const signalType = data.type || (data.sdp ? (data.sdp.type === 'offer' ? 'offer' : 'answer') : 'ice-candidate');
        sendMessage({
          type: signalType,
          sessionId: state.sessionId,
          userId,
          data
        });
      });

      peerRef.current.on('connect', () => {
        console.log('Peer connected');
        setState(prev => ({ 
          ...prev, 
          connectionState: 'connected',
          error: null
        }));

        // Start quality monitoring
        if (qualityMonitoring) {
          startQualityMonitoring();
        }
      });

      peerRef.current.on('stream', (remoteStream: MediaStream) => {
        console.log('Received remote stream');
        setState(prev => ({ ...prev, remoteStream }));
      });

      peerRef.current.on('close', () => {
        console.log('Peer connection closed');
        setState(prev => ({ ...prev, connectionState: 'disconnected' }));
        cleanup();
      });

      peerRef.current.on('error', (error: Error) => {
        console.error('Peer connection error:', error);
        setState(prev => ({ 
          ...prev, 
          connectionState: 'failed',
          error: error.message
        }));

        // Attempt ICE restart if enabled
        if (autoReconnect && reconnectAttemptsRef.current < maxReconnectAttempts) {
          setTimeout(() => restartIce(), 2000);
        }
      });

    } catch (error) {
      console.error('Failed to initialize peer connection:', error);
      setState(prev => ({ ...prev, error: 'Failed to access media devices' }));
    }
  }, [userId, state.sessionId, autoReconnect, maxReconnectAttempts, qualityMonitoring]);

  // Get user media with fallback quality levels
  const getUserMedia = async (constraints: MediaConstraints): Promise<MediaStream> => {
    const constraintLevels = [
      constraints, // Original constraints
      { // Fallback 1: Lower resolution
        audio: constraints.audio,
        video: typeof constraints.video === 'object' 
          ? { ...constraints.video, width: { ideal: 640 }, height: { ideal: 480 } }
          : { width: { ideal: 640 }, height: { ideal: 480 } }
      },
      { // Fallback 2: Audio only
        audio: constraints.audio,
        video: false
      }
    ];

    for (const constraint of constraintLevels) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraint);
      } catch (error) {
        console.warn('Failed to get media with constraints:', constraint, error);
      }
    }

    throw new Error('Failed to access media devices');
  };

  // Handle WebRTC signals
  const handleWebRTCSignal = useCallback((message: any) => {
    if (peerRef.current) {
      peerRef.current.signal(message.data);
    }
  }, []);

  // Handle ICE restart
  const handleIceRestart = useCallback(async (message: any) => {
    const { webrtcConfig, attempt } = message;
    
    console.log(`ICE restart attempt ${attempt}`);
    setState(prev => ({ ...prev, connectionState: 'reconnecting' }));
    
    try {
      if (peerRef.current && webrtcConfig) {
        // Update ICE servers
        webrtcConfigRef.current = webrtcConfig;
        
        // Restart ICE gathering
        await restartIce();
      }
    } catch (error) {
      console.error('ICE restart failed:', error);
    }
  }, []);

  // Handle peer disconnected
  const handlePeerDisconnected = useCallback((message: any) => {
    console.log('Peer disconnected');
    setState(prev => ({ 
      ...prev, 
      connectionState: 'reconnecting',
      error: 'Peer disconnected - attempting to reconnect...'
    }));
  }, []);

  // Handle session ended
  const handleSessionEnded = useCallback((message: any) => {
    console.log('Session ended:', message.reason);
    setState(prev => ({ 
      ...prev, 
      connectionState: 'disconnected',
      sessionId: null,
      peerId: null
    }));
    cleanup();
  }, []);

  // Handle peer media update
  const handlePeerMediaUpdate = useCallback((message: any) => {
    console.log('Peer updated media constraints:', message.constraints);
    // Handle peer media changes (e.g., video disabled/enabled)
  }, []);

  // Restart ICE
  const restartIce = useCallback(async () => {
    if (!peerRef.current || !webrtcConfigRef.current) return;

    reconnectAttemptsRef.current++;
    console.log(`Restarting ICE (attempt ${reconnectAttemptsRef.current})`);

    try {
      // Send ICE restart signal
      sendMessage({
        type: 'ice-restart',
        sessionId: state.sessionId,
        userId
      });
    } catch (error) {
      console.error('Failed to restart ICE:', error);
    }
  }, [userId, state.sessionId]);

  // Start quality monitoring
  const startQualityMonitoring = useCallback(() => {
    if (metricsIntervalRef.current) return;

    metricsIntervalRef.current = setInterval(async () => {
      if (!peerRef.current || !(peerRef.current as any)._pc) return;

      try {
        const pc = (peerRef.current as any)._pc as RTCPeerConnection;
        const stats = await pc.getStats();
        const metrics = calculateMetrics(stats);
        
        setState(prev => ({ 
          ...prev, 
          metrics,
          connectionQuality: determineConnectionQuality(metrics),
          iceConnectionState: pc.iceConnectionState,
          connectionState: pc.connectionState === 'connected' ? 'connected' : prev.connectionState
        }));

        // Adjust bitrate based on connection quality
        if (metrics.connectionState === 'connected') {
          adjustBitrate(metrics);
        }

        // Send metrics to server
        sendMessage({
          type: 'connection-state',
          sessionId: state.sessionId,
          userId,
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          metrics
        });

      } catch (error) {
        console.error('Failed to collect metrics:', error);
      }
    }, 5000); // Collect metrics every 5 seconds
  }, [userId, state.sessionId]);

  // Calculate metrics from WebRTC stats
  const calculateMetrics = (stats: RTCStatsReport): ConnectionMetrics => {
    let bytesReceived = 0;
    let bytesSent = 0;
    let packetsLost = 0;
    let roundTripTime = 0;
    let jitter = 0;
    let bandwidth = 0;

    stats.forEach((stat) => {
      if (stat.type === 'inbound-rtp') {
        bytesReceived += stat.bytesReceived || 0;
        packetsLost += stat.packetsLost || 0;
        jitter += stat.jitter || 0;
      } else if (stat.type === 'outbound-rtp') {
        bytesSent += stat.bytesSent || 0;
      } else if (stat.type === 'candidate-pair' && stat.state === 'succeeded') {
        roundTripTime = stat.currentRoundTripTime || 0;
      }
    });

    const pc = (peerRef.current as any)?._pc as RTCPeerConnection;
    return {
      connectionState: pc?.connectionState || 'new',
      iceConnectionState: pc?.iceConnectionState || 'new',
      signallingState: pc?.signalingState || 'stable',
      bytesReceived,
      bytesSent,
      packetsLost,
      roundTripTime,
      jitter,
      bandwidth
    };
  };

  // Determine connection quality based on metrics
  const determineConnectionQuality = (metrics: ConnectionMetrics): 'excellent' | 'good' | 'poor' | 'unknown' => {
    if (!metrics) return 'unknown';

    const { packetsLost, roundTripTime, jitter } = metrics;
    
    if (roundTripTime < 100 && packetsLost < 1 && jitter < 30) {
      return 'excellent';
    } else if (roundTripTime < 300 && packetsLost < 5 && jitter < 100) {
      return 'good';
    } else {
      return 'poor';
    }
  };

  // Send message via WebSocket
  const sendMessage = useCallback((message: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        ...message,
        timestamp: Date.now()
      }));
    }
  }, []);

  // Public methods
  const joinQueue = useCallback((chainId: number, preferences = {}) => {
    if (!wsRef.current) {
      initializeWebSocket();
    }
    
    sendMessage({
      type: 'join-queue',
      chainId,
      preferences
    });
  }, [initializeWebSocket, sendMessage]);

  const leaveQueue = useCallback(() => {
    sendMessage({ type: 'leave-queue' });
  }, [sendMessage]);

  const toggleAudio = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = state.isAudioMuted;
      });
      setState(prev => ({ ...prev, isAudioMuted: !prev.isAudioMuted }));
    }
  }, [state.isAudioMuted]);

  const toggleVideo = useCallback(() => {
    if (localStreamRef.current) {
      const videoTracks = localStreamRef.current.getVideoTracks();
      videoTracks.forEach(track => {
        track.enabled = state.isVideoDisabled;
      });
      setState(prev => ({ ...prev, isVideoDisabled: !prev.isVideoDisabled }));
      
      // Notify peer of media change
      sendMessage({
        type: 'media-constraints',
        sessionId: state.sessionId,
        constraints: { video: state.isVideoDisabled }
      });
    }
  }, [state.isVideoDisabled, state.sessionId, sendMessage]);

  const endSession = useCallback(() => {
    sendMessage({
      type: 'end-session',
      sessionId: state.sessionId,
      reason: 'user-ended'
    });
    cleanup();
  }, [state.sessionId, sendMessage]);

  // Screen sharing functions
  const startScreenShare = useCallback(async (screenType: 'screen' | 'window' | 'tab' = 'screen') => {
    if (!enableScreenShare) {
      setState(prev => ({ ...prev, error: 'Screen sharing not enabled' }));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: screenType === 'screen' ? 'monitor' : screenType
        } as any,
        audio: true
      });

      screenShareStreamRef.current = stream;
      setState(prev => ({ 
        ...prev, 
        screenShareStream: stream,
        isScreenSharing: true,
        error: null
      }));

      // Create screen share peer connection
      screenSharePeerRef.current = new SimplePeer({
        initiator: true,
        trickle: false,
        stream,
        config: webrtcConfigRef.current
      });

      screenSharePeerRef.current.on('signal', (data: any) => {
        sendMessage({
          type: 'screen-share-offer',
          sessionId: state.sessionId,
          userId,
          data
        });
      });

      // Notify signaling server
      sendMessage({
        type: 'screen-share-start',
        sessionId: state.sessionId,
        screenType
      });

      // Handle stream end
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

    } catch (error) {
      console.error('Failed to start screen share:', error);
      setState(prev => ({ ...prev, error: 'Failed to start screen share' }));
    }
  }, [enableScreenShare, state.sessionId, userId, sendMessage]);

  const stopScreenShare = useCallback(() => {
    if (screenShareStreamRef.current) {
      screenShareStreamRef.current.getTracks().forEach(track => track.stop());
      screenShareStreamRef.current = null;
    }

    if (screenSharePeerRef.current) {
      screenSharePeerRef.current.destroy();
      screenSharePeerRef.current = null;
    }

    setState(prev => ({ 
      ...prev, 
      screenShareStream: null,
      isScreenSharing: false
    }));

    sendMessage({
      type: 'screen-share-stop',
      sessionId: state.sessionId
    });
  }, [state.sessionId, sendMessage]);

  // Recording functions
  const requestRecording = useCallback(() => {
    if (!enableRecording) {
      setState(prev => ({ ...prev, error: 'Recording not enabled' }));
      return;
    }

    sendMessage({
      type: 'recording-request',
      sessionId: state.sessionId
    });
  }, [enableRecording, state.sessionId, sendMessage]);

  const respondToRecordingRequest = useCallback((consent: boolean, requesterId: string) => {
    sendMessage({
      type: 'recording-consent',
      sessionId: state.sessionId,
      consent,
      requesterId
    });
  }, [state.sessionId, sendMessage]);

  const startRecording = useCallback(() => {
    if (!state.hasRecordingConsent || !state.localStream) {
      setState(prev => ({ ...prev, error: 'Recording consent required or no local stream' }));
      return;
    }

    try {
      const recordingId = `recording_${Date.now()}`;
      const options = { mimeType: 'video/webm;codecs=vp9' };
      
      if (MediaRecorder.isTypeSupported(options.mimeType)) {
        mediaRecorderRef.current = new MediaRecorder(state.localStream, options);
      } else {
        mediaRecorderRef.current = new MediaRecorder(state.localStream);
      }

      recordedChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        
        // Create download link
        const a = document.createElement('a');
        a.href = url;
        a.download = `call_recording_${recordingId}.webm`;
        a.click();
        
        URL.revokeObjectURL(url);
      };

      mediaRecorderRef.current.start();
      
      setState(prev => ({ 
        ...prev, 
        isRecording: true,
        recordingId,
        error: null
      }));

      sendMessage({
        type: 'recording-start',
        sessionId: state.sessionId,
        recordingId
      });

    } catch (error) {
      console.error('Failed to start recording:', error);
      setState(prev => ({ ...prev, error: 'Failed to start recording' }));
    }
  }, [state.hasRecordingConsent, state.localStream, state.sessionId, sendMessage]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && state.isRecording) {
      mediaRecorderRef.current.stop();
      
      setState(prev => ({ 
        ...prev, 
        isRecording: false
      }));

      sendMessage({
        type: 'recording-stop',
        sessionId: state.sessionId,
        recordingId: state.recordingId
      });
    }
  }, [state.isRecording, state.sessionId, state.recordingId, sendMessage]);

  // Audio/Video controls
  const toggleAudioOnlyMode = useCallback(() => {
    const newAudioOnlyMode = !state.isAudioOnly;
    
    setState(prev => ({ ...prev, isAudioOnly: newAudioOnlyMode }));
    
    sendMessage({
      type: 'audio-only-mode',
      sessionId: state.sessionId,
      enabled: newAudioOnlyMode
    });

    // Stop video tracks if switching to audio only
    if (newAudioOnlyMode && localStreamRef.current) {
      localStreamRef.current.getVideoTracks().forEach(track => {
        track.stop();
        localStreamRef.current?.removeTrack(track);
      });
    }
  }, [state.isAudioOnly, state.sessionId, sendMessage]);

  const toggleBackgroundBlur = useCallback(() => {
    const newBlurState = !state.backgroundBlur;
    
    setState(prev => ({ ...prev, backgroundBlur: newBlurState }));
    
    sendMessage({
      type: 'virtual-background',
      sessionId: state.sessionId,
      backgroundType: newBlurState ? 'blur' : 'none'
    });
  }, [state.backgroundBlur, state.sessionId, sendMessage]);

  const setVirtualBackground = useCallback((backgroundUrl: string | null) => {
    setState(prev => ({ ...prev, virtualBackground: backgroundUrl }));
    
    sendMessage({
      type: 'virtual-background',
      sessionId: state.sessionId,
      backgroundType: backgroundUrl ? 'image' : 'none',
      backgroundUrl
    });
  }, [state.sessionId, sendMessage]);

  const toggleNoiseSuppression = useCallback(() => {
    const newNoiseSuppressionState = !state.noiseSuppression;
    
    setState(prev => ({ ...prev, noiseSuppression: newNoiseSuppressionState }));
    
    // Apply to local audio tracks
    if (localStreamRef.current) {
      localStreamRef.current.getAudioTracks().forEach(track => {
        const constraints = track.getConstraints();
        track.applyConstraints({
          ...constraints,
          noiseSuppression: newNoiseSuppressionState,
          echoCancellation: true,
          autoGainControl: true
        });
      });
    }
    
    sendMessage({
      type: 'noise-suppression',
      sessionId: state.sessionId,
      enabled: newNoiseSuppressionState
    });
  }, [state.noiseSuppression, state.sessionId, sendMessage]);

  const setVolume = useCallback((volume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    
    setState(prev => ({ ...prev, volume: clampedVolume }));
    
    sendMessage({
      type: 'volume-control',
      sessionId: state.sessionId,
      volume: clampedVolume
    });
  }, [state.sessionId, sendMessage]);

  // New message handlers for advanced features
  const handleScreenShareStarted = useCallback((message: any) => {
    setState(prev => ({ ...prev, isPeerScreenSharing: true }));
  }, []);

  const handleScreenShareStopped = useCallback((message: any) => {
    setState(prev => ({ ...prev, isPeerScreenSharing: false }));
  }, []);

  const handleScreenShareSignal = useCallback((message: any) => {
    if (message.type === 'screen-share-offer' && !screenSharePeerRef.current) {
      // Create receiver peer for screen share
      screenSharePeerRef.current = new SimplePeer({
        initiator: false,
        trickle: false,
        config: webrtcConfigRef.current
      });

      screenSharePeerRef.current.on('signal', (data: any) => {
        sendMessage({
          type: 'screen-share-answer',
          sessionId: state.sessionId,
          userId,
          data
        });
      });

      screenSharePeerRef.current.on('stream', (peerScreenStream: MediaStream) => {
        setState(prev => ({ ...prev, screenShareStream: peerScreenStream }));
      });

      screenSharePeerRef.current.signal(message.data);
    } else if (message.type === 'screen-share-answer' && screenSharePeerRef.current) {
      screenSharePeerRef.current.signal(message.data);
    }
  }, [state.sessionId, userId, sendMessage]);

  const handleRecordingConsentRequest = useCallback((message: any) => {
    const { requesterId } = message;
    
    // Show consent dialog (this would be handled by UI component)
    setState(prev => ({ 
      ...prev, 
      error: null // Clear any previous errors
    }));
    
    // For demo, auto-consent (in real app, show dialog)
    setTimeout(() => {
      respondToRecordingRequest(true, requesterId);
    }, 1000);
  }, [respondToRecordingRequest]);

  const handleRecordingConsentResponse = useCallback((message: any) => {
    const { consent } = message;
    if (consent) {
      setState(prev => ({ ...prev, hasRecordingConsent: true }));
    } else {
      setState(prev => ({ ...prev, error: 'Recording consent denied by peer' }));
    }
  }, []);

  const handleRecordingStarted = useCallback((message: any) => {
    // Peer started recording
    console.log('Peer started recording');
  }, []);

  const handleRecordingStopped = useCallback((message: any) => {
    // Peer stopped recording
    console.log('Peer stopped recording');
  }, []);

  const handlePeerAudioOnlyMode = useCallback((message: any) => {
    const { enabled } = message;
    // Handle peer switching to audio-only mode
    console.log(`Peer switched to audio-only mode: ${enabled}`);
  }, []);

  const handlePeerVirtualBackground = useCallback((message: any) => {
    const { backgroundType, backgroundUrl } = message;
    console.log(`Peer changed virtual background: ${backgroundType}`);
  }, []);

  const handlePeerNoiseSuppression = useCallback((message: any) => {
    const { enabled } = message;
    console.log(`Peer toggled noise suppression: ${enabled}`);
  }, []);

  const handlePeerBitrateUpdate = useCallback((message: any) => {
    const { bitrate, reason } = message;
    console.log(`Peer updated bitrate to ${bitrate}kbps, reason: ${reason}`);
  }, []);

  const handleParticipantJoined = useCallback((message: any) => {
    const { userId: newUserId, participantCount } = message;
    
    // Create new peer connection for participant
    const participantPeer = new SimplePeer({
      initiator: true,
      trickle: false,
      stream: localStreamRef.current,
      config: webrtcConfigRef.current
    });

    participantPeer.on('signal', (data: any) => {
      sendMessage({
        type: 'participant-offer',
        sessionId: state.sessionId,
        userId,
        targetUserId: newUserId,
        data
      });
    });

    participantPeer.on('stream', (participantStream: MediaStream) => {
      setState(prev => ({
        ...prev,
        participants: new Map(prev.participants.set(newUserId, participantStream))
      }));
    });

    participantPeersRef.current.set(newUserId, participantPeer);
    
    setState(prev => ({ 
      ...prev, 
      maxParticipants: participantCount 
    }));
  }, [state.sessionId, userId, sendMessage]);

  const handleParticipantLeft = useCallback((message: any) => {
    const { userId: leftUserId, participantCount } = message;
    
    // Clean up peer connection
    const participantPeer = participantPeersRef.current.get(leftUserId);
    if (participantPeer) {
      participantPeer.destroy();
      participantPeersRef.current.delete(leftUserId);
    }

    setState(prev => {
      const newParticipants = new Map(prev.participants);
      newParticipants.delete(leftUserId);
      return {
        ...prev,
        participants: newParticipants,
        maxParticipants: participantCount
      };
    });
  }, []);

  const handleVolumeControl = useCallback((message: any) => {
    const { volume } = message;
    
    // Apply volume to remote streams
    if (state.remoteStream) {
      state.remoteStream.getAudioTracks().forEach(track => {
        // Note: Volume control through Web Audio API would be more effective
        // This is a simplified implementation
        (track as any).volume = volume;
      });
    }
  }, [state.remoteStream]);

  // Dynamic bitrate adjustment based on connection quality
  const adjustBitrate = useCallback((metrics: ConnectionMetrics) => {
    if (!peerRef.current) return;

    const optimalBitrate = calculateOptimalBitrate(metrics);
    
    // Send bitrate update to peer
    sendMessage({
      type: 'bitrate-update',
      sessionId: state.sessionId,
      bitrate: optimalBitrate,
      reason: 'connection-quality'
    });
  }, [state.sessionId, sendMessage]);

  const calculateOptimalBitrate = (metrics: ConnectionMetrics): number => {
    const { roundTripTime, packetsLost, jitter } = metrics;
    
    let baseBitrate = 2500; // Default for good quality video
    
    // Adjust based on RTT
    if (roundTripTime > 300) {
      baseBitrate *= 0.6;
    } else if (roundTripTime > 150) {
      baseBitrate *= 0.8;
    }
    
    // Adjust based on packet loss
    if (packetsLost > 5) {
      baseBitrate *= 0.5;
    } else if (packetsLost > 2) {
      baseBitrate *= 0.7;
    }
    
    // Adjust based on jitter
    if (jitter > 100) {
      baseBitrate *= 0.7;
    } else if (jitter > 50) {
      baseBitrate *= 0.9;
    }
    
    return Math.max(baseBitrate, 500); // Minimum 500 kbps
  };

  // Cleanup function
  const cleanup = useCallback(() => {
    if (peerRef.current) {
      peerRef.current.destroy();
      peerRef.current = null;
    }

    if (screenSharePeerRef.current) {
      screenSharePeerRef.current.destroy();
      screenSharePeerRef.current = null;
    }

    // Clean up participant peers
    for (const [userId, peer] of participantPeersRef.current) {
      peer.destroy();
    }
    participantPeersRef.current.clear();

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    if (screenShareStreamRef.current) {
      screenShareStreamRef.current.getTracks().forEach(track => track.stop());
      screenShareStreamRef.current = null;
    }

    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current = null;
    }

    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }

    if (metricsIntervalRef.current) {
      clearInterval(metricsIntervalRef.current);
      metricsIntervalRef.current = null;
    }

    setState(prev => ({
      ...prev,
      localStream: null,
      remoteStream: null,
      screenShareStream: null,
      sessionId: null,
      peerId: null,
      connectionState: 'idle',
      isScreenSharing: false,
      isPeerScreenSharing: false,
      isRecording: false,
      recordingId: null,
      hasRecordingConsent: false,
      participants: new Map()
    }));
  }, []);

  // Initialize on mount
  useEffect(() => {
    initializeWebSocket();

    return () => {
      cleanup();
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [initializeWebSocket, cleanup]);

  return {
    ...state,
    // Basic functions
    joinQueue,
    leaveQueue,
    toggleAudio,
    toggleVideo,
    endSession,
    restartIce,
    
    // Screen sharing
    startScreenShare,
    stopScreenShare,
    
    // Recording
    requestRecording,
    respondToRecordingRequest,
    startRecording,
    stopRecording,
    
    // Audio/Video enhancements
    toggleAudioOnlyMode,
    toggleBackgroundBlur,
    setVirtualBackground,
    toggleNoiseSuppression,
    setVolume,
    
    // Advanced features
    adjustBitrate,
    
    // Internal handlers (exposed for testing/debugging)
    handleScreenShareStarted,
    handleScreenShareStopped,
    handleRecordingConsentRequest
  };
}