import cluster from 'cluster';
import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import { ClusterManager, WorkerUtils } from '../cluster/cluster-manager';
import { RedisClusterManager } from './redis-cluster';
import { LoadBalancer, WebSocketLoadBalancer } from './load-balancer';
import { HealthMonitor } from './health-monitor';
import { AutoScaler } from './auto-scaler';
import { MetricsCollector } from './metrics-collector';

// Load environment variables
dotenv.config();

interface ScalingConfig {
  cluster: {
    enabled: boolean;
    workers?: number;
  };
  redis: {
    cluster: boolean;
    nodes: Array<{ host: string; port: number }>;
  };
  loadBalancer: {
    enabled: boolean;
    algorithm: 'round-robin' | 'least-connections' | 'weighted' | 'ip-hash';
  };
  autoScaling: {
    enabled: boolean;
    minInstances: number;
    maxInstances: number;
  };
  monitoring: {
    enabled: boolean;
    healthChecks: boolean;
    metrics: boolean;
  };
}

export class ScalingServer {
  private config: ScalingConfig;
  private clusterManager?: ClusterManager;
  private redisCluster?: RedisClusterManager;
  private loadBalancer?: LoadBalancer;
  private wsLoadBalancer?: WebSocketLoadBalancer;
  private healthMonitor?: HealthMonitor;
  private autoScaler?: AutoScaler;
  private metricsCollector?: MetricsCollector;
  private workerUtils?: WorkerUtils;
  private app?: express.Application;
  private server?: http.Server;
  private wss?: WebSocket.Server;

  constructor(config: Partial<ScalingConfig> = {}) {
    this.config = {
      cluster: {
        enabled: process.env.CLUSTER_ENABLED === 'true',
        workers: parseInt(process.env.CLUSTER_WORKERS || '0') || undefined
      },
      redis: {
        cluster: process.env.REDIS_CLUSTER_ENABLED === 'true',
        nodes: this.parseRedisNodes()
      },
      loadBalancer: {
        enabled: process.env.LOAD_BALANCER_ENABLED === 'true',
        algorithm: (process.env.LB_ALGORITHM as any) || 'round-robin'
      },
      autoScaling: {
        enabled: process.env.AUTO_SCALING_ENABLED === 'true',
        minInstances: parseInt(process.env.MIN_INSTANCES || '1'),
        maxInstances: parseInt(process.env.MAX_INSTANCES || '10')
      },
      monitoring: {
        enabled: process.env.MONITORING_ENABLED !== 'false',
        healthChecks: process.env.HEALTH_CHECKS_ENABLED !== 'false',
        metrics: process.env.METRICS_ENABLED !== 'false'
      },
      ...config
    };
  }

  /**
   * Parse Redis cluster nodes from environment
   */
  private parseRedisNodes(): Array<{ host: string; port: number }> {
    const nodesEnv = process.env.REDIS_CLUSTER_NODES;
    if (nodesEnv) {
      return nodesEnv.split(',').map(node => {
        const [host, port] = node.split(':');
        return { host: host.trim(), port: parseInt(port) || 6379 };
      });
    }
    
    // Default cluster nodes
    return [
      { host: '127.0.0.1', port: 7000 },
      { host: '127.0.0.1', port: 7001 },
      { host: '127.0.0.1', port: 7002 }
    ];
  }

  /**
   * Start the scaling server
   */
  async start(): Promise<void> {
    console.log('🚀 Starting Web3 Chat Roulette with scaling architecture...');
    console.log('Configuration:', {
      cluster: this.config.cluster.enabled,
      redisCluster: this.config.redis.cluster,
      loadBalancer: this.config.loadBalancer.enabled,
      autoScaling: this.config.autoScaling.enabled,
      monitoring: this.config.monitoring.enabled
    });

    if (this.config.cluster.enabled && cluster.isPrimary) {
      await this.startAsPrimary();
    } else {
      await this.startAsWorker();
    }
  }

  /**
   * Start as cluster primary (master)
   */
  private async startAsPrimary(): Promise<void> {
    console.log('🎛️  Starting as cluster primary...');

    // Initialize monitoring components
    if (this.config.monitoring.enabled) {
      await this.initializeMonitoring();
    }

    // Initialize Redis cluster
    if (this.config.redis.cluster) {
      await this.initializeRedisCluster();
    }

    // Initialize load balancer
    if (this.config.loadBalancer.enabled) {
      await this.initializeLoadBalancer();
    }

    // Initialize cluster manager
    this.clusterManager = new ClusterManager({
      workers: this.config.cluster.workers,
      autoRestart: true,
      maxRestarts: 5,
      gracefulShutdownTimeout: 30000
    });

    // Setup cluster event handlers
    this.setupClusterEventHandlers();

    // Initialize auto-scaler
    if (this.config.autoScaling.enabled && this.healthMonitor) {
      await this.initializeAutoScaler();
    }

    // Start cluster
    this.clusterManager.start();

    // Setup management endpoints
    this.setupManagementServer();
  }

  /**
   * Start as worker process
   */
  private async startAsWorker(): Promise<void> {
    console.log(`👷 Starting as worker (PID: ${process.pid})...`);

    // Initialize worker utilities
    this.workerUtils = new WorkerUtils();

    // Initialize monitoring
    if (this.config.monitoring.enabled) {
      await this.initializeWorkerMonitoring();
    }

    // Initialize Redis (single instance or cluster)
    if (this.config.redis.cluster) {
      await this.initializeRedisCluster();
    } else {
      // Use existing Redis initialization
      const { initializeRedis } = await import('../utils/redis');
      await initializeRedis();
    }

    // Start the main application
    await this.startApplication();

    // Start health reporting
    if (this.workerUtils) {
      this.workerUtils.startHealthReporting();
      this.workerUtils.startMetricsReporting();
    }

    console.log(`✅ Worker ${cluster.worker?.id} (PID: ${process.pid}) is ready`);
  }

  /**
   * Initialize monitoring components
   */
  private async initializeMonitoring(): Promise<void> {
    if (this.config.monitoring.healthChecks) {
      this.healthMonitor = new HealthMonitor({
        memory: { warning: 80, critical: 90 },
        cpu: { warning: 70, critical: 85 },
        responseTime: { warning: 1000, critical: 3000 },
        errorRate: { warning: 5, critical: 10 }
      }, {
        enabled: true,
        channels: ['console'],
        rateLimit: { window: 300000, maxAlerts: 5 }
      });

      this.healthMonitor.start();
      console.log('✅ Health monitoring initialized');
    }

    if (this.config.monitoring.metrics) {
      this.metricsCollector = new MetricsCollector({
        enabled: true,
        collectInterval: 15000,
        retentionPeriod: 24 * 60 * 60 * 1000 // 24 hours
      });

      this.metricsCollector.start();
      console.log('✅ Metrics collection initialized');
    }
  }

  /**
   * Initialize worker-level monitoring
   */
  private async initializeWorkerMonitoring(): Promise<void> {
    if (this.config.monitoring.metrics) {
      this.metricsCollector = new MetricsCollector({
        enabled: true,
        collectInterval: 15000,
        retentionPeriod: 4 * 60 * 60 * 1000 // 4 hours for workers
      });

      this.metricsCollector.start();
    }
  }

  /**
   * Initialize Redis cluster
   */
  private async initializeRedisCluster(): Promise<void> {
    this.redisCluster = new RedisClusterManager({
      nodes: this.config.redis.nodes
    });

    await this.redisCluster.connect();
    console.log('✅ Redis cluster initialized');
  }

  /**
   * Initialize load balancer
   */
  private async initializeLoadBalancer(): Promise<void> {
    this.loadBalancer = new LoadBalancer({
      algorithm: this.config.loadBalancer.algorithm,
      healthCheck: {
        enabled: true,
        interval: 30000,
        timeout: 5000,
        path: '/health',
        expectedStatus: 200,
        maxRetries: 3
      },
      stickySession: {
        enabled: false,
        cookieName: 'session-id',
        ttl: 3600000
      }
    });

    this.wsLoadBalancer = new WebSocketLoadBalancer({
      algorithm: this.config.loadBalancer.algorithm,
      stickySession: {
        enabled: true,
        cookieName: 'ws-session',
        ttl: 3600000
      }
    });

    console.log('✅ Load balancers initialized');
  }

  /**
   * Initialize auto-scaler
   */
  private async initializeAutoScaler(): Promise<void> {
    if (!this.healthMonitor) {
      throw new Error('Health monitor required for auto-scaling');
    }

    this.autoScaler = new AutoScaler(this.healthMonitor, {
      enabled: true,
      evaluationInterval: 60000,
      constraints: {
        minInstances: this.config.autoScaling.minInstances,
        maxInstances: this.config.autoScaling.maxInstances,
        maxScaleUpPerInterval: 2,
        maxScaleDownPerInterval: 1
      }
    });

    if (this.clusterManager) {
      this.autoScaler.setClusterManager(this.clusterManager);
    }

    if (this.loadBalancer) {
      this.autoScaler.setLoadBalancer(this.loadBalancer);
    }

    this.autoScaler.start();
    console.log('✅ Auto-scaler initialized');
  }

  /**
   * Setup cluster event handlers
   */
  private setupClusterEventHandlers(): void {
    if (!this.clusterManager) return;

    this.clusterManager.on('workerHealth', (data) => {
      console.log(`💓 Worker ${data.workerId} health:`, data.health);
      
      if (this.healthMonitor) {
        // Update health monitor with worker data
        this.healthMonitor.updateClusterMetrics({
          workerId: data.workerId,
          workers: this.clusterManager!.getStatus().totalWorkers,
          restarts: 0 // Would be tracked separately
        });
      }
    });

    this.clusterManager.on('workerError', (data) => {
      console.error(`❌ Worker ${data.workerId} error:`, data.error);
      
      if (this.metricsCollector) {
        this.metricsCollector.recordError(`worker-${data.workerId}`);
      }
    });

    this.clusterManager.on('scaled', (data) => {
      console.log(`📊 Cluster scaled: ${data.currentWorkers} → ${data.targetWorkers}`);
    });
  }

  /**
   * Setup management server for cluster primary
   */
  private setupManagementServer(): void {
    const managementApp = express();
    managementApp.use(express.json());
    managementApp.use(cors());

    // Cluster status endpoint
    managementApp.get('/cluster/status', (req, res) => {
      const status = this.clusterManager?.getStatus() || {};
      res.json(status);
    });

    // Health status endpoint
    managementApp.get('/health/cluster', async (req, res) => {
      const health = await this.healthMonitor?.performHealthCheck();
      res.json(health || { status: 'unknown' });
    });

    // Metrics endpoint
    managementApp.get('/metrics', (req, res) => {
      if (this.metricsCollector) {
        res.type('text/plain');
        res.send(this.metricsCollector.exportPrometheus());
      } else {
        res.status(404).json({ error: 'Metrics not available' });
      }
    });

    // Auto-scaler status
    managementApp.get('/scaling/status', (req, res) => {
      const stats = this.autoScaler?.getStats();
      res.json(stats || { enabled: false });
    });

    // Manual scaling endpoint
    managementApp.post('/scaling/manual', async (req, res) => {
      const { instances, reason } = req.body;
      
      try {
        await this.autoScaler?.manualScale(instances, reason);
        res.json({ success: true, message: 'Scaling initiated' });
      } catch (error) {
        res.status(400).json({ error: error.message });
      }
    });

    // Load balancer status
    managementApp.get('/loadbalancer/status', (req, res) => {
      const stats = this.loadBalancer?.getStats();
      res.json(stats || { enabled: false });
    });

    // Redis cluster status
    managementApp.get('/redis/status', async (req, res) => {
      if (this.redisCluster) {
        const health = await this.redisCluster.healthCheck();
        const stats = this.redisCluster.getStats();
        res.json({ health, stats });
      } else {
        res.status(404).json({ error: 'Redis cluster not available' });
      }
    });

    const managementPort = parseInt(process.env.MANAGEMENT_PORT || '9000');
    managementApp.listen(managementPort, () => {
      console.log(`🎛️  Management server listening on port ${managementPort}`);
    });
  }

  /**
   * Start the main application (worker process)
   */
  private async startApplication(): Promise<void> {
    // Import and initialize the original application
    const {
      initializeDatabase,
      createTables,
      healthCheck,
      performanceMonitor,
      optimizer,
      cacheManager
    } = await import('../utils/database');

    const { signalingService } = await import('../services/signaling-service');
    const { webrtcService } = await import('../services/webrtc-service');

    // Initialize database
    await initializeDatabase();
    await createTables();

    // Create Express app
    this.app = express();
    this.server = http.createServer(this.app);

    // Setup middleware and routes (simplified version)
    this.app.use(cors());
    this.app.use(express.json());

    // Health endpoint with scaling info
    this.app.get('/health', async (req, res) => {
      try {
        const dbHealth = await healthCheck();
        const redisStats = this.redisCluster?.getStats();
        const workerHealth = this.metricsCollector?.getCurrentSystemMetrics();

        res.json({
          status: 'healthy',
          worker: {
            id: cluster.worker?.id,
            pid: process.pid,
            uptime: process.uptime()
          },
          database: dbHealth,
          redis: redisStats,
          system: workerHealth,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Metrics endpoint for worker
    this.app.get('/metrics', (req, res) => {
      if (this.metricsCollector) {
        res.json(this.metricsCollector.getDashboardData());
      } else {
        res.status(404).json({ error: 'Metrics not available' });
      }
    });

    // WebSocket server with load balancing support
    this.wss = new WebSocket.Server({ 
      server: this.server,
      verifyClient: this.verifyWebSocketClient.bind(this)
    });

    this.wss.on('connection', this.handleWebSocketConnection.bind(this));

    // Start server
    const PORT = process.env.PORT || 3001;
    const HOST = process.env.HOST || '0.0.0.0';

    this.server.listen(parseInt(PORT.toString()), HOST, () => {
      console.log(`🚀 Worker server running on ${HOST}:${PORT}`);
      console.log(`   Worker ID: ${cluster.worker?.id || 'standalone'}`);
      console.log(`   Process ID: ${process.pid}`);
    });

    // Setup graceful shutdown
    this.setupGracefulShutdown();
  }

  /**
   * Verify WebSocket client connection
   */
  private verifyWebSocketClient(info: any): boolean {
    // Add custom WebSocket verification logic here
    // Could include rate limiting, authentication, etc.
    return true;
  }

  /**
   * Handle WebSocket connection
   */
  private handleWebSocketConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const clientIp = req.socket.remoteAddress || 'unknown';
    
    console.log(`📡 New WebSocket connection from ${clientIp} (Worker: ${cluster.worker?.id})`);

    // Update connection metrics
    if (this.metricsCollector) {
      this.metricsCollector.updateConnections({ websockets: 1 });
    }

    // Handle connection events
    ws.on('close', () => {
      if (this.metricsCollector) {
        this.metricsCollector.updateConnections({ websockets: -1 });
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      if (this.metricsCollector) {
        this.metricsCollector.recordError('websocket');
      }
    });
  }

  /**
   * Setup graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const shutdown = async (signal: string) => {
      console.log(`📡 Received ${signal}. Starting graceful shutdown...`);

      // Stop accepting new connections
      if (this.server) {
        this.server.close();
      }

      // Close WebSocket connections
      if (this.wss) {
        this.wss.clients.forEach(ws => ws.close());
      }

      // Stop monitoring
      this.metricsCollector?.stop();
      this.healthMonitor?.stop();
      this.autoScaler?.stop();

      // Disconnect from Redis
      await this.redisCluster?.disconnect();

      console.log('✅ Graceful shutdown completed');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  /**
   * Get scaling status
   */
  getStatus(): {
    cluster: any;
    health: any;
    autoScaler: any;
    loadBalancer: any;
    redis: any;
    metrics: any;
  } {
    return {
      cluster: this.clusterManager?.getStatus(),
      health: this.healthMonitor?.getHealthSummary(),
      autoScaler: this.autoScaler?.getStats(),
      loadBalancer: this.loadBalancer?.getStats(),
      redis: this.redisCluster?.getStats(),
      metrics: this.metricsCollector?.getStats()
    };
  }
}

// Start the scaling server if this file is run directly
if (require.main === module) {
  const scalingServer = new ScalingServer();
  scalingServer.start().catch(error => {
    console.error('❌ Failed to start scaling server:', error);
    process.exit(1);
  });
}