import { EventEmitter } from 'events';
import { createHash } from 'crypto';

interface ServerInstance {
  id: string;
  host: string;
  port: number;
  weight: number;
  status: 'healthy' | 'unhealthy' | 'draining';
  connections: number;
  maxConnections: number;
  lastHealthCheck: Date;
  responseTime: number;
  errorRate: number;
  metadata?: Record<string, any>;
}

interface LoadBalancerConfig {
  algorithm: 'round-robin' | 'least-connections' | 'weighted' | 'ip-hash' | 'consistent-hash';
  healthCheck?: {
    enabled: boolean;
    interval: number;
    timeout: number;
    path: string;
    expectedStatus: number;
    maxRetries: number;
  };
  stickySession?: {
    enabled: boolean;
    cookieName: string;
    header?: string;
    ttl: number;
  };
  circuit?: {
    enabled: boolean;
    failureThreshold: number;
    recoveryTimeout: number;
    halfOpenMaxCalls: number;
  };
}

interface BalancingContext {
  clientIp?: string;
  sessionId?: string;
  path?: string;
  headers?: Record<string, string>;
  timestamp: number;
}

export class LoadBalancer extends EventEmitter {
  private servers: Map<string, ServerInstance> = new Map();
  private config: Required<LoadBalancerConfig>;
  private currentIndex = 0;
  private healthCheckInterval?: NodeJS.Timeout;
  private sessionMap: Map<string, string> = new Map(); // sessionId -> serverId
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();

  constructor(config: Partial<LoadBalancerConfig> = {}) {
    super();
    
    this.config = {
      algorithm: config.algorithm || 'round-robin',
      healthCheck: {
        enabled: true,
        interval: 30000,
        timeout: 5000,
        path: '/health',
        expectedStatus: 200,
        maxRetries: 3,
        ...config.healthCheck
      },
      stickySession: {
        enabled: false,
        cookieName: 'lb-session',
        ttl: 3600000, // 1 hour
        ...config.stickySession
      },
      circuit: {
        enabled: true,
        failureThreshold: 5,
        recoveryTimeout: 60000,
        halfOpenMaxCalls: 3,
        ...config.circuit
      }
    };

    if (this.config.healthCheck.enabled) {
      this.startHealthChecks();
    }
  }

  /**
   * Add server to the pool
   */
  addServer(server: Omit<ServerInstance, 'status' | 'connections' | 'lastHealthCheck' | 'responseTime' | 'errorRate'>): void {
    const instance: ServerInstance = {
      ...server,
      status: 'healthy',
      connections: 0,
      lastHealthCheck: new Date(),
      responseTime: 0,
      errorRate: 0
    };

    this.servers.set(server.id, instance);
    
    if (this.config.circuit.enabled) {
      this.circuitBreakers.set(server.id, new CircuitBreaker(this.config.circuit));
    }

    console.log(`✅ Added server ${server.id} (${server.host}:${server.port}) to load balancer`);
    this.emit('serverAdded', instance);
  }

  /**
   * Remove server from the pool
   */
  removeServer(serverId: string): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.status = 'draining';
      
      // Wait for connections to drain before removing
      const drainInterval = setInterval(() => {
        if (server.connections === 0) {
          this.servers.delete(serverId);
          this.circuitBreakers.delete(serverId);
          clearInterval(drainInterval);
          
          console.log(`🗑️  Removed server ${serverId} from load balancer`);
          this.emit('serverRemoved', serverId);
        }
      }, 1000);
    }
  }

  /**
   * Get next server based on load balancing algorithm
   */
  getNextServer(context: BalancingContext = { timestamp: Date.now() }): ServerInstance | null {
    const healthyServers = Array.from(this.servers.values())
      .filter(server => server.status === 'healthy');

    if (healthyServers.length === 0) {
      this.emit('noHealthyServers');
      return null;
    }

    // Check for sticky session
    if (this.config.stickySession.enabled && context.sessionId) {
      const stickyServerId = this.sessionMap.get(context.sessionId);
      if (stickyServerId) {
        const stickyServer = this.servers.get(stickyServerId);
        if (stickyServer && stickyServer.status === 'healthy') {
          return stickyServer;
        } else {
          // Clean up invalid session mapping
          this.sessionMap.delete(context.sessionId);
        }
      }
    }

    let selectedServer: ServerInstance | null = null;

    switch (this.config.algorithm) {
      case 'round-robin':
        selectedServer = this.roundRobinSelect(healthyServers);
        break;
      
      case 'least-connections':
        selectedServer = this.leastConnectionsSelect(healthyServers);
        break;
      
      case 'weighted':
        selectedServer = this.weightedSelect(healthyServers);
        break;
      
      case 'ip-hash':
        selectedServer = this.ipHashSelect(healthyServers, context.clientIp);
        break;
      
      case 'consistent-hash':
        selectedServer = this.consistentHashSelect(healthyServers, context.clientIp || context.sessionId);
        break;
      
      default:
        selectedServer = this.roundRobinSelect(healthyServers);
    }

    // Update session mapping for sticky sessions
    if (selectedServer && this.config.stickySession.enabled && context.sessionId) {
      this.sessionMap.set(context.sessionId, selectedServer.id);
      
      // Clean up expired sessions
      setTimeout(() => {
        this.sessionMap.delete(context.sessionId!);
      }, this.config.stickySession.ttl);
    }

    return selectedServer;
  }

  /**
   * Round-robin selection
   */
  private roundRobinSelect(servers: ServerInstance[]): ServerInstance {
    const server = servers[this.currentIndex % servers.length];
    this.currentIndex = (this.currentIndex + 1) % servers.length;
    return server;
  }

  /**
   * Least connections selection
   */
  private leastConnectionsSelect(servers: ServerInstance[]): ServerInstance {
    return servers.reduce((min, current) => 
      current.connections < min.connections ? current : min
    );
  }

  /**
   * Weighted selection
   */
  private weightedSelect(servers: ServerInstance[]): ServerInstance {
    const totalWeight = servers.reduce((sum, server) => sum + server.weight, 0);
    let random = Math.random() * totalWeight;
    
    for (const server of servers) {
      random -= server.weight;
      if (random <= 0) {
        return server;
      }
    }
    
    return servers[0]; // Fallback
  }

  /**
   * IP hash selection
   */
  private ipHashSelect(servers: ServerInstance[], clientIp?: string): ServerInstance {
    if (!clientIp) {
      return this.roundRobinSelect(servers);
    }
    
    const hash = createHash('md5').update(clientIp).digest('hex');
    const index = parseInt(hash.substring(0, 8), 16) % servers.length;
    return servers[index];
  }

  /**
   * Consistent hash selection
   */
  private consistentHashSelect(servers: ServerInstance[], key?: string): ServerInstance {
    if (!key) {
      return this.roundRobinSelect(servers);
    }
    
    // Simple consistent hashing - in production, use proper consistent hash ring
    const hash = createHash('md5').update(key).digest('hex');
    const hashValue = parseInt(hash.substring(0, 8), 16);
    
    // Sort servers by hash of their ID for consistent ordering
    const sortedServers = servers.sort((a, b) => {
      const hashA = parseInt(createHash('md5').update(a.id).digest('hex').substring(0, 8), 16);
      const hashB = parseInt(createHash('md5').update(b.id).digest('hex').substring(0, 8), 16);
      return hashA - hashB;
    });
    
    // Find the first server with hash >= key hash
    for (const server of sortedServers) {
      const serverHash = parseInt(createHash('md5').update(server.id).digest('hex').substring(0, 8), 16);
      if (serverHash >= hashValue) {
        return server;
      }
    }
    
    // Wrap around to first server
    return sortedServers[0];
  }

  /**
   * Start health check monitoring
   */
  private startHealthChecks(): void {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, this.config.healthCheck.interval);
  }

  /**
   * Perform health checks on all servers
   */
  private async performHealthChecks(): Promise<void> {
    const healthCheckPromises = Array.from(this.servers.values()).map(server => 
      this.checkServerHealth(server)
    );

    await Promise.allSettled(healthCheckPromises);
  }

  /**
   * Check health of individual server
   */
  private async checkServerHealth(server: ServerInstance): Promise<void> {
    const startTime = Date.now();
    
    try {
      // In a real implementation, you'd make an HTTP request to the health endpoint
      // For now, we'll simulate the health check
      const isHealthy = await this.simulateHealthCheck(server);
      
      const responseTime = Date.now() - startTime;
      server.responseTime = responseTime;
      server.lastHealthCheck = new Date();

      if (isHealthy) {
        if (server.status === 'unhealthy') {
          console.log(`✅ Server ${server.id} is now healthy`);
          this.emit('serverHealthy', server);
        }
        server.status = 'healthy';
        
        // Reset circuit breaker
        const circuitBreaker = this.circuitBreakers.get(server.id);
        if (circuitBreaker) {
          circuitBreaker.recordSuccess();
        }
      } else {
        throw new Error('Health check failed');
      }
    } catch (error) {
      server.status = 'unhealthy';
      server.errorRate = Math.min(server.errorRate + 1, 100);
      
      console.warn(`❌ Server ${server.id} health check failed:`, error);
      this.emit('serverUnhealthy', server);
      
      // Record failure in circuit breaker
      const circuitBreaker = this.circuitBreakers.get(server.id);
      if (circuitBreaker) {
        circuitBreaker.recordFailure();
      }
    }
  }

  /**
   * Simulate health check (replace with actual HTTP request)
   */
  private async simulateHealthCheck(server: ServerInstance): Promise<boolean> {
    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
    
    // Simulate occasional failures
    return Math.random() > 0.05; // 5% failure rate
  }

  /**
   * Record connection to server
   */
  recordConnection(serverId: string): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.connections++;
    }
  }

  /**
   * Record disconnection from server
   */
  recordDisconnection(serverId: string): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.connections = Math.max(0, server.connections - 1);
    }
  }

  /**
   * Get load balancer statistics
   */
  getStats(): {
    totalServers: number;
    healthyServers: number;
    totalConnections: number;
    algorithm: string;
    servers: ServerInstance[];
  } {
    const servers = Array.from(this.servers.values());
    
    return {
      totalServers: servers.length,
      healthyServers: servers.filter(s => s.status === 'healthy').length,
      totalConnections: servers.reduce((sum, s) => sum + s.connections, 0),
      algorithm: this.config.algorithm,
      servers: servers.map(s => ({ ...s })) // Return copies
    };
  }

  /**
   * Update server weight (for weighted algorithm)
   */
  updateServerWeight(serverId: string, weight: number): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.weight = Math.max(0, weight);
      this.emit('serverUpdated', server);
    }
  }

  /**
   * Drain server (stop sending new connections)
   */
  drainServer(serverId: string): void {
    const server = this.servers.get(serverId);
    if (server) {
      server.status = 'draining';
      console.log(`🔄 Draining server ${serverId}`);
      this.emit('serverDraining', server);
    }
  }

  /**
   * Stop health checks and clean up
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    this.servers.clear();
    this.sessionMap.clear();
    this.circuitBreakers.clear();
  }
}

/**
 * Circuit breaker implementation
 */
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;

  constructor(private config: { 
    failureThreshold: number;
    recoveryTimeout: number;
    halfOpenMaxCalls: number;
  }) {}

  recordSuccess(): void {
    this.failureCount = 0;
    this.halfOpenAttempts = 0;
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
    }
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'CLOSED' && this.failureCount >= this.config.failureThreshold) {
      this.state = 'OPEN';
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.halfOpenAttempts = 0;
    }
  }

  canExecute(): boolean {
    if (this.state === 'CLOSED') {
      return true;
    }

    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime >= this.config.recoveryTimeout) {
        this.state = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
        return true;
      }
      return false;
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenAttempts < this.config.halfOpenMaxCalls) {
        this.halfOpenAttempts++;
        return true;
      }
      return false;
    }

    return false;
  }

  getState(): string {
    return this.state;
  }
}

/**
 * WebSocket load balancer with sticky sessions
 */
export class WebSocketLoadBalancer extends LoadBalancer {
  private wsConnections: Map<string, string> = new Map(); // connectionId -> serverId

  constructor(config: Partial<LoadBalancerConfig> = {}) {
    super({
      ...config,
      stickySession: { enabled: true, ...config.stickySession }
    });
  }

  /**
   * Get server for WebSocket connection with session affinity
   */
  getServerForWebSocket(connectionId: string, context: BalancingContext): ServerInstance | null {
    // Check if connection already has an assigned server
    const existingServerId = this.wsConnections.get(connectionId);
    if (existingServerId) {
      const server = this.servers.get(existingServerId);
      if (server && server.status === 'healthy') {
        return server;
      }
      // Clean up dead connection mapping
      this.wsConnections.delete(connectionId);
    }

    // Get new server assignment
    const server = this.getNextServer(context);
    if (server) {
      this.wsConnections.set(connectionId, server.id);
      this.recordConnection(server.id);
    }

    return server;
  }

  /**
   * Remove WebSocket connection
   */
  removeWebSocketConnection(connectionId: string): void {
    const serverId = this.wsConnections.get(connectionId);
    if (serverId) {
      this.recordDisconnection(serverId);
      this.wsConnections.delete(connectionId);
    }
  }

  /**
   * Get WebSocket connection statistics
   */
  getWebSocketStats(): {
    totalConnections: number;
    connectionsByServer: Record<string, number>;
  } {
    const connectionsByServer: Record<string, number> = {};
    
    for (const serverId of this.wsConnections.values()) {
      connectionsByServer[serverId] = (connectionsByServer[serverId] || 0) + 1;
    }

    return {
      totalConnections: this.wsConnections.size,
      connectionsByServer
    };
  }
}