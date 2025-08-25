import WebSocket from 'ws';
import { v4 as uuidv4 } from 'uuid';
import { webrtcService, WebRTCConfig } from './webrtc-service';

export interface SignalingMessage {
  type: 'offer' | 'answer' | 'ice-candidate' | 'ice-restart' | 'connection-state' | 'media-constraints' | 'quality-update' | 
        'screen-share-start' | 'screen-share-stop' | 'screen-share-offer' | 'screen-share-answer' | 
        'recording-request' | 'recording-consent' | 'recording-start' | 'recording-stop' |
        'audio-only-mode' | 'virtual-background' | 'noise-suppression' | 'bitrate-update' |
        'multi-participant-join' | 'multi-participant-leave' | 'volume-control';
  sessionId: string;
  userId: string;
  peerId?: string;
  data: any;
  timestamp: number;
}

export interface QueueUser {
  userId: string;
  ws: WebSocket;
  chainId: number;
  joinedAt: number;
  preferences: UserPreferences;
}

export interface UserPreferences {
  maxWaitTime: number;
  connectionQuality: 'low' | 'medium' | 'high';
  requireVideo: boolean;
  audioOnly: boolean;
  allowRecording: boolean;
  allowScreenSharing: boolean;
  backgroundBlur: boolean;
  noiseSuppression: boolean;
  maxParticipants: number;
}

export interface ConnectionState {
  sessionId: string;
  users: Map<string, WebSocket>;
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  reconnectAttempts: number;
  lastActivity: number;
  metrics: any;
  isRecording: boolean;
  recordingConsent: Map<string, boolean>;
  screenSharing: Map<string, boolean>;
  audioOnlyMode: Map<string, boolean>;
  participantCount: number;
  maxParticipants: number;
}

export class SignalingService {
  private userConnections = new Map<string, WebSocket>();
  private queuesByChain = new Map<number, QueueUser[]>();
  private activeSessions = new Map<string, ConnectionState>();
  private reconnectTimeouts = new Map<string, NodeJS.Timeout>();

  constructor() {
    // Start cleanup interval
    setInterval(() => this.cleanupInactiveSessions(), 30000);
  }

  /**
   * Handle new WebSocket connection
   */
  handleConnection(ws: WebSocket, userId?: string): void {
    if (userId) {
      this.userConnections.set(userId, ws);
      console.log(`User ${userId} connected to signaling service`);
    }

    ws.on('message', (message: string) => {
      try {
        const data = JSON.parse(message);
        this.handleSignalingMessage(ws, data, userId);
      } catch (error) {
        console.error('Invalid signaling message:', error);
        this.sendError(ws, 'Invalid message format');
      }
    });

    ws.on('close', () => {
      if (userId) {
        this.handleUserDisconnect(userId);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });

    // Send initial connection acknowledgment
    this.sendMessage(ws, {
      type: 'connected',
      message: 'Connected to signaling server',
      timestamp: Date.now()
    });
  }

  /**
   * Handle signaling messages
   */
  private async handleSignalingMessage(ws: WebSocket, message: any, userId?: string): Promise<void> {
    if (!userId && message.type !== 'authenticate') {
      this.sendError(ws, 'Authentication required');
      return;
    }

    switch (message.type) {
      case 'authenticate':
        await this.handleAuthenticate(ws, message);
        break;
      case 'join-queue':
        await this.handleJoinQueue(ws, message, userId!);
        break;
      case 'leave-queue':
        this.handleLeaveQueue(userId!);
        break;
      case 'offer':
      case 'answer':
      case 'ice-candidate':
        await this.handleWebRTCSignal(message, userId!);
        break;
      case 'ice-restart':
        await this.handleICERestart(message, userId!);
        break;
      case 'connection-state':
        await this.handleConnectionStateUpdate(message, userId!);
        break;
      case 'media-constraints':
        await this.handleMediaConstraintsUpdate(message, userId!);
        break;
      case 'end-session':
        await this.handleEndSession(message, userId!);
        break;
      case 'screen-share-start':
        await this.handleScreenShareStart(message, userId!);
        break;
      case 'screen-share-stop':
        await this.handleScreenShareStop(message, userId!);
        break;
      case 'screen-share-offer':
      case 'screen-share-answer':
        await this.handleScreenShareSignal(message, userId!);
        break;
      case 'recording-request':
        await this.handleRecordingRequest(message, userId!);
        break;
      case 'recording-consent':
        await this.handleRecordingConsent(message, userId!);
        break;
      case 'recording-start':
        await this.handleRecordingStart(message, userId!);
        break;
      case 'recording-stop':
        await this.handleRecordingStop(message, userId!);
        break;
      case 'audio-only-mode':
        await this.handleAudioOnlyMode(message, userId!);
        break;
      case 'virtual-background':
        await this.handleVirtualBackground(message, userId!);
        break;
      case 'noise-suppression':
        await this.handleNoiseSuppression(message, userId!);
        break;
      case 'bitrate-update':
        await this.handleBitrateUpdate(message, userId!);
        break;
      case 'multi-participant-join':
        await this.handleMultiParticipantJoin(message, userId!);
        break;
      case 'multi-participant-leave':
        await this.handleMultiParticipantLeave(message, userId!);
        break;
      case 'volume-control':
        await this.handleVolumeControl(message, userId!);
        break;
      case 'heartbeat':
        this.handleHeartbeat(ws, userId!);
        break;
      default:
        this.sendError(ws, 'Unknown message type');
    }
  }

  /**
   * Handle user authentication
   */
  private async handleAuthenticate(ws: WebSocket, message: any): Promise<void> {
    // TODO: Implement JWT validation
    const { token, userId } = message;
    
    // For now, just store the connection
    this.userConnections.set(userId, ws);
    
    this.sendMessage(ws, {
      type: 'authenticated',
      userId,
      timestamp: Date.now()
    });
  }

  /**
   * Handle join queue request
   */
  private async handleJoinQueue(ws: WebSocket, message: any, userId: string): Promise<void> {
    const { chainId, preferences = {} } = message;
    
    // Remove user from any existing queues
    this.handleLeaveQueue(userId);

    // Add to appropriate queue
    if (!this.queuesByChain.has(chainId)) {
      this.queuesByChain.set(chainId, []);
    }

    const queueUser: QueueUser = {
      userId,
      ws,
      chainId,
      joinedAt: Date.now(),
      preferences: {
        maxWaitTime: preferences.maxWaitTime || 120000,
        connectionQuality: preferences.connectionQuality || 'medium',
        requireVideo: preferences.requireVideo || false,
        audioOnly: preferences.audioOnly || false,
        allowRecording: preferences.allowRecording !== false, // Default true
        allowScreenSharing: preferences.allowScreenSharing !== false, // Default true
        backgroundBlur: preferences.backgroundBlur || false,
        noiseSuppression: preferences.noiseSuppression !== false, // Default true
        maxParticipants: preferences.maxParticipants || 2
      }
    };

    const queue = this.queuesByChain.get(chainId)!;
    queue.push(queueUser);

    // Send queue status
    this.sendMessage(ws, {
      type: 'queue-joined',
      chainId,
      position: queue.length,
      estimatedWait: this.calculateEstimatedWait(queue.length),
      timestamp: Date.now()
    });

    // Try to match users
    await this.tryMatchUsers(chainId);
  }

  /**
   * Handle leave queue
   */
  private handleLeaveQueue(userId: string): void {
    for (const [chainId, queue] of this.queuesByChain.entries()) {
      const index = queue.findIndex(u => u.userId === userId);
      if (index !== -1) {
        queue.splice(index, 1);
        break;
      }
    }
  }

  /**
   * Try to match users in queue
   */
  private async tryMatchUsers(chainId: number): Promise<void> {
    const queue = this.queuesByChain.get(chainId);
    if (!queue || queue.length < 2) return;

    // Simple FIFO matching - could be enhanced with preferences
    const user1 = queue.shift()!;
    const user2 = queue.shift()!;

    const sessionId = webrtcService.generateSessionId();
    
    // Store session
    await webrtcService.storeSession(sessionId, [user1.userId, user2.userId]);

    // Create connection state
    const connectionState: ConnectionState = {
      sessionId,
      users: new Map([
        [user1.userId, user1.ws],
        [user2.userId, user2.ws]
      ]),
      connectionState: 'connecting',
      reconnectAttempts: 0,
      lastActivity: Date.now(),
      metrics: {},
      isRecording: false,
      recordingConsent: new Map(),
      screenSharing: new Map([
        [user1.userId, false],
        [user2.userId, false]
      ]),
      audioOnlyMode: new Map([
        [user1.userId, user1.preferences.audioOnly],
        [user2.userId, user2.preferences.audioOnly]
      ]),
      participantCount: 2,
      maxParticipants: Math.min(user1.preferences.maxParticipants, user2.preferences.maxParticipants)
    };
    
    this.activeSessions.set(sessionId, connectionState);

    // Generate WebRTC configuration
    const webrtcConfig = await webrtcService.generateWebRTCConfig();

    // Notify both users of the match
    this.sendMessage(user1.ws, {
      type: 'match-found',
      sessionId,
      peerId: user2.userId,
      isInitiator: true,
      webrtcConfig,
      mediaConstraints: webrtcService.getOptimalMediaConstraints(user1.preferences.connectionQuality, user1.preferences.audioOnly),
      peerPreferences: {
        audioOnly: user2.preferences.audioOnly,
        allowRecording: user2.preferences.allowRecording,
        allowScreenSharing: user2.preferences.allowScreenSharing,
        noiseSuppression: user2.preferences.noiseSuppression
      },
      timestamp: Date.now()
    });

    this.sendMessage(user2.ws, {
      type: 'match-found',
      sessionId,
      peerId: user1.userId,
      isInitiator: false,
      webrtcConfig,
      mediaConstraints: webrtcService.getOptimalMediaConstraints(user2.preferences.connectionQuality, user2.preferences.audioOnly),
      peerPreferences: {
        audioOnly: user1.preferences.audioOnly,
        allowRecording: user1.preferences.allowRecording,
        allowScreenSharing: user1.preferences.allowScreenSharing,
        noiseSuppression: user1.preferences.noiseSuppression
      },
      timestamp: Date.now()
    });

    console.log(`Matched users ${user1.userId} and ${user2.userId} in session ${sessionId}`);
  }

  /**
   * Handle WebRTC signaling (offer, answer, ice-candidate)
   */
  private async handleWebRTCSignal(message: SignalingMessage, userId: string): Promise<void> {
    const { sessionId, type, data } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      console.error(`Session ${sessionId} not found for signal`);
      return;
    }

    // Update last activity
    session.lastActivity = Date.now();

    // Forward signal to peer
    const peerWs = this.getPeerWebSocket(session, userId);
    if (peerWs && peerWs.readyState === WebSocket.OPEN) {
      this.sendMessage(peerWs, {
        type,
        sessionId,
        userId,
        data,
        timestamp: Date.now()
      });
    } else {
      console.error(`Peer WebSocket not available for session ${sessionId}`);
      // Trigger reconnection logic
      await this.handlePeerDisconnection(sessionId, userId);
    }
  }

  /**
   * Handle ICE restart
   */
  private async handleICERestart(message: any, userId: string): Promise<void> {
    const { sessionId } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.connectionState = 'reconnecting';
    session.reconnectAttempts++;

    if (session.reconnectAttempts > (parseInt(process.env.MAX_RECONNECT_ATTEMPTS || '3'))) {
      await this.endSession(sessionId, 'max-reconnect-attempts');
      return;
    }

    // Generate fresh ICE servers
    const webrtcConfig = await webrtcService.generateWebRTCConfig();

    // Notify both users to restart ICE
    for (const [uid, ws] of session.users) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendMessage(ws, {
          type: 'ice-restart',
          sessionId,
          webrtcConfig,
          attempt: session.reconnectAttempts,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Handle connection state updates
   */
  private async handleConnectionStateUpdate(message: any, userId: string): Promise<void> {
    const { sessionId, connectionState, iceConnectionState, metrics } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.connectionState = connectionState;
    session.lastActivity = Date.now();
    session.metrics = { ...session.metrics, [userId]: metrics };

    // Store metrics if provided
    if (metrics) {
      await webrtcService.storeConnectionMetrics({
        sessionId,
        userId,
        peerId: this.getPeerUserId(session, userId),
        connectionState,
        iceConnectionState,
        signallingState: metrics.signalingState,
        bytesReceived: metrics.bytesReceived || 0,
        bytesSent: metrics.bytesSent || 0,
        packetsLost: metrics.packetsLost || 0,
        roundTripTime: metrics.roundTripTime || 0,
        jitter: metrics.jitter || 0,
        bandwidth: metrics.bandwidth || 0,
        audioLevel: metrics.audioLevel || 0,
        videoFrameRate: metrics.videoFrameRate || 0,
        videoResolution: metrics.videoResolution,
        timestamp: Date.now()
      });
    }

    // Handle connection failures
    if (connectionState === 'failed' || iceConnectionState === 'failed') {
      console.log(`Connection failed for session ${sessionId}, triggering ICE restart`);
      await this.handleICERestart({ sessionId }, userId);
    }
  }

  /**
   * Handle media constraints update
   */
  private async handleMediaConstraintsUpdate(message: any, userId: string): Promise<void> {
    const { sessionId, constraints } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Forward to peer
    const peerWs = this.getPeerWebSocket(session, userId);
    if (peerWs && peerWs.readyState === WebSocket.OPEN) {
      this.sendMessage(peerWs, {
        type: 'peer-media-update',
        sessionId,
        userId,
        constraints,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle end session
   */
  private async handleEndSession(message: any, userId: string): Promise<void> {
    const { sessionId, reason } = message;
    await this.endSession(sessionId, reason || 'user-ended');
  }

  /**
   * Handle heartbeat
   */
  private handleHeartbeat(ws: WebSocket, userId: string): void {
    this.sendMessage(ws, {
      type: 'heartbeat-ack',
      timestamp: Date.now()
    });
  }

  /**
   * Handle user disconnect
   */
  private async handleUserDisconnect(userId: string): Promise<void> {
    console.log(`User ${userId} disconnected`);
    
    // Remove from connections
    this.userConnections.delete(userId);
    
    // Remove from queues
    this.handleLeaveQueue(userId);
    
    // Handle active sessions
    for (const [sessionId, session] of this.activeSessions) {
      if (session.users.has(userId)) {
        await this.handlePeerDisconnection(sessionId, userId);
        break;
      }
    }
  }

  /**
   * Handle peer disconnection in active session
   */
  private async handlePeerDisconnection(sessionId: string, disconnectedUserId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Notify the remaining peer
    const peerUserId = this.getPeerUserId(session, disconnectedUserId);
    if (peerUserId) {
      const peerWs = session.users.get(peerUserId);
      if (peerWs && peerWs.readyState === WebSocket.OPEN) {
        this.sendMessage(peerWs, {
          type: 'peer-disconnected',
          sessionId,
          userId: disconnectedUserId,
          timestamp: Date.now()
        });

        // Set reconnection timeout
        const timeout = setTimeout(async () => {
          await this.endSession(sessionId, 'peer-timeout');
        }, 30000); // 30 second timeout

        this.reconnectTimeouts.set(sessionId, timeout);
      }
    }
  }

  /**
   * End a session
   */
  private async endSession(sessionId: string, reason: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    console.log(`Ending session ${sessionId}, reason: ${reason}`);

    // Clear any reconnect timeouts
    const timeout = this.reconnectTimeouts.get(sessionId);
    if (timeout) {
      clearTimeout(timeout);
      this.reconnectTimeouts.delete(sessionId);
    }

    // Notify all users
    for (const [userId, ws] of session.users) {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendMessage(ws, {
          type: 'session-ended',
          sessionId,
          reason,
          timestamp: Date.now()
        });
      }
    }

    // Clean up
    this.activeSessions.delete(sessionId);
    await webrtcService.endSession(sessionId);
  }

  /**
   * Get peer WebSocket
   */
  private getPeerWebSocket(session: ConnectionState, userId: string): WebSocket | undefined {
    for (const [uid, ws] of session.users) {
      if (uid !== userId) {
        return ws;
      }
    }
    return undefined;
  }

  /**
   * Get peer user ID
   */
  private getPeerUserId(session: ConnectionState, userId: string): string {
    for (const uid of session.users.keys()) {
      if (uid !== userId) {
        return uid;
      }
    }
    return '';
  }

  /**
   * Send message to WebSocket
   */
  private sendMessage(ws: WebSocket, message: any): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error message
   */
  private sendError(ws: WebSocket, error: string): void {
    this.sendMessage(ws, {
      type: 'error',
      error,
      timestamp: Date.now()
    });
  }

  /**
   * Calculate estimated wait time
   */
  private calculateEstimatedWait(queuePosition: number): number {
    // Simple estimation: 30 seconds per position
    return Math.max(0, (queuePosition - 1) * 30);
  }

  /**
   * Clean up inactive sessions
   */
  private async cleanupInactiveSessions(): Promise<void> {
    const now = Date.now();
    const timeout = 5 * 60 * 1000; // 5 minutes

    for (const [sessionId, session] of this.activeSessions) {
      if (now - session.lastActivity > timeout) {
        console.log(`Cleaning up inactive session ${sessionId}`);
        await this.endSession(sessionId, 'inactive-timeout');
      }
    }
  }

  /**
   * Get active sessions count
   */
  getActiveSessionsCount(): number {
    return this.activeSessions.size;
  }

  /**
   * Handle screen share start
   */
  private async handleScreenShareStart(message: any, userId: string): Promise<void> {
    const { sessionId, screenType } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Check if screen sharing is allowed
    const peerUserId = this.getPeerUserId(session, userId);
    if (!peerUserId) return;

    session.screenSharing.set(userId, true);
    session.lastActivity = Date.now();

    // Store screen share session
    await webrtcService.storeScreenShareSession({
      sessionId,
      userId,
      isSharing: true,
      screenType: screenType || 'screen',
      startTime: Date.now()
    });

    // Notify peer
    const peerWs = session.users.get(peerUserId);
    if (peerWs && peerWs.readyState === WebSocket.OPEN) {
      this.sendMessage(peerWs, {
        type: 'screen-share-started',
        sessionId,
        userId,
        screenType,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle screen share stop
   */
  private async handleScreenShareStop(message: any, userId: string): Promise<void> {
    const { sessionId } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.screenSharing.set(userId, false);
    session.lastActivity = Date.now();

    // Update screen share session
    const screenShare = await webrtcService.getScreenShareSession(sessionId, userId);
    if (screenShare) {
      screenShare.isSharing = false;
      screenShare.endTime = Date.now();
      await webrtcService.storeScreenShareSession(screenShare);
    }

    // Notify peer
    const peerUserId = this.getPeerUserId(session, userId);
    if (peerUserId) {
      const peerWs = session.users.get(peerUserId);
      if (peerWs && peerWs.readyState === WebSocket.OPEN) {
        this.sendMessage(peerWs, {
          type: 'screen-share-stopped',
          sessionId,
          userId,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Handle screen share signaling
   */
  private async handleScreenShareSignal(message: any, userId: string): Promise<void> {
    const { sessionId, type, data } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    // Forward to peer
    const peerWs = this.getPeerWebSocket(session, userId);
    if (peerWs && peerWs.readyState === WebSocket.OPEN) {
      this.sendMessage(peerWs, {
        type,
        sessionId,
        userId,
        data,
        timestamp: Date.now()
      });
    }
  }

  /**
   * Handle recording request
   */
  private async handleRecordingRequest(message: any, userId: string): Promise<void> {
    const { sessionId } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    // Generate consent request
    const consentRequest = webrtcService.generateRecordingConsentRequest(sessionId, userId);

    // Send to peer
    const peerUserId = this.getPeerUserId(session, userId);
    if (peerUserId) {
      const peerWs = session.users.get(peerUserId);
      if (peerWs && peerWs.readyState === WebSocket.OPEN) {
        this.sendMessage(peerWs, consentRequest);
      }
    }
  }

  /**
   * Handle recording consent
   */
  private async handleRecordingConsent(message: any, userId: string): Promise<void> {
    const { sessionId, consent, requesterId } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.recordingConsent.set(userId, consent);
    session.lastActivity = Date.now();

    // Notify requester
    const requesterWs = session.users.get(requesterId);
    if (requesterWs && requesterWs.readyState === WebSocket.OPEN) {
      this.sendMessage(requesterWs, {
        type: 'recording-consent-response',
        sessionId,
        userId,
        consent,
        timestamp: Date.now()
      });
    }

    // If both users consent, enable recording
    if (session.recordingConsent.get(requesterId) && session.recordingConsent.get(userId)) {
      session.isRecording = true;
      
      // Notify both users
      for (const [uid, ws] of session.users) {
        if (ws.readyState === WebSocket.OPEN) {
          this.sendMessage(ws, {
            type: 'recording-enabled',
            sessionId,
            timestamp: Date.now()
          });
        }
      }
    }
  }

  /**
   * Handle recording start
   */
  private async handleRecordingStart(message: any, userId: string): Promise<void> {
    const { sessionId, recordingId } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session || !session.isRecording) return;

    session.lastActivity = Date.now();

    // Store recording session
    const recordingSession = {
      sessionId,
      userId,
      startTime: Date.now(),
      status: 'recording' as const,
      recordingId,
      consent: Object.fromEntries(session.recordingConsent)
    };

    await webrtcService.storeRecordingSession(recordingSession);

    // Notify peer
    const peerUserId = this.getPeerUserId(session, userId);
    if (peerUserId) {
      const peerWs = session.users.get(peerUserId);
      if (peerWs && peerWs.readyState === WebSocket.OPEN) {
        this.sendMessage(peerWs, {
          type: 'recording-started',
          sessionId,
          recordingId,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Handle recording stop
   */
  private async handleRecordingStop(message: any, userId: string): Promise<void> {
    const { sessionId, recordingId } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    // Update recording session
    const recording = await webrtcService.getRecordingSession(sessionId, recordingId);
    if (recording) {
      recording.status = 'stopped';
      recording.endTime = Date.now();
      await webrtcService.storeRecordingSession(recording);
    }

    // Notify peer
    const peerUserId = this.getPeerUserId(session, userId);
    if (peerUserId) {
      const peerWs = session.users.get(peerUserId);
      if (peerWs && peerWs.readyState === WebSocket.OPEN) {
        this.sendMessage(peerWs, {
          type: 'recording-stopped',
          sessionId,
          recordingId,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Handle audio only mode
   */
  private async handleAudioOnlyMode(message: any, userId: string): Promise<void> {
    const { sessionId, enabled } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.audioOnlyMode.set(userId, enabled);
    session.lastActivity = Date.now();

    // Notify peer
    const peerUserId = this.getPeerUserId(session, userId);
    if (peerUserId) {
      const peerWs = session.users.get(peerUserId);
      if (peerWs && peerWs.readyState === WebSocket.OPEN) {
        this.sendMessage(peerWs, {
          type: 'peer-audio-only-mode',
          sessionId,
          userId,
          enabled,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Handle virtual background
   */
  private async handleVirtualBackground(message: any, userId: string): Promise<void> {
    const { sessionId, backgroundType, backgroundUrl } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    // Notify peer about background change
    const peerUserId = this.getPeerUserId(session, userId);
    if (peerUserId) {
      const peerWs = session.users.get(peerUserId);
      if (peerWs && peerWs.readyState === WebSocket.OPEN) {
        this.sendMessage(peerWs, {
          type: 'peer-virtual-background',
          sessionId,
          userId,
          backgroundType,
          backgroundUrl,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Handle noise suppression
   */
  private async handleNoiseSuppression(message: any, userId: string): Promise<void> {
    const { sessionId, enabled } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    // Notify peer
    const peerUserId = this.getPeerUserId(session, userId);
    if (peerUserId) {
      const peerWs = session.users.get(peerUserId);
      if (peerWs && peerWs.readyState === WebSocket.OPEN) {
        this.sendMessage(peerWs, {
          type: 'peer-noise-suppression',
          sessionId,
          userId,
          enabled,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Handle bitrate update
   */
  private async handleBitrateUpdate(message: any, userId: string): Promise<void> {
    const { sessionId, bitrate, reason } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    // Notify peer about bitrate adjustment
    const peerUserId = this.getPeerUserId(session, userId);
    if (peerUserId) {
      const peerWs = session.users.get(peerUserId);
      if (peerWs && peerWs.readyState === WebSocket.OPEN) {
        this.sendMessage(peerWs, {
          type: 'peer-bitrate-update',
          sessionId,
          userId,
          bitrate,
          reason,
          timestamp: Date.now()
        });
      }
    }
  }

  /**
   * Handle multi-participant join
   */
  private async handleMultiParticipantJoin(message: any, userId: string): Promise<void> {
    const { sessionId } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session || session.participantCount >= session.maxParticipants) {
      const ws = this.userConnections.get(userId);
      if (ws) {
        this.sendError(ws, 'Session is full or does not exist');
      }
      return;
    }

    // Add user to session
    const ws = this.userConnections.get(userId);
    if (!ws) return;

    session.users.set(userId, ws);
    session.participantCount++;
    session.lastActivity = Date.now();

    // Generate WebRTC config for new participant
    const webrtcConfig = await webrtcService.generateWebRTCConfig();

    // Notify existing participants
    for (const [existingUserId, existingWs] of session.users) {
      if (existingUserId !== userId && existingWs.readyState === WebSocket.OPEN) {
        this.sendMessage(existingWs, {
          type: 'participant-joined',
          sessionId,
          userId,
          participantCount: session.participantCount,
          timestamp: Date.now()
        });
      }
    }

    // Send session info to new participant
    this.sendMessage(ws, {
      type: 'multi-participant-session-joined',
      sessionId,
      participantCount: session.participantCount,
      maxParticipants: session.maxParticipants,
      webrtcConfig,
      timestamp: Date.now()
    });
  }

  /**
   * Handle multi-participant leave
   */
  private async handleMultiParticipantLeave(message: any, userId: string): Promise<void> {
    const { sessionId } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.users.delete(userId);
    session.participantCount--;
    session.lastActivity = Date.now();

    // Notify remaining participants
    for (const [remainingUserId, remainingWs] of session.users) {
      if (remainingWs.readyState === WebSocket.OPEN) {
        this.sendMessage(remainingWs, {
          type: 'participant-left',
          sessionId,
          userId,
          participantCount: session.participantCount,
          timestamp: Date.now()
        });
      }
    }

    // End session if no participants left
    if (session.participantCount === 0) {
      await this.endSession(sessionId, 'all-participants-left');
    }
  }

  /**
   * Handle volume control
   */
  private async handleVolumeControl(message: any, userId: string): Promise<void> {
    const { sessionId, volume, targetUserId } = message;
    
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    session.lastActivity = Date.now();

    // If targetUserId is specified, send to specific user; otherwise broadcast
    if (targetUserId) {
      const targetWs = session.users.get(targetUserId);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        this.sendMessage(targetWs, {
          type: 'volume-control',
          sessionId,
          userId,
          volume,
          timestamp: Date.now()
        });
      }
    } else {
      // Broadcast to all other participants
      for (const [participantId, participantWs] of session.users) {
        if (participantId !== userId && participantWs.readyState === WebSocket.OPEN) {
          this.sendMessage(participantWs, {
            type: 'volume-control',
            sessionId,
            userId,
            volume,
            timestamp: Date.now()
          });
        }
      }
    }
  }

  /**
   * Get queue status
   */
  getQueueStatus(): any {
    const status: any = {};
    for (const [chainId, queue] of this.queuesByChain) {
      status[chainId] = queue.length;
    }
    return status;
  }
}

export const signalingService = new SignalingService();