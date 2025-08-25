import express, { Request, Response } from 'express';
import logger from './logger';
import { metricsManager } from './metrics';
import { healthMonitor } from './health-monitor';
import { alertManager } from './alert-manager';
import { getErrorTracker } from './error-tracker';
import { performance } from 'perf_hooks';

export interface DashboardData {
  overview: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    uptime: number;
    version: string;
    environment: string;
    timestamp: Date;
  };
  metrics: {
    requests: {
      total: number;
      rps: number;
      errorRate: number;
      avgResponseTime: number;
      p95ResponseTime: number;
    };
    connections: {
      active: number;
      websockets: number;
      database: number;
      redis: number;
    };
    resources: {
      cpuUsage: number;
      memoryUsage: number;
      diskUsage: number;
      networkIO: {
        bytesIn: number;
        bytesOut: number;
      };
    };
    business: {
      activeUsers: number;
      activeSessions: number;
      messagesSent: number;
      transactionsProcessed: number;
    };
  };
  health: {
    overall: string;
    components: Array<{
      name: string;
      status: string;
      responseTime: number;
      lastCheck: Date;
    }>;
  };
  alerts: {
    active: number;
    critical: number;
    high: number;
    recentAlerts: Array<{
      id: string;
      title: string;
      severity: string;
      timestamp: Date;
    }>;
  };
  errors: {
    total: number;
    errorRate: number;
    topErrors: Array<{
      message: string;
      count: number;
      severity: string;
    }>;
  };
}

export class MonitoringDashboard {
  private app: express.Application;
  private uptimeMonitor?: any; // Will be injected

  constructor() {
    this.app = express();
    this.setupRoutes();
  }

  /**
   * Set uptime monitor reference
   */
  setUptimeMonitor(uptimeMonitor: any): void {
    this.uptimeMonitor = uptimeMonitor;
  }

  /**
   * Get Express app
   */
  getApp(): express.Application {
    return this.app;
  }

  /**
   * Setup dashboard routes
   */
  private setupRoutes(): void {
    // Middleware
    this.app.use(express.json());
    this.app.use(express.static('public')); // For dashboard UI files

    // CORS for dashboard access
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
      next();
    });

    // Dashboard data endpoint
    this.app.get('/api/dashboard', this.getDashboardData.bind(this));

    // Metrics endpoint (Prometheus format)
    this.app.get('/api/metrics', this.getMetrics.bind(this));

    // Metrics endpoint (JSON format)
    this.app.get('/api/metrics/json', this.getMetricsJSON.bind(this));

    // Health status endpoint
    this.app.get('/api/health', this.getHealthStatus.bind(this));

    // Health status for specific component
    this.app.get('/api/health/:component', this.getComponentHealth.bind(this));

    // Alerts endpoints
    this.app.get('/api/alerts', this.getAlerts.bind(this));
    this.app.get('/api/alerts/stats', this.getAlertStats.bind(this));
    this.app.post('/api/alerts/:alertId/resolve', this.resolveAlert.bind(this));

    // Errors endpoints
    this.app.get('/api/errors', this.getErrors.bind(this));
    this.app.get('/api/errors/stats', this.getErrorStats.bind(this));
    this.app.get('/api/errors/:errorId', this.getErrorDetails.bind(this));

    // Uptime monitoring endpoints
    this.app.get('/api/uptime', this.getUptimeStats.bind(this));
    this.app.get('/api/uptime/:checkId', this.getUptimeCheckDetails.bind(this));
    this.app.post('/api/uptime/:checkId/check', this.performUptimeCheck.bind(this));

    // System information
    this.app.get('/api/system', this.getSystemInfo.bind(this));

    // Performance data
    this.app.get('/api/performance', this.getPerformanceData.bind(this));

    // WebRTC stats
    this.app.get('/api/webrtc/stats', this.getWebRTCStats.bind(this));

    // Real-time data (could be enhanced with WebSocket)
    this.app.get('/api/realtime', this.getRealtimeData.bind(this));

    // Export data
    this.app.get('/api/export/:type', this.exportData.bind(this));

    // Main dashboard HTML (if serving UI)
    this.app.get('/', (req, res) => {
      res.send(this.generateDashboardHTML());
    });
  }

  /**
   * Get dashboard data
   */
  private async getDashboardData(req: Request, res: Response): Promise<void> {
    try {
      const startTime = performance.now();
      
      // Get current health status
      const healthStatus = healthMonitor.getCurrentHealth();
      
      // Get metrics data
      const metricsData = await metricsManager.getMetricsJSON();
      
      // Get alerts
      const recentAlerts = alertManager.getRecentAlerts(10);
      const alertStats = alertManager.getAlertStats();
      
      // Get errors
      const errorTracker = getErrorTracker();
      const errorStats = errorTracker ? errorTracker.getErrorStats() : {
        total: 0,
        errorRate: 0,
        topErrors: []
      };

      // Compile dashboard data
      const dashboardData: DashboardData = {
        overview: {
          status: healthStatus.overall,
          uptime: healthStatus.uptime,
          version: healthStatus.version,
          environment: healthStatus.environment,
          timestamp: new Date()
        },
        metrics: {
          requests: {
            total: this.extractMetricValue(metricsData, 'http_requests_total') || 0,
            rps: this.calculateRPS(metricsData),
            errorRate: this.calculateErrorRate(metricsData),
            avgResponseTime: this.extractMetricValue(metricsData, 'http_request_duration_seconds') || 0,
            p95ResponseTime: this.extractPercentile(metricsData, 'http_request_duration_seconds', 0.95)
          },
          connections: {
            active: this.extractMetricValue(metricsData, 'websocket_connections_active') || 0,
            websockets: this.extractMetricValue(metricsData, 'websocket_connections_active') || 0,
            database: this.extractMetricValue(metricsData, 'database_connections_active') || 0,
            redis: this.extractMetricValue(metricsData, 'redis_connections_active') || 0
          },
          resources: {
            cpuUsage: this.extractMetricValue(metricsData, 'cpu_usage_percent') || 0,
            memoryUsage: this.calculateMemoryUsage(metricsData),
            diskUsage: 0, // Would need disk monitoring implementation
            networkIO: {
              bytesIn: 0, // Would need network monitoring
              bytesOut: 0
            }
          },
          business: {
            activeUsers: this.extractMetricValue(metricsData, 'users_active') || 0,
            activeSessions: this.extractMetricValue(metricsData, 'webrtc_sessions_active') || 0,
            messagesSent: this.extractMetricValue(metricsData, 'chat_messages_total') || 0,
            transactionsProcessed: this.extractMetricValue(metricsData, 'web3_transactions_total') || 0
          }
        },
        health: {
          overall: healthStatus.overall,
          components: healthStatus.components.map(component => ({
            name: component.component,
            status: component.status,
            responseTime: component.responseTime,
            lastCheck: component.timestamp
          }))
        },
        alerts: {
          active: recentAlerts.filter(alert => !alert.resolved).length,
          critical: recentAlerts.filter(alert => !alert.resolved && alert.severity === 'critical').length,
          high: recentAlerts.filter(alert => !alert.resolved && alert.severity === 'high').length,
          recentAlerts: recentAlerts.slice(0, 5).map(alert => ({
            id: alert.id,
            title: alert.title,
            severity: alert.severity,
            timestamp: alert.timestamp
          }))
        },
        errors: {
          total: errorStats.total,
          errorRate: errorStats.errorRate,
          topErrors: errorStats.topErrors.map(error => ({
            message: error.fingerprint.message,
            count: error.count,
            severity: error.severity
          }))
        }
      };

      const responseTime = performance.now() - startTime;
      logger.debug('Dashboard data compiled', { 
        responseTime: `${responseTime.toFixed(2)}ms`,
        status: dashboardData.overview.status
      });

      res.json(dashboardData);
    } catch (error) {
      logger.error('Failed to compile dashboard data', { error: error.message });
      res.status(500).json({ 
        error: 'Failed to compile dashboard data',
        message: error.message 
      });
    }
  }

  /**
   * Get Prometheus metrics
   */
  private async getMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await metricsManager.getPrometheusMetrics();
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics);
    } catch (error) {
      logger.error('Failed to get metrics', { error: error.message });
      res.status(500).send('Failed to get metrics');
    }
  }

  /**
   * Get metrics in JSON format
   */
  private async getMetricsJSON(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await metricsManager.getMetricsJSON();
      res.json(metrics);
    } catch (error) {
      logger.error('Failed to get metrics JSON', { error: error.message });
      res.status(500).json({ error: 'Failed to get metrics' });
    }
  }

  /**
   * Get health status
   */
  private async getHealthStatus(req: Request, res: Response): Promise<void> {
    try {
      const healthStatus = healthMonitor.getCurrentHealth();
      res.json(healthStatus);
    } catch (error) {
      logger.error('Failed to get health status', { error: error.message });
      res.status(500).json({ error: 'Failed to get health status' });
    }
  }

  /**
   * Get component health
   */
  private getComponentHealth(req: Request, res: Response): void {
    try {
      const { component } = req.params;
      const health = healthMonitor.getComponentHealth(component);
      
      if (!health) {
        res.status(404).json({ error: 'Component not found' });
        return;
      }
      
      res.json(health);
    } catch (error) {
      logger.error('Failed to get component health', { error: error.message });
      res.status(500).json({ error: 'Failed to get component health' });
    }
  }

  /**
   * Get alerts
   */
  private getAlerts(req: Request, res: Response): void {
    try {
      const { limit = 50, severity, type, resolved } = req.query;
      let alerts = alertManager.getRecentAlerts(parseInt(limit as string));
      
      // Apply filters
      if (severity) {
        alerts = alerts.filter(alert => alert.severity === severity);
      }
      if (type) {
        alerts = alerts.filter(alert => alert.type === type);
      }
      if (resolved !== undefined) {
        const isResolved = resolved === 'true';
        alerts = alerts.filter(alert => Boolean(alert.resolved) === isResolved);
      }
      
      res.json(alerts);
    } catch (error) {
      logger.error('Failed to get alerts', { error: error.message });
      res.status(500).json({ error: 'Failed to get alerts' });
    }
  }

  /**
   * Get alert statistics
   */
  private getAlertStats(req: Request, res: Response): void {
    try {
      const stats = alertManager.getAlertStats();
      res.json(stats);
    } catch (error) {
      logger.error('Failed to get alert stats', { error: error.message });
      res.status(500).json({ error: 'Failed to get alert stats' });
    }
  }

  /**
   * Resolve alert
   */
  private resolveAlert(req: Request, res: Response): void {
    try {
      const { alertId } = req.params;
      const { resolvedBy } = req.body;
      
      const resolved = alertManager.resolveAlert(alertId, resolvedBy);
      
      if (resolved) {
        res.json({ success: true, message: 'Alert resolved' });
      } else {
        res.status(404).json({ error: 'Alert not found' });
      }
    } catch (error) {
      logger.error('Failed to resolve alert', { error: error.message });
      res.status(500).json({ error: 'Failed to resolve alert' });
    }
  }

  /**
   * Get errors
   */
  private getErrors(req: Request, res: Response): void {
    try {
      const errorTracker = getErrorTracker();
      if (!errorTracker) {
        res.status(503).json({ error: 'Error tracker not available' });
        return;
      }
      
      const { limit = 50 } = req.query;
      const errors = Array.from(errorTracker['errors'].values())
        .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
        .slice(0, parseInt(limit as string));
      
      res.json(errors);
    } catch (error) {
      logger.error('Failed to get errors', { error: error.message });
      res.status(500).json({ error: 'Failed to get errors' });
    }
  }

  /**
   * Get error statistics
   */
  private getErrorStats(req: Request, res: Response): void {
    try {
      const errorTracker = getErrorTracker();
      if (!errorTracker) {
        res.status(503).json({ error: 'Error tracker not available' });
        return;
      }
      
      const stats = errorTracker.getErrorStats();
      res.json(stats);
    } catch (error) {
      logger.error('Failed to get error stats', { error: error.message });
      res.status(500).json({ error: 'Failed to get error stats' });
    }
  }

  /**
   * Get error details
   */
  private getErrorDetails(req: Request, res: Response): void {
    try {
      const { errorId } = req.params;
      const errorTracker = getErrorTracker();
      
      if (!errorTracker) {
        res.status(503).json({ error: 'Error tracker not available' });
        return;
      }
      
      const error = errorTracker.getError(errorId);
      
      if (!error) {
        res.status(404).json({ error: 'Error not found' });
        return;
      }
      
      res.json(error);
    } catch (error) {
      logger.error('Failed to get error details', { error: error.message });
      res.status(500).json({ error: 'Failed to get error details' });
    }
  }

  /**
   * Get uptime statistics
   */
  private getUptimeStats(req: Request, res: Response): void {
    try {
      if (!this.uptimeMonitor) {
        res.status(503).json({ error: 'Uptime monitor not available' });
        return;
      }
      
      const stats = this.uptimeMonitor.getAllUptimeStats();
      const summary = this.uptimeMonitor.getChecksSummary();
      
      res.json({ stats, summary });
    } catch (error) {
      logger.error('Failed to get uptime stats', { error: error.message });
      res.status(500).json({ error: 'Failed to get uptime stats' });
    }
  }

  /**
   * Get uptime check details
   */
  private getUptimeCheckDetails(req: Request, res: Response): void {
    try {
      if (!this.uptimeMonitor) {
        res.status(503).json({ error: 'Uptime monitor not available' });
        return;
      }
      
      const { checkId } = req.params;
      const stats = this.uptimeMonitor.getUptimeStats(checkId);
      const results = this.uptimeMonitor.getRecentResults(checkId, 100);
      
      if (!stats) {
        res.status(404).json({ error: 'Uptime check not found' });
        return;
      }
      
      res.json({ stats, results });
    } catch (error) {
      logger.error('Failed to get uptime check details', { error: error.message });
      res.status(500).json({ error: 'Failed to get uptime check details' });
    }
  }

  /**
   * Perform uptime check on demand
   */
  private async performUptimeCheck(req: Request, res: Response): Promise<void> {
    try {
      if (!this.uptimeMonitor) {
        res.status(503).json({ error: 'Uptime monitor not available' });
        return;
      }
      
      const { checkId } = req.params;
      const result = await this.uptimeMonitor.performCheckNow(checkId);
      
      res.json(result);
    } catch (error) {
      logger.error('Failed to perform uptime check', { error: error.message });
      res.status(500).json({ error: 'Failed to perform uptime check' });
    }
  }

  /**
   * Get system information
   */
  private getSystemInfo(req: Request, res: Response): void {
    try {
      const os = require('os');
      
      const systemInfo = {
        hostname: os.hostname(),
        platform: os.platform(),
        architecture: os.arch(),
        cpus: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        loadAverage: os.loadavg(),
        uptime: os.uptime(),
        nodeVersion: process.version,
        processUptime: process.uptime(),
        processMemory: process.memoryUsage(),
        processCPU: process.cpuUsage()
      };
      
      res.json(systemInfo);
    } catch (error) {
      logger.error('Failed to get system info', { error: error.message });
      res.status(500).json({ error: 'Failed to get system info' });
    }
  }

  /**
   * Get performance data
   */
  private async getPerformanceData(req: Request, res: Response): Promise<void> {
    try {
      // This would integrate with the existing performance monitor
      const performanceData = {
        timestamp: new Date(),
        eventLoopLag: 0, // Would need measurement
        gcStats: {}, // Would need GC monitoring
        processStats: process.memoryUsage(),
        systemStats: {
          loadAverage: require('os').loadavg(),
          freeMemory: require('os').freemem(),
          totalMemory: require('os').totalmem()
        }
      };
      
      res.json(performanceData);
    } catch (error) {
      logger.error('Failed to get performance data', { error: error.message });
      res.status(500).json({ error: 'Failed to get performance data' });
    }
  }

  /**
   * Get WebRTC statistics
   */
  private getWebRTCStats(req: Request, res: Response): void {
    try {
      // This would integrate with the WebRTC service
      const webrtcStats = {
        activeSessions: 0,
        totalSessions: 0,
        averageSessionDuration: 0,
        peakConcurrentSessions: 0,
        matchmakingQueue: 0,
        successRate: 100
      };
      
      res.json(webrtcStats);
    } catch (error) {
      logger.error('Failed to get WebRTC stats', { error: error.message });
      res.status(500).json({ error: 'Failed to get WebRTC stats' });
    }
  }

  /**
   * Get real-time data
   */
  private async getRealtimeData(req: Request, res: Response): Promise<void> {
    try {
      const realtimeData = {
        timestamp: new Date(),
        activeConnections: this.extractMetricValue(await metricsManager.getMetricsJSON(), 'websocket_connections_active') || 0,
        requestsPerMinute: 0, // Would need time-based calculation
        errorsPerMinute: 0,
        responseTime: {
          current: 0,
          p95: 0
        }
      };
      
      res.json(realtimeData);
    } catch (error) {
      logger.error('Failed to get real-time data', { error: error.message });
      res.status(500).json({ error: 'Failed to get real-time data' });
    }
  }

  /**
   * Export data
   */
  private async exportData(req: Request, res: Response): Promise<void> {
    try {
      const { type } = req.params;
      const { format = 'json', timeRange } = req.query;
      
      let data: any;
      
      switch (type) {
        case 'metrics':
          data = await metricsManager.getMetricsJSON();
          break;
        case 'alerts':
          data = alertManager.getRecentAlerts(1000);
          break;
        case 'errors':
          const errorTracker = getErrorTracker();
          data = errorTracker ? errorTracker.exportErrors(format as 'json' | 'csv') : null;
          break;
        case 'uptime':
          data = this.uptimeMonitor ? this.uptimeMonitor.exportUptimeData(format as 'json' | 'csv') : null;
          break;
        default:
          res.status(400).json({ error: 'Invalid export type' });
          return;
      }
      
      if (format === 'json') {
        res.json(data);
      } else {
        res.set('Content-Type', 'text/csv');
        res.set('Content-Disposition', `attachment; filename="${type}_${Date.now()}.csv"`);
        res.send(data);
      }
    } catch (error) {
      logger.error('Failed to export data', { error: error.message, type: req.params.type });
      res.status(500).json({ error: 'Failed to export data' });
    }
  }

  /**
   * Extract metric value from metrics data
   */
  private extractMetricValue(metricsData: any, metricName: string): number | null {
    try {
      const metric = metricsData.metrics[metricName];
      if (!metric || !metric.values || metric.values.length === 0) {
        return null;
      }
      
      // Get the latest value
      const latestValue = metric.values[metric.values.length - 1];
      return latestValue ? latestValue.value : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Calculate requests per second
   */
  private calculateRPS(metricsData: any): number {
    // This would need time-based calculation from metrics history
    return 0;
  }

  /**
   * Calculate error rate
   */
  private calculateErrorRate(metricsData: any): number {
    // This would calculate error rate from request metrics
    return 0;
  }

  /**
   * Extract percentile from histogram metric
   */
  private extractPercentile(metricsData: any, metricName: string, percentile: number): number {
    // This would extract percentile data from histogram metrics
    return 0;
  }

  /**
   * Calculate memory usage percentage
   */
  private calculateMemoryUsage(metricsData: any): number {
    try {
      const heapUsed = this.extractMetricValue(metricsData, 'memory_usage_bytes{type="heap_used"}');
      const heapTotal = this.extractMetricValue(metricsData, 'memory_usage_bytes{type="heap_total"}');
      
      if (heapUsed && heapTotal) {
        return (heapUsed / heapTotal) * 100;
      }
      
      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Generate basic dashboard HTML
   */
  private generateDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html>
<head>
    <title>Web3 Chat Roulette - Monitoring Dashboard</title>
    <style>
        body { 
            font-family: Arial, sans-serif; 
            margin: 20px; 
            background: #f5f5f5; 
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            background: white; 
            padding: 20px; 
            border-radius: 8px; 
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .status { 
            padding: 10px; 
            margin: 10px 0; 
            border-radius: 4px; 
        }
        .healthy { background: #d4edda; color: #155724; }
        .degraded { background: #fff3cd; color: #856404; }
        .unhealthy { background: #f8d7da; color: #721c24; }
        .metric { 
            display: inline-block; 
            margin: 10px; 
            padding: 15px; 
            background: #f8f9fa; 
            border-radius: 4px; 
            min-width: 200px;
        }
        .metric-value { font-size: 24px; font-weight: bold; color: #007bff; }
        .metric-label { font-size: 14px; color: #6c757d; }
        .api-link { margin: 5px 10px; }
        .api-link a { color: #007bff; text-decoration: none; }
        .api-link a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 Web3 Chat Roulette - Monitoring Dashboard</h1>
        
        <div id="status" class="status healthy">
            <strong>System Status:</strong> Loading...
        </div>
        
        <h2>📊 Quick Metrics</h2>
        <div id="metrics">
            <div class="metric">
                <div class="metric-value" id="uptime">--</div>
                <div class="metric-label">Uptime (hours)</div>
            </div>
            <div class="metric">
                <div class="metric-value" id="connections">--</div>
                <div class="metric-label">Active Connections</div>
            </div>
            <div class="metric">
                <div class="metric-value" id="requests">--</div>
                <div class="metric-label">Total Requests</div>
            </div>
            <div class="metric">
                <div class="metric-value" id="errors">--</div>
                <div class="metric-label">Error Rate (%)</div>
            </div>
        </div>
        
        <h2>🔗 API Endpoints</h2>
        <div class="api-link"><a href="/api/dashboard">Dashboard Data (JSON)</a></div>
        <div class="api-link"><a href="/api/metrics">Prometheus Metrics</a></div>
        <div class="api-link"><a href="/api/health">Health Status</a></div>
        <div class="api-link"><a href="/api/alerts">Recent Alerts</a></div>
        <div class="api-link"><a href="/api/errors">Error Tracking</a></div>
        <div class="api-link"><a href="/api/uptime">Uptime Monitoring</a></div>
        <div class="api-link"><a href="/api/system">System Information</a></div>
        
        <h2>📈 Real-time Updates</h2>
        <p>Last updated: <span id="lastUpdate">--</span></p>
        <button onclick="refreshData()">🔄 Refresh Now</button>
        
        <script>
            async function refreshData() {
                try {
                    const response = await fetch('/api/dashboard');
                    const data = await response.json();
                    
                    // Update status
                    const statusEl = document.getElementById('status');
                    statusEl.className = 'status ' + data.overview.status;
                    statusEl.innerHTML = '<strong>System Status:</strong> ' + 
                        data.overview.status.toUpperCase() + 
                        ' (v' + data.overview.version + ')';
                    
                    // Update metrics
                    document.getElementById('uptime').textContent = 
                        Math.round(data.overview.uptime / 3600);
                    document.getElementById('connections').textContent = 
                        data.metrics.connections.active;
                    document.getElementById('requests').textContent = 
                        data.metrics.requests.total;
                    document.getElementById('errors').textContent = 
                        data.metrics.requests.errorRate.toFixed(1);
                    
                    document.getElementById('lastUpdate').textContent = 
                        new Date().toLocaleTimeString();
                        
                } catch (error) {
                    console.error('Failed to refresh data:', error);
                    document.getElementById('status').innerHTML = 
                        '<strong>Status:</strong> Error loading data';
                }
            }
            
            // Refresh on load
            refreshData();
            
            // Auto-refresh every 30 seconds
            setInterval(refreshData, 30000);
        </script>
    </div>
</body>
</html>
    `;
  }
}

export const monitoringDashboard = new MonitoringDashboard();