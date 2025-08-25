import client from 'prom-client';
import logger from './logger';
import os from 'os';
import { EventEmitter } from 'events';

// Create a Registry which registers metrics
const register = new client.Registry();

// Add a default label which is added to all metrics
register.setDefaultLabels({
  app: 'web3-chat-roulette',
  env: process.env.NODE_ENV || 'development',
  version: process.env.npm_package_version || '1.0.0',
  instance: `${os.hostname()}-${process.pid}`
});

// Collect default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ register });

// HTTP Request Metrics
const httpRequestsTotal = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code', 'user_type'],
  registers: [register]
});

const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10],
  registers: [register]
});

const httpRequestSize = new client.Histogram({
  name: 'http_request_size_bytes',
  help: 'Size of HTTP request bodies in bytes',
  labelNames: ['method', 'route'],
  buckets: [100, 1000, 10000, 100000, 1000000],
  registers: [register]
});

const httpResponseSize = new client.Histogram({
  name: 'http_response_size_bytes',
  help: 'Size of HTTP response bodies in bytes',
  labelNames: ['method', 'route'],
  buckets: [100, 1000, 10000, 100000, 1000000],
  registers: [register]
});

// WebSocket Metrics
const websocketConnectionsTotal = new client.Counter({
  name: 'websocket_connections_total',
  help: 'Total number of WebSocket connections',
  labelNames: ['status'],
  registers: [register]
});

const websocketConnectionsActive = new client.Gauge({
  name: 'websocket_connections_active',
  help: 'Number of active WebSocket connections',
  registers: [register]
});

const websocketMessagesTotal = new client.Counter({
  name: 'websocket_messages_total',
  help: 'Total number of WebSocket messages',
  labelNames: ['type', 'direction'],
  registers: [register]
});

const websocketMessageSize = new client.Histogram({
  name: 'websocket_message_size_bytes',
  help: 'Size of WebSocket messages in bytes',
  labelNames: ['type', 'direction'],
  buckets: [100, 1000, 10000, 100000],
  registers: [register]
});

// Database Metrics
const databaseConnectionsActive = new client.Gauge({
  name: 'database_connections_active',
  help: 'Number of active database connections',
  labelNames: ['database'],
  registers: [register]
});

const databaseQueriesTotal = new client.Counter({
  name: 'database_queries_total',
  help: 'Total number of database queries',
  labelNames: ['operation', 'table', 'status'],
  registers: [register]
});

const databaseQueryDuration = new client.Histogram({
  name: 'database_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register]
});

// Redis Metrics
const redisConnectionsActive = new client.Gauge({
  name: 'redis_connections_active',
  help: 'Number of active Redis connections',
  registers: [register]
});

const redisOperationsTotal = new client.Counter({
  name: 'redis_operations_total',
  help: 'Total number of Redis operations',
  labelNames: ['operation', 'status'],
  registers: [register]
});

const redisOperationDuration = new client.Histogram({
  name: 'redis_operation_duration_seconds',
  help: 'Duration of Redis operations in seconds',
  labelNames: ['operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register]
});

// Web3 Metrics
const web3TransactionsTotal = new client.Counter({
  name: 'web3_transactions_total',
  help: 'Total number of Web3 transactions processed',
  labelNames: ['type', 'status', 'network'],
  registers: [register]
});

const web3TransactionDuration = new client.Histogram({
  name: 'web3_transaction_duration_seconds',
  help: 'Duration of Web3 transaction processing in seconds',
  labelNames: ['type', 'network'],
  buckets: [1, 5, 10, 30, 60, 120, 300],
  registers: [register]
});

const web3GasCost = new client.Histogram({
  name: 'web3_gas_cost',
  help: 'Gas cost of Web3 transactions',
  labelNames: ['type', 'network'],
  buckets: [1000, 10000, 50000, 100000, 500000, 1000000, 5000000],
  registers: [register]
});

// WebRTC Metrics
const webrtcSessionsTotal = new client.Counter({
  name: 'webrtc_sessions_total',
  help: 'Total number of WebRTC sessions',
  labelNames: ['status'],
  registers: [register]
});

const webrtcSessionsActive = new client.Gauge({
  name: 'webrtc_sessions_active',
  help: 'Number of active WebRTC sessions',
  registers: [register]
});

const webrtcSessionDuration = new client.Histogram({
  name: 'webrtc_session_duration_seconds',
  help: 'Duration of WebRTC sessions in seconds',
  buckets: [10, 30, 60, 180, 300, 600, 1800, 3600],
  registers: [register]
});

const webrtcMatchmakingTime = new client.Histogram({
  name: 'webrtc_matchmaking_duration_seconds',
  help: 'Duration of matchmaking process in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register]
});

// Error Metrics
const errorsTotal = new client.Counter({
  name: 'errors_total',
  help: 'Total number of errors',
  labelNames: ['type', 'severity', 'component'],
  registers: [register]
});

const errorRate = new client.Gauge({
  name: 'error_rate',
  help: 'Rate of errors per minute',
  labelNames: ['component'],
  registers: [register]
});

// Business Metrics
const usersActive = new client.Gauge({
  name: 'users_active',
  help: 'Number of active users',
  labelNames: ['timeframe'],
  registers: [register]
});

const userActionsTotal = new client.Counter({
  name: 'user_actions_total',
  help: 'Total number of user actions',
  labelNames: ['action', 'user_type'],
  registers: [register]
});

const matchmakingQueueSize = new client.Gauge({
  name: 'matchmaking_queue_size',
  help: 'Size of matchmaking queue',
  labelNames: ['queue_type'],
  registers: [register]
});

const chatMessagesTotal = new client.Counter({
  name: 'chat_messages_total',
  help: 'Total number of chat messages',
  labelNames: ['type'],
  registers: [register]
});

// Performance Metrics
const responseTimesP99 = new client.Gauge({
  name: 'response_time_p99_seconds',
  help: '99th percentile response time',
  labelNames: ['endpoint'],
  registers: [register]
});

const memoryUsageBytes = new client.Gauge({
  name: 'memory_usage_bytes',
  help: 'Memory usage in bytes',
  labelNames: ['type'],
  registers: [register]
});

const cpuUsagePercent = new client.Gauge({
  name: 'cpu_usage_percent',
  help: 'CPU usage percentage',
  registers: [register]
});

// Health Check Metrics
const healthCheckStatus = new client.Gauge({
  name: 'health_check_status',
  help: 'Health check status (1 = healthy, 0 = unhealthy)',
  labelNames: ['component'],
  registers: [register]
});

const healthCheckDuration = new client.Histogram({
  name: 'health_check_duration_seconds',
  help: 'Duration of health checks in seconds',
  labelNames: ['component'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  registers: [register]
});

// Custom Metrics Manager
export class MetricsManager extends EventEmitter {
  private requestTimers: Map<string, number> = new Map();
  private activeConnections: Map<string, number> = new Map();
  private errorCounts: Map<string, number> = new Map();

  constructor() {
    super();
    this.startPeriodicCollection();
  }

  /**
   * Record HTTP request metrics
   */
  recordHttpRequest(req: any, res: any, startTime: number): void {
    const duration = (Date.now() - startTime) / 1000;
    const route = this.extractRoute(req.route?.path || req.path);
    const method = req.method;
    const statusCode = res.statusCode.toString();
    const userType = req.user ? 'authenticated' : 'anonymous';

    httpRequestsTotal.inc({ method, route, status_code: statusCode, user_type: userType });
    httpRequestDuration.observe({ method, route, status_code: statusCode }, duration);

    if (req.body && req.get('content-length')) {
      httpRequestSize.observe({ method, route }, parseInt(req.get('content-length')));
    }

    const responseLength = res.get('content-length');
    if (responseLength) {
      httpResponseSize.observe({ method, route }, parseInt(responseLength));
    }
  }

  /**
   * Record WebSocket connection metrics
   */
  recordWebSocketConnection(status: 'connected' | 'disconnected', clientId?: string): void {
    websocketConnectionsTotal.inc({ status });
    
    if (status === 'connected') {
      this.activeConnections.set(`ws_${clientId}`, Date.now());
      websocketConnectionsActive.inc();
    } else {
      if (clientId) {
        this.activeConnections.delete(`ws_${clientId}`);
      }
      websocketConnectionsActive.dec();
    }
  }

  /**
   * Record WebSocket message metrics
   */
  recordWebSocketMessage(type: string, direction: 'inbound' | 'outbound', size: number): void {
    websocketMessagesTotal.inc({ type, direction });
    websocketMessageSize.observe({ type, direction }, size);
  }

  /**
   * Record database query metrics
   */
  recordDatabaseQuery(operation: string, table: string, startTime: number, success: boolean): void {
    const duration = (Date.now() - startTime) / 1000;
    const status = success ? 'success' : 'error';

    databaseQueriesTotal.inc({ operation, table, status });
    databaseQueryDuration.observe({ operation, table }, duration);
  }

  /**
   * Update database connection count
   */
  updateDatabaseConnections(database: string, count: number): void {
    databaseConnectionsActive.set({ database }, count);
  }

  /**
   * Record Redis operation metrics
   */
  recordRedisOperation(operation: string, startTime: number, success: boolean): void {
    const duration = (Date.now() - startTime) / 1000;
    const status = success ? 'success' : 'error';

    redisOperationsTotal.inc({ operation, status });
    redisOperationDuration.observe({ operation }, duration);
  }

  /**
   * Update Redis connection count
   */
  updateRedisConnections(count: number): void {
    redisConnectionsActive.set(count);
  }

  /**
   * Record Web3 transaction metrics
   */
  recordWeb3Transaction(type: string, network: string, startTime: number, success: boolean, gasCost?: number): void {
    const duration = (Date.now() - startTime) / 1000;
    const status = success ? 'success' : 'error';

    web3TransactionsTotal.inc({ type, status, network });
    web3TransactionDuration.observe({ type, network }, duration);

    if (gasCost) {
      web3GasCost.observe({ type, network }, gasCost);
    }
  }

  /**
   * Record WebRTC session metrics
   */
  recordWebRTCSession(status: 'started' | 'ended', sessionId?: string, duration?: number): void {
    webrtcSessionsTotal.inc({ status });

    if (status === 'started') {
      this.activeConnections.set(`webrtc_${sessionId}`, Date.now());
      webrtcSessionsActive.inc();
    } else {
      if (sessionId) {
        this.activeConnections.delete(`webrtc_${sessionId}`);
      }
      webrtcSessionsActive.dec();

      if (duration) {
        webrtcSessionDuration.observe(duration);
      }
    }
  }

  /**
   * Record matchmaking metrics
   */
  recordMatchmaking(duration: number, queueSize: number): void {
    webrtcMatchmakingTime.observe(duration);
    matchmakingQueueSize.set({ queue_type: 'general' }, queueSize);
  }

  /**
   * Record error metrics
   */
  recordError(type: string, severity: string, component: string): void {
    errorsTotal.inc({ type, severity, component });
    
    // Update error count for rate calculation
    const key = `${component}_${severity}`;
    this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
  }

  /**
   * Record user action metrics
   */
  recordUserAction(action: string, userType: 'authenticated' | 'anonymous' = 'anonymous'): void {
    userActionsTotal.inc({ action, user_type: userType });
  }

  /**
   * Record chat message
   */
  recordChatMessage(type: 'text' | 'media' | 'system' = 'text'): void {
    chatMessagesTotal.inc({ type });
  }

  /**
   * Update active users count
   */
  updateActiveUsers(count: number, timeframe: '5m' | '15m' | '1h' | '24h' = '5m'): void {
    usersActive.set({ timeframe }, count);
  }

  /**
   * Record health check metrics
   */
  recordHealthCheck(component: string, healthy: boolean, duration: number): void {
    healthCheckStatus.set({ component }, healthy ? 1 : 0);
    healthCheckDuration.observe({ component }, duration);
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics(): void {
    const memUsage = process.memoryUsage();
    memoryUsageBytes.set({ type: 'heap_used' }, memUsage.heapUsed);
    memoryUsageBytes.set({ type: 'heap_total' }, memUsage.heapTotal);
    memoryUsageBytes.set({ type: 'external' }, memUsage.external);
    memoryUsageBytes.set({ type: 'rss' }, memUsage.rss);

    // CPU usage would require additional tracking
    const cpuUsage = process.cpuUsage();
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000 / os.cpus().length * 100;
    cpuUsagePercent.set(cpuPercent);
  }

  /**
   * Get metrics in Prometheus format
   */
  getPrometheusMetrics(): Promise<string> {
    return register.metrics();
  }

  /**
   * Get metrics registry
   */
  getRegistry(): client.Registry {
    return register;
  }

  /**
   * Clear all metrics (useful for testing)
   */
  clearMetrics(): void {
    register.clear();
  }

  /**
   * Get current metric values as JSON
   */
  async getMetricsJSON(): Promise<any> {
    const metrics = await register.getMetricsAsJSON();
    return {
      timestamp: new Date().toISOString(),
      metrics: metrics.reduce((acc: any, metric: any) => {
        acc[metric.name] = metric;
        return acc;
      }, {}),
      summary: {
        totalMetrics: metrics.length,
        activeConnections: this.activeConnections.size,
        errorCounts: Object.fromEntries(this.errorCounts)
      }
    };
  }

  /**
   * Extract route pattern from request
   */
  private extractRoute(path: string): string {
    if (!path) return 'unknown';
    
    // Replace dynamic segments with placeholders
    return path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '/:id')
      .replace(/\/[0-9]+/g, '/:id')
      .replace(/\/0x[a-fA-F0-9]+/g, '/:address')
      .replace(/\?.*$/, '');
  }

  /**
   * Start periodic metric collection
   */
  private startPeriodicCollection(): void {
    // Update performance metrics every 15 seconds
    setInterval(() => {
      this.updatePerformanceMetrics();
      this.calculateErrorRates();
    }, 15000);

    logger.info('Metrics collection started');
  }

  /**
   * Calculate error rates
   */
  private calculateErrorRates(): void {
    for (const [key, count] of this.errorCounts.entries()) {
      const component = key.split('_')[0];
      errorRate.set({ component }, count / 1); // Per minute rate
    }
    
    // Reset error counts after calculation
    this.errorCounts.clear();
  }
}

// Export singleton instance
export const metricsManager = new MetricsManager();

// Export individual metrics for direct usage
export {
  register,
  httpRequestsTotal,
  httpRequestDuration,
  websocketConnectionsActive,
  websocketMessagesTotal,
  databaseQueriesTotal,
  databaseQueryDuration,
  errorsTotal,
  usersActive,
  healthCheckStatus
};