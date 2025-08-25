import { EventEmitter } from 'events';
import os from 'os';
import { performance } from 'perf_hooks';

interface HealthMetrics {
  timestamp: Date;
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  memory: {
    used: number;
    free: number;
    total: number;
    usage: number;
  };
  cpu: {
    load: number[];
    usage: number;
    cores: number;
  };
  database: {
    status: 'connected' | 'disconnected' | 'error';
    latency: number;
    connections: number;
    errors: number;
  };
  redis: {
    status: 'connected' | 'disconnected' | 'error';
    latency: number;
    memory: number;
    connections: number;
    errors: number;
  };
  application: {
    activeConnections: number;
    requestsPerSecond: number;
    responseTime: number;
    errorRate: number;
  };
  cluster?: {
    workerId: number;
    workers: number;
    restarts: number;
  };
}

interface HealthThresholds {
  memory: { warning: number; critical: number };
  cpu: { warning: number; critical: number };
  responseTime: { warning: number; critical: number };
  errorRate: { warning: number; critical: number };
  database: { latency: number };
  redis: { latency: number };
}

interface AlertConfig {
  enabled: boolean;
  channels: Array<'console' | 'webhook' | 'email'>;
  webhook?: {
    url: string;
    timeout: number;
  };
  email?: {
    smtp: string;
    recipients: string[];
  };
  rateLimit: {
    window: number; // milliseconds
    maxAlerts: number;
  };
}

export class HealthMonitor extends EventEmitter {
  private metrics: HealthMetrics;
  private thresholds: HealthThresholds;
  private alertConfig: AlertConfig;
  private monitoringInterval?: NodeJS.Timeout;
  private lastCpuUsage = process.cpuUsage();
  private requestCount = 0;
  private errorCount = 0;
  private responseTimeSum = 0;
  private responseTimeCount = 0;
  private activeConnections = 0;
  private alertHistory: Map<string, Date[]> = new Map();

  constructor(
    thresholds: Partial<HealthThresholds> = {},
    alertConfig: Partial<AlertConfig> = {}
  ) {
    super();

    this.thresholds = {
      memory: { warning: 80, critical: 95 },
      cpu: { warning: 70, critical: 90 },
      responseTime: { warning: 1000, critical: 5000 },
      errorRate: { warning: 5, critical: 10 },
      database: { latency: 100 },
      redis: { latency: 50 },
      ...thresholds
    };

    this.alertConfig = {
      enabled: true,
      channels: ['console'],
      rateLimit: { window: 300000, maxAlerts: 10 }, // 5 minutes, max 10 alerts
      ...alertConfig
    };

    this.metrics = this.initializeMetrics();
  }

  /**
   * Initialize default metrics
   */
  private initializeMetrics(): HealthMetrics {
    return {
      timestamp: new Date(),
      status: 'healthy',
      uptime: process.uptime(),
      memory: {
        used: 0,
        free: 0,
        total: 0,
        usage: 0
      },
      cpu: {
        load: [],
        usage: 0,
        cores: os.cpus().length
      },
      database: {
        status: 'disconnected',
        latency: 0,
        connections: 0,
        errors: 0
      },
      redis: {
        status: 'disconnected',
        latency: 0,
        memory: 0,
        connections: 0,
        errors: 0
      },
      application: {
        activeConnections: 0,
        requestsPerSecond: 0,
        responseTime: 0,
        errorRate: 0
      }
    };
  }

  /**
   * Start health monitoring
   */
  start(interval: number = 30000): void {
    console.log(`🏥 Starting health monitoring (interval: ${interval}ms)`);
    
    this.monitoringInterval = setInterval(async () => {
      await this.collectMetrics();
      await this.evaluateHealth();
    }, interval);

    // Immediate health check
    setImmediate(() => {
      this.collectMetrics().then(() => this.evaluateHealth());
    });
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }
    console.log('🛑 Health monitoring stopped');
  }

  /**
   * Collect system metrics
   */
  private async collectMetrics(): Promise<void> {
    const timestamp = new Date();

    // Memory metrics
    const memUsage = process.memoryUsage();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    
    // CPU metrics
    const cpuUsage = process.cpuUsage(this.lastCpuUsage);
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000 / 1 * 100; // Rough calculation
    this.lastCpuUsage = process.cpuUsage();

    // Application metrics
    const responseTime = this.responseTimeCount > 0 ? 
      this.responseTimeSum / this.responseTimeCount : 0;
    const errorRate = this.requestCount > 0 ? 
      (this.errorCount / this.requestCount) * 100 : 0;

    this.metrics = {
      timestamp,
      status: 'healthy', // Will be updated in evaluateHealth
      uptime: process.uptime(),
      memory: {
        used: memUsage.heapUsed,
        free: freeMemory,
        total: totalMemory,
        usage: (memUsage.heapUsed / memUsage.heapTotal) * 100
      },
      cpu: {
        load: os.loadavg(),
        usage: cpuPercent,
        cores: os.cpus().length
      },
      database: {
        status: 'connected', // Will be updated by external services
        latency: 0,
        connections: 0,
        errors: 0
      },
      redis: {
        status: 'connected', // Will be updated by external services
        latency: 0,
        memory: 0,
        connections: 0,
        errors: 0
      },
      application: {
        activeConnections: this.activeConnections,
        requestsPerSecond: this.requestCount, // Approximate
        responseTime,
        errorRate
      }
    };

    // Reset counters for next interval
    this.requestCount = 0;
    this.errorCount = 0;
    this.responseTimeSum = 0;
    this.responseTimeCount = 0;

    this.emit('metricsCollected', this.metrics);
  }

  /**
   * Evaluate overall health status
   */
  private async evaluateHealth(): Promise<void> {
    const issues: string[] = [];
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

    // Memory evaluation
    if (this.metrics.memory.usage >= this.thresholds.memory.critical) {
      issues.push(`Critical memory usage: ${this.metrics.memory.usage.toFixed(1)}%`);
      status = 'unhealthy';
    } else if (this.metrics.memory.usage >= this.thresholds.memory.warning) {
      issues.push(`High memory usage: ${this.metrics.memory.usage.toFixed(1)}%`);
      if (status === 'healthy') status = 'degraded';
    }

    // CPU evaluation
    if (this.metrics.cpu.usage >= this.thresholds.cpu.critical) {
      issues.push(`Critical CPU usage: ${this.metrics.cpu.usage.toFixed(1)}%`);
      status = 'unhealthy';
    } else if (this.metrics.cpu.usage >= this.thresholds.cpu.warning) {
      issues.push(`High CPU usage: ${this.metrics.cpu.usage.toFixed(1)}%`);
      if (status === 'healthy') status = 'degraded';
    }

    // Response time evaluation
    if (this.metrics.application.responseTime >= this.thresholds.responseTime.critical) {
      issues.push(`Critical response time: ${this.metrics.application.responseTime.toFixed(0)}ms`);
      status = 'unhealthy';
    } else if (this.metrics.application.responseTime >= this.thresholds.responseTime.warning) {
      issues.push(`High response time: ${this.metrics.application.responseTime.toFixed(0)}ms`);
      if (status === 'healthy') status = 'degraded';
    }

    // Error rate evaluation
    if (this.metrics.application.errorRate >= this.thresholds.errorRate.critical) {
      issues.push(`Critical error rate: ${this.metrics.application.errorRate.toFixed(1)}%`);
      status = 'unhealthy';
    } else if (this.metrics.application.errorRate >= this.thresholds.errorRate.warning) {
      issues.push(`High error rate: ${this.metrics.application.errorRate.toFixed(1)}%`);
      if (status === 'healthy') status = 'degraded';
    }

    // Database evaluation
    if (this.metrics.database.status === 'error') {
      issues.push('Database connection error');
      status = 'unhealthy';
    } else if (this.metrics.database.status === 'disconnected') {
      issues.push('Database disconnected');
      status = 'unhealthy';
    } else if (this.metrics.database.latency > this.thresholds.database.latency) {
      issues.push(`High database latency: ${this.metrics.database.latency}ms`);
      if (status === 'healthy') status = 'degraded';
    }

    // Redis evaluation
    if (this.metrics.redis.status === 'error') {
      issues.push('Redis connection error');
      if (status === 'healthy') status = 'degraded'; // Redis issues are less critical
    } else if (this.metrics.redis.status === 'disconnected') {
      issues.push('Redis disconnected');
      if (status === 'healthy') status = 'degraded';
    } else if (this.metrics.redis.latency > this.thresholds.redis.latency) {
      issues.push(`High Redis latency: ${this.metrics.redis.latency}ms`);
      if (status === 'healthy') status = 'degraded';
    }

    // Update status
    const previousStatus = this.metrics.status;
    this.metrics.status = status;

    // Emit health events
    this.emit('healthEvaluated', { status, issues, metrics: this.metrics });

    // Send alerts if status changed or critical issues found
    if (previousStatus !== status || status === 'unhealthy') {
      await this.sendHealthAlert(status, issues);
    }
  }

  /**
   * Send health alerts
   */
  private async sendHealthAlert(status: string, issues: string[]): Promise<void> {
    if (!this.alertConfig.enabled) return;

    const alertKey = `${status}-${issues.join(',')}`;
    
    // Rate limiting
    if (!this.shouldSendAlert(alertKey)) {
      return;
    }

    const alert = {
      timestamp: new Date(),
      status,
      issues,
      metrics: this.metrics,
      server: {
        hostname: os.hostname(),
        platform: os.platform(),
        pid: process.pid
      }
    };

    this.emit('healthAlert', alert);

    // Send to configured channels
    for (const channel of this.alertConfig.channels) {
      try {
        switch (channel) {
          case 'console':
            await this.sendConsoleAlert(alert);
            break;
          case 'webhook':
            await this.sendWebhookAlert(alert);
            break;
          case 'email':
            await this.sendEmailAlert(alert);
            break;
        }
      } catch (error) {
        console.error(`Failed to send alert via ${channel}:`, error);
      }
    }

    // Record alert in history
    this.recordAlert(alertKey);
  }

  /**
   * Check if alert should be sent (rate limiting)
   */
  private shouldSendAlert(alertKey: string): boolean {
    const now = new Date();
    const alerts = this.alertHistory.get(alertKey) || [];
    
    // Remove old alerts outside the window
    const cutoff = new Date(now.getTime() - this.alertConfig.rateLimit.window);
    const recentAlerts = alerts.filter(date => date > cutoff);
    
    return recentAlerts.length < this.alertConfig.rateLimit.maxAlerts;
  }

  /**
   * Record alert in history
   */
  private recordAlert(alertKey: string): void {
    const alerts = this.alertHistory.get(alertKey) || [];
    alerts.push(new Date());
    this.alertHistory.set(alertKey, alerts);
  }

  /**
   * Send console alert
   */
  private async sendConsoleAlert(alert: any): Promise<void> {
    const emoji = alert.status === 'unhealthy' ? '🚨' : '⚠️';
    console.log(`${emoji} HEALTH ALERT: ${alert.status.toUpperCase()}`);
    console.log(`Server: ${alert.server.hostname} (PID: ${alert.server.pid})`);
    console.log(`Issues: ${alert.issues.join(', ')}`);
    console.log(`Timestamp: ${alert.timestamp.toISOString()}`);
  }

  /**
   * Send webhook alert
   */
  private async sendWebhookAlert(alert: any): Promise<void> {
    if (!this.alertConfig.webhook) return;

    const payload = JSON.stringify(alert);
    
    // In a real implementation, you'd use a proper HTTP client
    console.log(`Sending webhook alert to ${this.alertConfig.webhook.url}`);
    console.log(`Payload: ${payload}`);
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(alert: any): Promise<void> {
    if (!this.alertConfig.email) return;

    // In a real implementation, you'd use a proper email service
    console.log(`Sending email alert to ${this.alertConfig.email.recipients.join(', ')}`);
    console.log(`Subject: Health Alert - ${alert.status.toUpperCase()}`);
  }

  /**
   * Update database metrics
   */
  updateDatabaseMetrics(metrics: Partial<HealthMetrics['database']>): void {
    this.metrics.database = { ...this.metrics.database, ...metrics };
  }

  /**
   * Update Redis metrics
   */
  updateRedisMetrics(metrics: Partial<HealthMetrics['redis']>): void {
    this.metrics.redis = { ...this.metrics.redis, ...metrics };
  }

  /**
   * Update cluster metrics
   */
  updateClusterMetrics(metrics: HealthMetrics['cluster']): void {
    this.metrics.cluster = metrics;
  }

  /**
   * Record HTTP request metrics
   */
  recordRequest(responseTime: number, isError: boolean = false): void {
    this.requestCount++;
    this.responseTimeSum += responseTime;
    this.responseTimeCount++;
    
    if (isError) {
      this.errorCount++;
    }
  }

  /**
   * Update connection count
   */
  updateConnectionCount(count: number): void {
    this.activeConnections = count;
  }

  /**
   * Get current health metrics
   */
  getMetrics(): HealthMetrics {
    return { ...this.metrics };
  }

  /**
   * Get health summary for load balancer
   */
  getHealthSummary(): {
    status: string;
    uptime: number;
    memory: number;
    cpu: number;
    responseTime: number;
    errorRate: number;
  } {
    return {
      status: this.metrics.status,
      uptime: this.metrics.uptime,
      memory: this.metrics.memory.usage,
      cpu: this.metrics.cpu.usage,
      responseTime: this.metrics.application.responseTime,
      errorRate: this.metrics.application.errorRate
    };
  }

  /**
   * Perform manual health check
   */
  async performHealthCheck(): Promise<HealthMetrics> {
    await this.collectMetrics();
    await this.evaluateHealth();
    return this.getMetrics();
  }

  /**
   * Set custom thresholds
   */
  setThresholds(thresholds: Partial<HealthThresholds>): void {
    this.thresholds = { ...this.thresholds, ...thresholds };
  }

  /**
   * Enable/disable alerts
   */
  setAlertEnabled(enabled: boolean): void {
    this.alertConfig.enabled = enabled;
  }

  /**
   * Add alert channel
   */
  addAlertChannel(channel: 'console' | 'webhook' | 'email'): void {
    if (!this.alertConfig.channels.includes(channel)) {
      this.alertConfig.channels.push(channel);
    }
  }

  /**
   * Remove alert channel
   */
  removeAlertChannel(channel: 'console' | 'webhook' | 'email'): void {
    const index = this.alertConfig.channels.indexOf(channel);
    if (index > -1) {
      this.alertConfig.channels.splice(index, 1);
    }
  }
}