const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface WebRTCStats {
  activeSessions: number;
  queues: Record<string, number>;
  timestamp: number;
}

export interface WebRTCConfig {
  iceServers: RTCIceServer[];
  iceCandidatePoolSize: number;
  iceTransportPolicy?: 'all' | 'relay';
  bundlePolicy?: 'balanced' | 'max-compat' | 'max-bundle';
}

/**
 * Fetch WebRTC statistics from the backend
 */
export async function getWebRTCStats(): Promise<WebRTCStats> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/webrtc/stats`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch WebRTC stats:', error);
    throw error;
  }
}

/**
 * Fetch WebRTC configuration from the backend
 */
export async function getWebRTCConfig(): Promise<WebRTCConfig> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/webrtc/config`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch WebRTC config:', error);
    // Return fallback STUN-only configuration
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ],
      iceCandidatePoolSize: 10
    };
  }
}