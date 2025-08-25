import { createCluster, RedisClusterType } from 'redis';
import { EventEmitter } from 'events';

interface RedisClusterConfig {
  nodes: Array<{ host: string; port: number }>;
  options?: {
    enableReadyCheck?: boolean;
    redisOptions?: {
      connectTimeout?: number;
      commandTimeout?: number;
      retryDelayOnFailover?: number;
      maxRetriesPerRequest?: number;
    };
    enableOfflineQueue?: boolean;
    slotsRefreshTimeout?: number;
    slotsRefreshInterval?: number;
    failoverDetector?: boolean;
  };
}

interface ClusterStats {
  nodes: number;
  activeNodes: number;
  commands: number;
  errors: number;
  lastUpdate: Date;
  nodeHealth: Array<{
    id: string;
    host: string;
    port: number;
    status: 'connected' | 'disconnected' | 'connecting';
    slots: number[];
    lastSeen: Date;
  }>;
}

export class RedisClusterManager extends EventEmitter {
  private cluster: RedisClusterType | null = null;
  private config: RedisClusterConfig;
  private stats: ClusterStats;
  private monitoringInterval?: NodeJS.Timeout;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  constructor(config: RedisClusterConfig) {
    super();
    
    this.config = {
      nodes: config.nodes || [
        { host: '127.0.0.1', port: 7000 },
        { host: '127.0.0.1', port: 7001 },
        { host: '127.0.0.1', port: 7002 }
      ],
      options: {
        enableReadyCheck: true,
        redisOptions: {
          connectTimeout: 10000,
          commandTimeout: 5000,
          retryDelayOnFailover: 100,
          maxRetriesPerRequest: 3,
          ...config.options?.redisOptions
        },
        enableOfflineQueue: false,
        slotsRefreshTimeout: 2000,
        slotsRefreshInterval: 5000,
        failoverDetector: true,
        ...config.options
      }
    };

    this.stats = {
      nodes: 0,
      activeNodes: 0,
      commands: 0,
      errors: 0,
      lastUpdate: new Date(),
      nodeHealth: []
    };
  }

  /**
   * Initialize Redis cluster connection
   */
  async connect(): Promise<void> {
    try {
      console.log('🔗 Connecting to Redis Cluster...');
      
      this.cluster = createCluster({
        rootNodes: this.config.nodes.map(node => ({
          url: `redis://${node.host}:${node.port}`
        })),
        defaults: {
          socket: {
            connectTimeout: this.config.options?.redisOptions?.connectTimeout || 10000,
            commandTimeout: this.config.options?.redisOptions?.commandTimeout || 5000,
            reconnectStrategy: (retries) => this.reconnectStrategy(retries)
          }
        }
      });

      // Set up event handlers
      this.setupEventHandlers();

      // Connect to cluster
      await this.cluster.connect();
      
      this.reconnectAttempts = 0;
      console.log('✅ Connected to Redis Cluster');
      
      // Start monitoring
      this.startMonitoring();
      
      this.emit('connected');
      
    } catch (error) {
      console.error('❌ Failed to connect to Redis Cluster:', error);
      this.handleConnectionError(error);
      throw error;
    }
  }

  /**
   * Setup cluster event handlers
   */
  private setupEventHandlers(): void {
    if (!this.cluster) return;

    this.cluster.on('error', (error) => {
      console.error('Redis Cluster error:', error);
      this.stats.errors++;
      this.emit('error', error);
    });

    this.cluster.on('connect', () => {
      console.log('Redis Cluster connected');
      this.reconnectAttempts = 0;
      this.emit('connect');
    });

    this.cluster.on('ready', () => {
      console.log('Redis Cluster ready');
      this.updateClusterStats();
      this.emit('ready');
    });

    this.cluster.on('end', () => {
      console.log('Redis Cluster connection ended');
      this.emit('end');
    });
  }

  /**
   * Reconnection strategy
   */
  private reconnectStrategy(retries: number): number | false {
    if (retries > this.maxReconnectAttempts) {
      console.error(`Redis Cluster max reconnection attempts (${this.maxReconnectAttempts}) exceeded`);
      return false;
    }

    const delay = Math.min(retries * 1000, 10000); // Max 10 second delay
    console.log(`Redis Cluster reconnecting in ${delay}ms (attempt ${retries})`);
    return delay;
  }

  /**
   * Handle connection errors
   */
  private handleConnectionError(error: any): void {
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Redis Cluster: Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    // Implement exponential backoff
    const delay = Math.min(this.reconnectAttempts * 2000, 30000);
    setTimeout(() => {
      console.log(`Retrying Redis Cluster connection (attempt ${this.reconnectAttempts + 1})`);
      this.connect().catch(err => console.error('Retry connection failed:', err));
    }, delay);
  }

  /**
   * Start cluster monitoring
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(async () => {
      await this.updateClusterStats();
      await this.checkNodeHealth();
    }, 30000); // Monitor every 30 seconds
  }

  /**
   * Update cluster statistics
   */
  private async updateClusterStats(): Promise<void> {
    if (!this.cluster) return;

    try {
      // Get cluster info
      const clusterInfo = await this.cluster.cluster('INFO');
      const clusterNodes = await this.cluster.cluster('NODES');

      // Parse cluster nodes information
      const nodeLines = clusterNodes.split('\n').filter(line => line.trim());
      const nodeHealth = nodeLines.map(line => {
        const parts = line.split(' ');
        const [id, endpoint, flags] = parts;
        const [host, port] = endpoint.split(':').slice(0, 2);
        
        return {
          id,
          host,
          port: parseInt(port),
          status: flags.includes('connected') ? 'connected' as const : 'disconnected' as const,
          slots: this.parseSlots(parts),
          lastSeen: new Date()
        };
      });

      this.stats = {
        ...this.stats,
        nodes: nodeHealth.length,
        activeNodes: nodeHealth.filter(n => n.status === 'connected').length,
        nodeHealth,
        lastUpdate: new Date()
      };

    } catch (error) {
      console.error('Failed to update cluster stats:', error);
      this.stats.errors++;
    }
  }

  /**
   * Parse slot information from cluster nodes output
   */
  private parseSlots(nodeParts: string[]): number[] {
    const slots: number[] = [];
    
    // Look for slot ranges in the node info
    for (let i = 8; i < nodeParts.length; i++) {
      const part = nodeParts[i];
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        for (let slot = start; slot <= end; slot++) {
          slots.push(slot);
        }
      } else if (!isNaN(Number(part))) {
        slots.push(Number(part));
      }
    }
    
    return slots;
  }

  /**
   * Check individual node health
   */
  private async checkNodeHealth(): Promise<void> {
    if (!this.cluster) return;

    for (const node of this.stats.nodeHealth) {
      try {
        const nodeClient = this.cluster;
        await nodeClient.ping();
        node.status = 'connected';
        node.lastSeen = new Date();
      } catch (error) {
        node.status = 'disconnected';
        console.warn(`Node ${node.host}:${node.port} health check failed:`, error);
      }
    }
  }

  /**
   * Enhanced Redis operations with cluster support
   */
  async get(key: string): Promise<string | null> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      this.stats.commands++;
      return await this.cluster.get(key);
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      this.stats.commands++;
      if (ttl) {
        await this.cluster.setEx(key, ttl, value);
      } else {
        await this.cluster.set(key, value);
      }
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  async del(keys: string | string[]): Promise<number> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      this.stats.commands++;
      return await this.cluster.del(keys);
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      this.stats.commands++;
      return await this.cluster.mGet(keys);
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  async mset(keyValues: Record<string, string>): Promise<void> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      this.stats.commands++;
      await this.cluster.mSet(keyValues);
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Hash operations
   */
  async hget(key: string, field: string): Promise<string | null> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      this.stats.commands++;
      return await this.cluster.hGet(key, field);
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      this.stats.commands++;
      return await this.cluster.hSet(key, field, value);
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  async hmget(key: string, fields: string[]): Promise<(string | null)[]> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      this.stats.commands++;
      return await this.cluster.hmGet(key, fields);
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Pub/Sub operations
   */
  async publish(channel: string, message: string): Promise<number> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      this.stats.commands++;
      return await this.cluster.publish(channel, message);
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Cluster-specific operations
   */
  async getClusterInfo(): Promise<string> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      return await this.cluster.cluster('INFO');
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  async getClusterNodes(): Promise<string> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      return await this.cluster.cluster('NODES');
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * Get cluster statistics
   */
  getStats(): ClusterStats {
    return { ...this.stats };
  }

  /**
   * Health check for cluster
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    activeNodes: number;
    totalNodes: number;
    errors: number;
    lastUpdate: Date;
  }> {
    const activeNodes = this.stats.activeNodes;
    const totalNodes = this.stats.nodes;
    const healthyNodeRatio = totalNodes > 0 ? activeNodes / totalNodes : 0;

    let status: 'healthy' | 'degraded' | 'unhealthy';
    
    if (healthyNodeRatio >= 1.0) {
      status = 'healthy';
    } else if (healthyNodeRatio >= 0.5) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }

    return {
      status,
      activeNodes,
      totalNodes,
      errors: this.stats.errors,
      lastUpdate: this.stats.lastUpdate
    };
  }

  /**
   * Failover to another master
   */
  async failover(nodeId?: string): Promise<void> {
    if (!this.cluster) throw new Error('Cluster not connected');
    
    try {
      if (nodeId) {
        await this.cluster.cluster('FAILOVER', nodeId);
      } else {
        await this.cluster.cluster('FAILOVER');
      }
      console.log('Cluster failover initiated');
    } catch (error) {
      console.error('Cluster failover failed:', error);
      throw error;
    }
  }

  /**
   * Get node by key (for debugging)
   */
  getNodeByKey(key: string): string {
    // Simple hash slot calculation (Redis uses CRC16)
    const slot = this.calculateSlot(key);
    const node = this.stats.nodeHealth.find(n => n.slots.includes(slot));
    return node ? `${node.host}:${node.port}` : 'unknown';
  }

  /**
   * Calculate Redis hash slot for a key
   */
  private calculateSlot(key: string): number {
    // Simplified slot calculation - in production, use the actual CRC16 implementation
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = ((hash << 5) - hash + key.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash) % 16384;
  }

  /**
   * Disconnect from cluster
   */
  async disconnect(): Promise<void> {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    if (this.cluster) {
      try {
        await this.cluster.quit();
        console.log('Disconnected from Redis Cluster');
      } catch (error) {
        console.error('Error disconnecting from Redis Cluster:', error);
      }
    }

    this.emit('disconnected');
  }
}

/**
 * Session management with cluster support
 */
export class ClusterSessionManager {
  private cluster: RedisClusterManager;
  private sessionPrefix = 'session:';
  private defaultTTL = 3600; // 1 hour

  constructor(cluster: RedisClusterManager) {
    this.cluster = cluster;
  }

  async storeSession(sessionId: string, data: any, ttl?: number): Promise<void> {
    const key = `${this.sessionPrefix}${sessionId}`;
    const serializedData = JSON.stringify(data);
    await this.cluster.set(key, serializedData, ttl || this.defaultTTL);
  }

  async getSession(sessionId: string): Promise<any | null> {
    const key = `${this.sessionPrefix}${sessionId}`;
    const data = await this.cluster.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const key = `${this.sessionPrefix}${sessionId}`;
    const result = await this.cluster.del(key);
    return result > 0;
  }

  async extendSession(sessionId: string, ttl?: number): Promise<void> {
    const session = await this.getSession(sessionId);
    if (session) {
      await this.storeSession(sessionId, session, ttl || this.defaultTTL);
    }
  }

  async getAllUserSessions(userId: string): Promise<string[]> {
    // This is a simplified implementation - in production, you might want to maintain a separate index
    const pattern = `${this.sessionPrefix}*`;
    const keys: string[] = []; // Note: KEYS command doesn't work well with Redis Cluster
    
    // In a real implementation, you'd use SCAN on each node or maintain session indexes
    console.warn('getAllUserSessions is not cluster-optimized - consider using session indexes');
    
    return keys;
  }
}