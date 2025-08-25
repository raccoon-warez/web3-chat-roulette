/**
 * Comprehensive Production Monitoring and Error Tracking System
 * Web3 Chat Roulette Application
 */

import logger from './logger';
import { metricsManager } from './metrics';
import { healthMonitor } from './health-monitor';
import { alertManager } from './alert-manager';
import { initializeErrorTracker } from './error-tracker';
import { UptimeMonitor, createStandardUptimeChecks } from './uptime-monitor';
import { monitoringDashboard } from './dashboard';

export interface MonitoringConfig {
  metrics: {
    enabled: boolean;
    collectInterval: number;
  };
  healthChecks: {
    enabled: boolean;
    interval: number;
  };
  alerts: {
    enabled: boolean;
    channels: string[];
  };
  uptime: {
    enabled: boolean;
    endpoints: string[];
  };
  dashboard: {
    enabled: boolean;
    port: number;
  };
  errorTracking: {
    enabled: boolean;
    captureUnhandled: boolean;
  };
}

export class MonitoringSystem {
  private config: MonitoringConfig;
  private uptimeMonitor: UptimeMonitor;
  private initialized: boolean = false;

  constructor(config: Partial<MonitoringConfig> = {}) {
    this.config = {
      metrics: {
        enabled: true,
        collectInterval: 15000
      },
      healthChecks: {
        enabled: true,
        interval: 30000
      },
      alerts: {
        enabled: true,
        channels: ['console', 'email']
      },
      uptime: {
        enabled: true,
        endpoints: []
      },
      dashboard: {
        enabled: true,
        port: 3002
      },
      errorTracking: {
        enabled: true,
        captureUnhandled: true
      },
      ...config
    };

    this.uptimeMonitor = new UptimeMonitor(alertManager);
  }

  /**
   * Initialize the complete monitoring system
   */
  async initialize(dependencies?: {
    databasePool?: any;
    redisClient?: any;
    baseUrl?: string;
  }): Promise<void> {
    try {
      logger.info('🔍 Initializing comprehensive monitoring system...');

      // Initialize error tracking
      if (this.config.errorTracking.enabled) {
        initializeErrorTracker(alertManager);
        logger.info('✅ Error tracking initialized');
      }

      // Initialize health monitoring
      if (this.config.healthChecks.enabled && dependencies) {
        await this.setupHealthChecks(dependencies);
        logger.info('✅ Health monitoring initialized');
      }

      // Initialize uptime monitoring
      if (this.config.uptime.enabled) {
        this.setupUptimeMonitoring(dependencies?.baseUrl);
        logger.info('✅ Uptime monitoring initialized');
      }

      // Start metrics collection
      if (this.config.metrics.enabled) {
        // Metrics are automatically collected via metricsManager
        logger.info('✅ Metrics collection initialized');
      }

      // Setup alert system
      if (this.config.alerts.enabled) {
        this.setupAlertRules();
        logger.info('✅ Alert system initialized');
      }

      // Initialize dashboard
      if (this.config.dashboard.enabled) {
        this.setupDashboard();
        logger.info('✅ Monitoring dashboard initialized');
      }

      this.initialized = true;

      logger.info('🎉 Comprehensive monitoring system fully initialized');
      this.logSystemStatus();

    } catch (error) {
      logger.error('❌ Failed to initialize monitoring system', {
        error: error.message,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * Setup health checks for dependencies
   */
  private async setupHealthChecks(dependencies: {
    databasePool?: any;
    redisClient?: any;
  }): Promise<void> {
    const { createDatabaseHealthCheck, createRedisHealthCheck, createSystemHealthCheck } = 
      await import('./health-monitor');

    // Register system health check
    healthMonitor.registerDependency(createSystemHealthCheck());

    // Register database health check
    if (dependencies.databasePool) {
      healthMonitor.registerDependency(createDatabaseHealthCheck(dependencies.databasePool));
    }

    // Register Redis health check
    if (dependencies.redisClient) {
      healthMonitor.registerDependency(createRedisHealthCheck(dependencies.redisClient));
    }

    // Setup health monitoring events
    healthMonitor.on('criticalFailure', ({ component, result }) => {
      logger.error('Critical health check failure', { component, result });
    });

    healthMonitor.on('recovery', ({ component }) => {
      logger.info('Health check recovered', { component });
    });

    // Start health monitoring
    healthMonitor.start(this.config.healthChecks.interval);
  }

  /**
   * Setup uptime monitoring
   */
  private setupUptimeMonitoring(baseUrl?: string): void {
    // Create standard checks if base URL provided
    if (baseUrl) {
      const standardChecks = createStandardUptimeChecks(baseUrl);
      standardChecks.forEach(check => {
        this.uptimeMonitor.addCheck(check);
      });
    }

    // Add custom endpoint checks
    this.config.uptime.endpoints.forEach((endpoint, index) => {
      this.uptimeMonitor.addCheck({
        id: `custom-endpoint-${index}`,
        name: `Custom Endpoint ${index + 1}`,
        url: endpoint,
        method: 'GET',
        timeout: 5000,
        interval: 60000, // 1 minute
        expectedStatusCode: 200,
        enabled: true,
        alertOnFailure: true,
        alertThreshold: 3
      });
    });

    // Setup uptime monitoring events
    this.uptimeMonitor.on('checkCompleted', (result) => {
      if (!result.success) {
        logger.warn('Uptime check failed', result);
      }
    });

    // Connect uptime monitor to dashboard
    monitoringDashboard.setUptimeMonitor(this.uptimeMonitor);
  }

  /**
   * Setup alert rules
   */
  private setupAlertRules(): void {
    // High memory usage alert
    alertManager.addAlertRule({
      id: 'high-memory-usage',
      name: 'High Memory Usage',
      condition: (data) => {
        const memoryUsage = data.system?.memory?.usage;
        return memoryUsage && memoryUsage > 85;
      },
      severity: 'high',
      type: 'performance',
      cooldown: 10,
      channels: this.config.alerts.channels,
      template: {
        title: 'High Memory Usage Alert',
        message: 'Memory usage has exceeded 85% ({{memoryUsage}}%)'
      },
      enabled: true
    });

    // High CPU usage alert
    alertManager.addAlertRule({
      id: 'high-cpu-usage',
      name: 'High CPU Usage',
      condition: (data) => {
        const cpuUsage = data.system?.cpu?.usage;
        return cpuUsage && cpuUsage > 80;
      },
      severity: 'high',
      type: 'performance',
      cooldown: 10,
      channels: this.config.alerts.channels,
      template: {
        title: 'High CPU Usage Alert',
        message: 'CPU usage has exceeded 80% ({{cpuUsage}}%)'
      },
      enabled: true
    });

    // Database connection alert
    alertManager.addAlertRule({
      id: 'database-connection-failed',
      name: 'Database Connection Failed',
      condition: (data) => {
        return data.component === 'database' && data.status === 'unhealthy';
      },
      severity: 'critical',
      type: 'health',
      cooldown: 5,
      channels: ['console', 'email', 'slack'],
      template: {
        title: 'Database Connection Failed',
        message: 'Unable to connect to the database: {{error}}'
      },
      enabled: true
    });

    // WebSocket connection spike alert
    alertManager.addAlertRule({
      id: 'websocket-connection-spike',
      name: 'WebSocket Connection Spike',
      condition: (data) => {
        const connections = data.websocketConnections;
        return connections && connections > 1000;
      },
      severity: 'medium',
      type: 'performance',
      cooldown: 15,
      channels: this.config.alerts.channels,
      template: {
        title: 'High WebSocket Connection Count',
        message: 'WebSocket connections have exceeded 1000 ({{websocketConnections}})'
      },
      enabled: true
    });
  }

  /**
   * Setup monitoring dashboard
   */
  private setupDashboard(): void {
    const app = monitoringDashboard.getApp();
    
    const server = app.listen(this.config.dashboard.port, () => {
      logger.info(`📊 Monitoring dashboard available at http://localhost:${this.config.dashboard.port}`);
    });

    // Handle graceful shutdown
    process.on('SIGTERM', () => {
      server.close(() => {
        logger.info('Monitoring dashboard server closed');
      });
    });
  }

  /**
   * Log system status
   */
  private logSystemStatus(): void {
    logger.info('📋 Monitoring System Status:', {
      metrics: this.config.metrics.enabled ? 'Active' : 'Disabled',
      healthChecks: this.config.healthChecks.enabled ? 'Active' : 'Disabled',
      alerts: this.config.alerts.enabled ? 'Active' : 'Disabled',
      uptime: this.config.uptime.enabled ? 'Active' : 'Disabled',
      dashboard: this.config.dashboard.enabled ? `Active (port ${this.config.dashboard.port})` : 'Disabled',
      errorTracking: this.config.errorTracking.enabled ? 'Active' : 'Disabled'
    });
  }

  /**
   * Get monitoring system status
   */
  getStatus(): {
    initialized: boolean;
    components: Record<string, boolean>;
    config: MonitoringConfig;
  } {
    return {
      initialized: this.initialized,
      components: {
        metrics: this.config.metrics.enabled,
        healthChecks: this.config.healthChecks.enabled,
        alerts: this.config.alerts.enabled,
        uptime: this.config.uptime.enabled,
        dashboard: this.config.dashboard.enabled,
        errorTracking: this.config.errorTracking.enabled
      },
      config: this.config
    };
  }

  /**
   * Shutdown monitoring system
   */
  async shutdown(): Promise<void> {
    logger.info('🛑 Shutting down monitoring system...');
    
    try {
      // Stop health monitoring
      healthMonitor.stop();
      
      // Stop uptime monitoring
      this.uptimeMonitor.stopAllChecks();
      
      logger.info('✅ Monitoring system shutdown completed');
    } catch (error) {
      logger.error('❌ Error during monitoring system shutdown', {
        error: error.message
      });
    }
  }

  /**
   * Get uptime monitor instance
   */
  getUptimeMonitor(): UptimeMonitor {
    return this.uptimeMonitor;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<MonitoringConfig>): void {
    this.config = { ...this.config, ...newConfig };
    logger.info('Monitoring configuration updated', { newConfig });
  }
}

// Export singleton monitoring system
export const monitoringSystem = new MonitoringSystem();

// Export all monitoring components
export {
  logger,
  metricsManager,
  healthMonitor,
  alertManager,
  monitoringDashboard
};

// Export types
export * from './logger';
export * from './metrics';
export * from './health-monitor';
export * from './alert-manager';
export * from './error-tracker';
export * from './uptime-monitor';
export * from './dashboard';

// Default export
export default monitoringSystem;