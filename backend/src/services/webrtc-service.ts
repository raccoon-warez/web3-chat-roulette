import { v4 as uuidv4 } from 'uuid';
import { createClient } from 'redis';
import twilio from 'twilio';
import AWS from 'aws-sdk';

export interface ICEServer {
  urls: string | string[];
  username?: string;
  credential?: string;
  credentialType?: 'password' | 'oauth';
}

export interface WebRTCConfig {
  iceServers: ICEServer[];
  iceCandidatePoolSize: number;
  iceTransportPolicy?: 'all' | 'relay';
  bundlePolicy?: 'balanced' | 'max-compat' | 'max-bundle';
}

export interface ConnectionMetrics {
  sessionId: string;
  userId: string;
  peerId: string;
  connectionState: string;
  iceConnectionState: string;
  signallingState: string;
  bytesReceived: number;
  bytesSent: number;
  packetsLost: number;
  roundTripTime: number;
  jitter: number;
  bandwidth: number;
  audioLevel: number;
  videoFrameRate: number;
  videoResolution?: string;
  timestamp: number;
}

export interface RecordingSession {
  sessionId: string;
  userId: string;
  startTime: number;
  endTime?: number;
  status: 'recording' | 'stopped' | 'processing' | 'completed' | 'failed';
  recordingId: string;
  filename?: string;
  duration?: number;
  fileSize?: number;
  consent: {
    [userId: string]: boolean;
  };
}

export interface ScreenShareSession {
  sessionId: string;
  userId: string;
  isSharing: boolean;
  screenType: 'screen' | 'window' | 'tab';
  startTime: number;
  endTime?: number;
}

export interface AudioSettings {
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  sampleRate: number;
  channelCount: number;
  volume: number;
}

export interface VideoSettings {
  width: number;
  height: number;
  frameRate: number;
  facingMode: 'user' | 'environment';
  backgroundBlur: boolean;
  virtualBackground?: string;
}

export class WebRTCService {
  private redis;
  private twilioClient?: twilio.Twilio;
  private awsCredentials?: AWS.Config;

  constructor() {
    this.redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    this.redis.connect();

    // Initialize Twilio if credentials are provided
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      this.twilioClient = twilio(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN
      );
    }

    // Initialize AWS if credentials are provided
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      this.awsCredentials = new AWS.Config({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || 'us-east-1'
      });
    }
  }

  /**
   * Generate ICE servers configuration including TURN servers
   */
  async generateICEServers(): Promise<ICEServer[]> {
    const iceServers: ICEServer[] = [
      // Public STUN servers (always include)
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ];

    try {
      // Try Twilio TURN servers first
      if (this.twilioClient) {
        const twilioServers = await this.getTwilioICEServers();
        iceServers.push(...twilioServers);
      }
      // Fallback to AWS TURN servers
      else if (this.awsCredentials) {
        const awsServers = await this.getAWSICEServers();
        iceServers.push(...awsServers);
      }
      // Fallback to custom TURN servers
      else if (process.env.TURN_SERVER_URL) {
        const customServers = this.getCustomICEServers();
        iceServers.push(...customServers);
      }
    } catch (error) {
      console.error('Failed to get TURN servers, using STUN only:', error);
    }

    return iceServers;
  }

  /**
   * Get Twilio TURN servers
   */
  private async getTwilioICEServers(): Promise<ICEServer[]> {
    if (!this.twilioClient) return [];

    try {
      const token = await this.twilioClient.tokens.create();
      return token.iceServers
        .filter(server => server.urls && server.urls.length > 0)
        .map(server => ({
          urls: server.urls as string | string[],
          username: server.username || '',
          credential: server.credential || ''
        }));
    } catch (error) {
      console.error('Failed to get Twilio ICE servers:', error);
      return [];
    }
  }

  /**
   * Get AWS TURN servers (using Amazon Kinesis Video Streams)
   */
  private async getAWSICEServers(): Promise<ICEServer[]> {
    if (!this.awsCredentials) return [];

    try {
      // This is a placeholder - AWS doesn't provide a simple TURN service
      // You would need to set up your own TURN servers on EC2
      // or use a third-party service like Xirsys
      const turnServer = process.env.AWS_TURN_SERVER;
      if (turnServer) {
        return [
          {
            urls: `turn:${turnServer}:3478`,
            username: process.env.AWS_TURN_USERNAME || '',
            credential: process.env.AWS_TURN_CREDENTIAL || ''
          }
        ];
      }
      return [];
    } catch (error) {
      console.error('Failed to get AWS ICE servers:', error);
      return [];
    }
  }

  /**
   * Get custom TURN servers
   */
  private getCustomICEServers(): ICEServer[] {
    const turnUrl = process.env.TURN_SERVER_URL;
    if (!turnUrl) return [];

    return [
      {
        urls: turnUrl,
        username: process.env.TURN_USERNAME || '',
        credential: process.env.TURN_CREDENTIAL || ''
      }
    ];
  }

  /**
   * Generate WebRTC configuration for production
   */
  async generateWebRTCConfig(): Promise<WebRTCConfig> {
    const iceServers = await this.generateICEServers();

    return {
      iceServers,
      iceCandidatePoolSize: 10,
      iceTransportPolicy: 'all', // Use 'relay' to force TURN usage
      bundlePolicy: 'max-bundle'
    };
  }

  /**
   * Store connection metrics in Redis
   */
  async storeConnectionMetrics(metrics: ConnectionMetrics): Promise<void> {
    try {
      const key = `metrics:${metrics.sessionId}:${metrics.userId}`;
      const data = JSON.stringify(metrics);
      
      // Store with 24 hour expiration
      await this.redis.setEx(key, 24 * 60 * 60, data);
      
      // Also store in a sorted set for time-series analysis
      const timeSeriesKey = `metrics:timeseries:${metrics.sessionId}`;
      await this.redis.zAdd(timeSeriesKey, {
        score: metrics.timestamp,
        value: data
      });
      await this.redis.expire(timeSeriesKey, 24 * 60 * 60);
    } catch (error) {
      console.error('Failed to store connection metrics:', error);
    }
  }

  /**
   * Get connection metrics for a session
   */
  async getConnectionMetrics(sessionId: string): Promise<ConnectionMetrics[]> {
    try {
      const key = `metrics:timeseries:${sessionId}`;
      const results = await this.redis.zRange(key, 0, -1);
      
      return results.map(result => JSON.parse(result));
    } catch (error) {
      console.error('Failed to get connection metrics:', error);
      return [];
    }
  }

  /**
   * Store session information
   */
  async storeSession(sessionId: string, userIds: string[]): Promise<void> {
    try {
      const sessionData = {
        id: sessionId,
        users: userIds,
        createdAt: Date.now(),
        status: 'active'
      };
      
      const key = `session:${sessionId}`;
      await this.redis.setEx(key, 60 * 60, JSON.stringify(sessionData));
      
      // Store user mappings
      for (const userId of userIds) {
        await this.redis.setEx(`user:${userId}:session`, 60 * 60, sessionId);
      }
    } catch (error) {
      console.error('Failed to store session:', error);
    }
  }

  /**
   * Get session information
   */
  async getSession(sessionId: string): Promise<any> {
    try {
      const key = `session:${sessionId}`;
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to get session:', error);
      return null;
    }
  }

  /**
   * End a session
   */
  async endSession(sessionId: string): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (session) {
        // Remove user mappings
        for (const userId of session.users) {
          await this.redis.del(`user:${userId}:session`);
        }
        
        // Update session status
        session.status = 'ended';
        session.endedAt = Date.now();
        await this.redis.setEx(`session:${sessionId}`, 60 * 60, JSON.stringify(session));
      }
    } catch (error) {
      console.error('Failed to end session:', error);
    }
  }

  /**
   * Generate a unique session ID
   */
  generateSessionId(): string {
    return uuidv4();
  }

  /**
   * Get optimal media constraints based on connection quality
   */
  getOptimalMediaConstraints(connectionQuality: 'low' | 'medium' | 'high', audioOnly: boolean = false): any {
    const constraints: any = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1,
        volume: 1.0
      },
      video: audioOnly ? false : true
    };

    if (!audioOnly) {
      switch (connectionQuality) {
        case 'high':
          constraints.video = {
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 30, max: 60 },
            facingMode: 'user'
          };
          break;
        case 'medium':
          constraints.video = {
            width: { ideal: 640, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 24, max: 30 },
            facingMode: 'user'
          };
          break;
        case 'low':
          constraints.video = {
            width: { ideal: 320, max: 640 },
            height: { ideal: 240, max: 480 },
            frameRate: { ideal: 15, max: 24 },
            facingMode: 'user'
          };
          break;
      }
    }

    return constraints;
  }

  /**
   * Get screen sharing constraints
   */
  getScreenSharingConstraints(quality: 'low' | 'medium' | 'high' = 'medium'): any {
    const baseConstraints = {
      video: {
        cursor: 'always',
        displaySurface: 'monitor'
      },
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    };

    switch (quality) {
      case 'high':
        return {
          ...baseConstraints,
          video: {
            ...baseConstraints.video,
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            frameRate: { ideal: 30, max: 30 }
          }
        };
      case 'medium':
        return {
          ...baseConstraints,
          video: {
            ...baseConstraints.video,
            width: { ideal: 1280, max: 1920 },
            height: { ideal: 720, max: 1080 },
            frameRate: { ideal: 24, max: 30 }
          }
        };
      case 'low':
        return {
          ...baseConstraints,
          video: {
            ...baseConstraints.video,
            width: { ideal: 854, max: 1280 },
            height: { ideal: 480, max: 720 },
            frameRate: { ideal: 15, max: 24 }
          }
        };
    }
  }

  /**
   * Get advanced audio constraints with noise suppression
   */
  getAdvancedAudioConstraints(settings: Partial<AudioSettings> = {}): any {
    return {
      echoCancellation: settings.echoCancellation ?? true,
      noiseSuppression: settings.noiseSuppression ?? true,
      autoGainControl: settings.autoGainControl ?? true,
      sampleRate: settings.sampleRate ?? 48000,
      channelCount: settings.channelCount ?? 1,
      volume: settings.volume ?? 1.0,
      // Advanced audio processing
      googEchoCancellation: true,
      googAutoGainControl: true,
      googNoiseSuppression: true,
      googHighpassFilter: true,
      googTypingNoiseDetection: true,
      googAudioMirroring: false
    } as any;
  }

  /**
   * Store recording session information
   */
  async storeRecordingSession(recording: RecordingSession): Promise<void> {
    try {
      const key = `recording:${recording.sessionId}:${recording.recordingId}`;
      const data = JSON.stringify(recording);
      
      // Store with 7 day expiration
      await this.redis.setEx(key, 7 * 24 * 60 * 60, data);
      
      // Also store in recording index
      const indexKey = `recordings:${recording.sessionId}`;
      await this.redis.sAdd(indexKey, recording.recordingId);
      await this.redis.expire(indexKey, 7 * 24 * 60 * 60);
    } catch (error) {
      console.error('Failed to store recording session:', error);
    }
  }

  /**
   * Get recording session
   */
  async getRecordingSession(sessionId: string, recordingId: string): Promise<RecordingSession | null> {
    try {
      const key = `recording:${sessionId}:${recordingId}`;
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to get recording session:', error);
      return null;
    }
  }

  /**
   * Store screen sharing session
   */
  async storeScreenShareSession(screenShare: ScreenShareSession): Promise<void> {
    try {
      const key = `screenshare:${screenShare.sessionId}:${screenShare.userId}`;
      const data = JSON.stringify(screenShare);
      
      // Store with 1 hour expiration
      await this.redis.setEx(key, 60 * 60, data);
    } catch (error) {
      console.error('Failed to store screen share session:', error);
    }
  }

  /**
   * Get screen sharing session
   */
  async getScreenShareSession(sessionId: string, userId: string): Promise<ScreenShareSession | null> {
    try {
      const key = `screenshare:${sessionId}:${userId}`;
      const data = await this.redis.get(key);
      return data ? JSON.parse(data) : null;
    } catch (error) {
      console.error('Failed to get screen share session:', error);
      return null;
    }
  }

  /**
   * Calculate dynamic bitrate based on connection metrics
   */
  calculateOptimalBitrate(metrics: ConnectionMetrics): number {
    const { roundTripTime, packetsLost, bandwidth, jitter } = metrics;
    
    // Base bitrate in kbps
    let baseBitrate = 2500; // Default for good quality video
    
    // Adjust based on RTT
    if (roundTripTime > 300) {
      baseBitrate *= 0.6; // Reduce by 40%
    } else if (roundTripTime > 150) {
      baseBitrate *= 0.8; // Reduce by 20%
    }
    
    // Adjust based on packet loss
    if (packetsLost > 5) {
      baseBitrate *= 0.5; // Reduce by 50%
    } else if (packetsLost > 2) {
      baseBitrate *= 0.7; // Reduce by 30%
    }
    
    // Adjust based on jitter
    if (jitter > 100) {
      baseBitrate *= 0.7; // Reduce by 30%
    } else if (jitter > 50) {
      baseBitrate *= 0.9; // Reduce by 10%
    }
    
    // Use bandwidth if available
    if (bandwidth > 0) {
      const estimatedBitrate = bandwidth * 0.8; // Use 80% of available bandwidth
      baseBitrate = Math.min(baseBitrate, estimatedBitrate);
    }
    
    // Ensure minimum quality
    return Math.max(baseBitrate, 500); // Minimum 500 kbps
  }

  /**
   * Generate recording consent request
   */
  generateRecordingConsentRequest(sessionId: string, requesterId: string): any {
    return {
      type: 'recording-consent-request',
      sessionId,
      requesterId,
      message: 'Your peer would like to record this call. Do you consent?',
      timestamp: Date.now(),
      expiresAt: Date.now() + 30000 // 30 seconds to respond
    };
  }

  /**
   * Cleanup expired sessions and metrics
   */
  async cleanup(): Promise<void> {
    try {
      // This would be called by a cron job
      // Clean up expired sessions, metrics, etc.
      console.log('Running WebRTC service cleanup...');
    } catch (error) {
      console.error('Failed to cleanup WebRTC service:', error);
    }
  }
}

export const webrtcService = new WebRTCService();