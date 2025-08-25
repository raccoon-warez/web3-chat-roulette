import { EventEmitter } from 'events';
import { performance } from 'perf_hooks';
import os from 'os';

interface PerformanceMetric {
  timestamp: Date;
  name: string;
  value: number;
  unit: string;
  tags?: Record<string, string>;
}

interface MetricSeries {
  name: string;
  data: Array<{ timestamp: Date; value: number }>;
  aggregation: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p95: number;
    p99: number;
    count: number;
  };
}

interface SystemMetrics {
  cpu: {
    usage: number;
    load: number[];
    cores: number;
  };
  memory: {
    used: number;
    free: number;
    total: number;
    usage: number;
    heapUsed: number;
    heapTotal: number;
  };
  network: {
    bytesIn: number;
    bytesOut: number;
    packetsIn: number;
    packetsOut: number;
  };
  disk: {
    reads: number;
    writes: number;
    usage: number;
  };
}

interface ApplicationMetrics {
  requests: {
    total: number;
    success: number;
    errors: number;
    rate: number; // requests per second
  };
  responses: {
    averageTime: number;
    p50: number;
    p95: number;
    p99: number;
  };
  connections: {
    active: number;
    websockets: number;
    database: number;
    redis: number;
  };
  errors: {
    rate: number;
    by4xx: number;
    by5xx: number;
    byType: Record<string, number>;
  };
}

interface MetricsConfig {
  enabled: boolean;
  collectInterval: number;
  retentionPeriod: number; // milliseconds
  aggregationWindow: number; // milliseconds
  exporters: Array<'console' | 'prometheus' | 'influxdb' | 'cloudwatch'>;
}

export class MetricsCollector extends EventEmitter {
  private config: MetricsConfig;
  private metrics: Map<string, PerformanceMetric[]> = new Map();
  private collectInterval?: NodeJS.Timeout;
  private cleanupInterval?: NodeJS.Timeout;
  private lastNetworkStats = { bytesIn: 0, bytesOut: 0 };
  private lastCpuUsage = process.cpuUsage();
  private requestTimings: number[] = [];
  private errorCounts: Record<string, number> = {};
  private connectionCounts = {
    active: 0,
    websockets: 0,
    database: 0,
    redis: 0
  };

  constructor(config: Partial<MetricsConfig> = {}) {
    super();

    this.config = {
      enabled: true,
      collectInterval: 15000, // 15 seconds
      retentionPeriod: 24 * 60 * 60 * 1000, // 24 hours
      aggregationWindow: 60000, // 1 minute
      exporters: ['console'],
      ...config
    };
  }

  /**
   * Start metrics collection
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('📊 Metrics collection is disabled');
      return;
    }

    console.log(`📊 Starting metrics collection (interval: ${this.config.collectInterval}ms)`);

    this.collectInterval = setInterval(() => {
      this.collectSystemMetrics();
      this.collectApplicationMetrics();
    }, this.config.collectInterval);

    // Cleanup old metrics periodically
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldMetrics();
    }, this.config.retentionPeriod / 24); // Run 24 times during retention period

    // Initial collection
    setImmediate(() => {
      this.collectSystemMetrics();
      this.collectApplicationMetrics();
    });
  }

  /**
   * Stop metrics collection
   */
  stop(): void {
    console.log('🛑 Stopping metrics collection');

    if (this.collectInterval) {
      clearInterval(this.collectInterval);
    }

    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }

  /**
   * Collect system-level metrics
   */
  private collectSystemMetrics(): void {
    const timestamp = new Date();

    try {
      // CPU metrics
      const cpuUsage = process.cpuUsage(this.lastCpuUsage);
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to percentage
      this.lastCpuUsage = process.cpuUsage();

      this.recordMetric('system.cpu.usage', cpuPercent, 'percent', { type: 'system' });
      
      const loadAvg = os.loadavg();
      loadAvg.forEach((load, index) => {
        this.recordMetric(`system.cpu.load.${index === 0 ? '1min' : index === 1 ? '5min' : '15min'}`, load, 'load');
      });

      // Memory metrics
      const memUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;

      this.recordMetric('system.memory.used', usedMem, 'bytes');
      this.recordMetric('system.memory.free', freeMem, 'bytes');
      this.recordMetric('system.memory.total', totalMem, 'bytes');
      this.recordMetric('system.memory.usage', (usedMem / totalMem) * 100, 'percent');
      this.recordMetric('system.memory.heap_used', memUsage.heapUsed, 'bytes');
      this.recordMetric('system.memory.heap_total', memUsage.heapTotal, 'bytes');

      // Process metrics
      this.recordMetric('system.process.uptime', process.uptime(), 'seconds');
      this.recordMetric('system.process.pid', process.pid, 'count');

      // Event loop lag
      const start = performance.now();
      setImmediate(() => {
        const lag = performance.now() - start;
        this.recordMetric('system.eventloop.lag', lag, 'milliseconds');
      });

    } catch (error) {
      console.error('Error collecting system metrics:', error);
    }
  }

  /**
   * Collect application-level metrics
   */
  private collectApplicationMetrics(): void {
    try {
      // Response time metrics
      if (this.requestTimings.length > 0) {
        const sorted = [...this.requestTimings].sort((a, b) => a - b);
        const count = sorted.length;

        this.recordMetric('app.response.count', count, 'count');
        this.recordMetric('app.response.avg', sorted.reduce((a, b) => a + b, 0) / count, 'milliseconds');
        this.recordMetric('app.response.p50', this.percentile(sorted, 0.5), 'milliseconds');
        this.recordMetric('app.response.p95', this.percentile(sorted, 0.95), 'milliseconds');
        this.recordMetric('app.response.p99', this.percentile(sorted, 0.99), 'milliseconds');
        this.recordMetric('app.response.min', sorted[0], 'milliseconds');
        this.recordMetric('app.response.max', sorted[count - 1], 'milliseconds');

        // Reset for next interval
        this.requestTimings = [];
      }

      // Error metrics
      const totalErrors = Object.values(this.errorCounts).reduce((a, b) => a + b, 0);
      this.recordMetric('app.errors.total', totalErrors, 'count');

      Object.entries(this.errorCounts).forEach(([type, count]) => {
        this.recordMetric('app.errors.by_type', count, 'count', { type });
      });

      // Reset error counts
      this.errorCounts = {};

      // Connection metrics
      this.recordMetric('app.connections.active', this.connectionCounts.active, 'count');
      this.recordMetric('app.connections.websockets', this.connectionCounts.websockets, 'count');
      this.recordMetric('app.connections.database', this.connectionCounts.database, 'count');
      this.recordMetric('app.connections.redis', this.connectionCounts.redis, 'count');

    } catch (error) {
      console.error('Error collecting application metrics:', error);
    }
  }

  /**
   * Record a metric value
   */
  recordMetric(name: string, value: number, unit: string, tags: Record<string, string> = {}): void {
    const metric: PerformanceMetric = {
      timestamp: new Date(),
      name,
      value,
      unit,
      tags
    };

    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    this.metrics.get(name)!.push(metric);

    this.emit('metricRecorded', metric);
  }

  /**
   * Record request timing
   */
  recordRequest(startTime: number, endTime?: number): void {
    const timing = (endTime || performance.now()) - startTime;
    this.requestTimings.push(timing);
  }

  /**
   * Record error
   */
  recordError(type: string): void {
    this.errorCounts[type] = (this.errorCounts[type] || 0) + 1;
  }

  /**
   * Update connection counts
   */
  updateConnections(counts: Partial<typeof this.connectionCounts>): void {
    this.connectionCounts = { ...this.connectionCounts, ...counts };
  }

  /**
   * Get metric series with aggregation
   */
  getMetricSeries(name: string, timeRange?: { start: Date; end: Date }): MetricSeries | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    let filteredMetrics = metrics;
    if (timeRange) {
      filteredMetrics = metrics.filter(m => 
        m.timestamp >= timeRange.start && m.timestamp <= timeRange.end
      );
    }

    if (filteredMetrics.length === 0) {
      return null;
    }

    const values = filteredMetrics.map(m => m.value).sort((a, b) => a - b);
    const data = filteredMetrics.map(m => ({ timestamp: m.timestamp, value: m.value }));

    return {
      name,
      data,
      aggregation: {
        min: values[0],
        max: values[values.length - 1],
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        p50: this.percentile(values, 0.5),
        p95: this.percentile(values, 0.95),
        p99: this.percentile(values, 0.99),
        count: values.length
      }
    };
  }

  /**
   * Get current system metrics snapshot
   */
  getCurrentSystemMetrics(): SystemMetrics {
    const memUsage = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    return {
      cpu: {
        usage: this.getLatestMetricValue('system.cpu.usage') || 0,
        load: os.loadavg(),
        cores: os.cpus().length
      },
      memory: {
        used: totalMem - freeMem,
        free: freeMem,
        total: totalMem,
        usage: ((totalMem - freeMem) / totalMem) * 100,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal
      },
      network: {
        bytesIn: 0, // Would be implemented with actual network monitoring
        bytesOut: 0,
        packetsIn: 0,
        packetsOut: 0
      },
      disk: {
        reads: 0, // Would be implemented with actual disk monitoring
        writes: 0,
        usage: 0
      }
    };
  }

  /**
   * Get current application metrics snapshot
   */
  getCurrentApplicationMetrics(): ApplicationMetrics {
    const responseSeries = this.getMetricSeries('app.response.avg');
    const errorSeries = this.getMetricSeries('app.errors.total');

    return {
      requests: {
        total: this.getLatestMetricValue('app.response.count') || 0,
        success: 0, // Would need separate tracking
        errors: this.getLatestMetricValue('app.errors.total') || 0,
        rate: 0 // Would calculate from time-based data
      },
      responses: {
        averageTime: this.getLatestMetricValue('app.response.avg') || 0,
        p50: this.getLatestMetricValue('app.response.p50') || 0,
        p95: this.getLatestMetricValue('app.response.p95') || 0,
        p99: this.getLatestMetricValue('app.response.p99') || 0
      },
      connections: {
        active: this.connectionCounts.active,
        websockets: this.connectionCounts.websockets,
        database: this.connectionCounts.database,
        redis: this.connectionCounts.redis
      },
      errors: {
        rate: 0, // Would calculate from error/request ratio
        by4xx: 0,
        by5xx: 0,
        byType: { ...this.errorCounts }
      }
    };
  }

  /**
   * Get latest metric value
   */
  private getLatestMetricValue(name: string): number | null {
    const metrics = this.metrics.get(name);
    if (!metrics || metrics.length === 0) {
      return null;
    }

    return metrics[metrics.length - 1].value;
  }

  /**
   * Calculate percentile
   */
  private percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    if (values.length === 1) return values[0];

    const index = (values.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    return values[lower] * (1 - weight) + values[upper] * weight;
  }

  /**
   * Clean up old metrics
   */
  private cleanupOldMetrics(): void {
    const cutoff = new Date(Date.now() - this.config.retentionPeriod);

    for (const [name, metrics] of this.metrics.entries()) {
      const filtered = metrics.filter(m => m.timestamp > cutoff);
      this.metrics.set(name, filtered);
    }

    console.log(`🧹 Cleaned up old metrics (retention: ${this.config.retentionPeriod}ms)`);
  }

  /**
   * Get all available metrics
   */
  getAllMetrics(): string[] {
    return Array.from(this.metrics.keys());
  }

  /**
   * Export metrics in Prometheus format
   */
  exportPrometheus(): string {
    const lines: string[] = [];

    for (const [name, metrics] of this.metrics.entries()) {
      if (metrics.length === 0) continue;

      const latest = metrics[metrics.length - 1];
      const prometheusName = name.replace(/\./g, '_');
      
      // Add metric help
      lines.push(`# HELP ${prometheusName} ${name} metric`);
      lines.push(`# TYPE ${prometheusName} gauge`);
      
      // Add metric value with tags
      if (latest.tags && Object.keys(latest.tags).length > 0) {
        const tags = Object.entries(latest.tags)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        lines.push(`${prometheusName}{${tags}} ${latest.value}`);
      } else {
        lines.push(`${prometheusName} ${latest.value}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Export metrics in JSON format
   */
  exportJSON(includeHistory: boolean = false): any {
    const result: any = {
      timestamp: new Date(),
      system: this.getCurrentSystemMetrics(),
      application: this.getCurrentApplicationMetrics()
    };

    if (includeHistory) {
      result.history = {};
      for (const [name, metrics] of this.metrics.entries()) {
        result.history[name] = metrics.slice(-100); // Last 100 points
      }
    }

    return result;
  }

  /**
   * Get metrics dashboard data
   */
  getDashboardData(): {
    system: SystemMetrics;
    application: ApplicationMetrics;
    charts: Array<{
      name: string;
      series: MetricSeries;
      type: 'line' | 'area' | 'bar';
    }>;
  } {
    const charts = [
      {
        name: 'CPU Usage',
        series: this.getMetricSeries('system.cpu.usage'),
        type: 'line' as const
      },
      {
        name: 'Memory Usage',
        series: this.getMetricSeries('system.memory.usage'),
        type: 'area' as const
      },
      {
        name: 'Response Time',
        series: this.getMetricSeries('app.response.avg'),
        type: 'line' as const
      },
      {
        name: 'Active Connections',
        series: this.getMetricSeries('app.connections.active'),
        type: 'line' as const
      }
    ].filter(chart => chart.series !== null) as Array<{
      name: string;
      series: MetricSeries;
      type: 'line' | 'area' | 'bar';
    }>;

    return {
      system: this.getCurrentSystemMetrics(),
      application: this.getCurrentApplicationMetrics(),
      charts
    };
  }

  /**
   * Set custom aggregation window
   */
  setAggregationWindow(windowMs: number): void {
    this.config.aggregationWindow = windowMs;
  }

  /**
   * Enable/disable metrics collection
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (enabled && !this.collectInterval) {
      this.start();
    } else if (!enabled && this.collectInterval) {
      this.stop();
    }
  }

  /**
   * Get metrics statistics
   */
  getStats(): {
    enabled: boolean;
    totalMetrics: number;
    totalDataPoints: number;
    memoryUsage: number;
    retentionPeriod: number;
  } {
    let totalDataPoints = 0;
    for (const metrics of this.metrics.values()) {
      totalDataPoints += metrics.length;
    }

    return {
      enabled: this.config.enabled,
      totalMetrics: this.metrics.size,
      totalDataPoints,
      memoryUsage: process.memoryUsage().heapUsed,
      retentionPeriod: this.config.retentionPeriod
    };
  }
}