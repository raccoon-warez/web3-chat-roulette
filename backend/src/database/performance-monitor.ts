import crypto from 'crypto';
import { redisClient } from '../utils/redis';

interface QueryMetrics {
  queryId: string;
  query: string;
  params?: any[];
  duration: number;
  rows?: number;
  success: boolean;
  error?: string;
  timestamp?: number;
}

interface PerformanceMetrics {
  totalQueries: number;
  averageQueryTime: number;
  slowQueries: number;
  errorRate: number;
  cacheHitRate: number;
  connectionCount: number;
  activeConnections: number;
}

export class QueryPerformanceMonitor {
  private metrics: Map<string, QueryMetrics[]> = new Map();
  private connectionCount = 0;
  private activeConnections = 0;
  private cacheHits = 0;
  private cacheMisses = 0;

  async initialize(): Promise<void> {
    console.log('Initializing query performance monitor');
    
    // Start metrics cleanup interval
    setInterval(() => this.cleanupOldMetrics(), 600000); // Every 10 minutes
    
    // Start metrics reporting interval
    setInterval(async () => await this.reportMetrics(), 60000); // Every minute
  }

  generateQueryId(): string {
    return crypto.randomUUID();
  }

  recordQuery(queryId: string, metrics: QueryMetrics): void {
    const queryHash = this.hashQuery(metrics.query);
    
    if (!this.metrics.has(queryHash)) {
      this.metrics.set(queryHash, []);
    }
    
    this.metrics.get(queryHash)!.push({
      ...metrics,
      queryId,
      timestamp: Date.now()
    });

    // Store slow queries for analysis
    if (metrics.duration > 50) {
      this.storeSlowQuery(queryId, metrics);
    }

    // Update database query stats
    this.updateQueryStats(queryHash, metrics);
  }

  recordCacheHit(queryId: string, duration: number): void {
    this.cacheHits++;
    console.log(`Cache hit for query ${queryId} (${duration}ms)`);
  }

  recordCacheMiss(): void {
    this.cacheMisses++;
  }

  recordConnection(): void {
    this.connectionCount++;
    this.activeConnections++;
  }

  recordDisconnection(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  recordError(error: Error): void {
    console.error('Database error recorded:', error.message);
    // Store error for analysis
    this.storeError(error);
  }

  recordTransaction(duration: number, success: boolean): void {
    console.log(`Transaction ${success ? 'completed' : 'failed'} in ${duration}ms`);
    
    if (duration > 100) {
      console.warn(`Slow transaction detected: ${duration}ms`);
    }
  }

  async getMetrics(): Promise<PerformanceMetrics> {
    const allMetrics = Array.from(this.metrics.values()).flat();
    const recentMetrics = allMetrics.filter(m => m.timestamp! > Date.now() - 300000); // Last 5 minutes
    
    const totalQueries = recentMetrics.length;
    const successfulQueries = recentMetrics.filter(m => m.success);
    const slowQueries = recentMetrics.filter(m => m.duration > 50).length;
    
    const averageQueryTime = totalQueries > 0 
      ? successfulQueries.reduce((sum, m) => sum + m.duration, 0) / successfulQueries.length
      : 0;
    
    const errorRate = totalQueries > 0 
      ? (totalQueries - successfulQueries.length) / totalQueries * 100
      : 0;

    const totalCacheRequests = this.cacheHits + this.cacheMisses;
    const cacheHitRate = totalCacheRequests > 0 
      ? (this.cacheHits / totalCacheRequests) * 100
      : 0;

    return {
      totalQueries,
      averageQueryTime: Number(averageQueryTime.toFixed(2)),
      slowQueries,
      errorRate: Number(errorRate.toFixed(2)),
      cacheHitRate: Number(cacheHitRate.toFixed(2)),
      connectionCount: this.connectionCount,
      activeConnections: this.activeConnections
    };
  }

  async getSlowQueries(limit: number = 10): Promise<QueryMetrics[]> {
    const slowQueries: string[] = [];
    
    try {
      const keys = await redisClient.keys('slow_query:*');
      const queries = await Promise.all(
        keys.slice(0, limit).map(async (key) => {
          const data = await redisClient.get(key);
          return data ? JSON.parse(data) : null;
        })
      );
      
      return queries.filter(q => q !== null).sort((a, b) => b.duration - a.duration);
    } catch (error) {
      console.error('Error fetching slow queries:', error);
      return [];
    }
  }

  async getQueryStats(): Promise<any[]> {
    const stats: any[] = [];
    
    for (const [queryHash, metrics] of this.metrics.entries()) {
      const recentMetrics = metrics.filter(m => m.timestamp! > Date.now() - 3600000); // Last hour
      
      if (recentMetrics.length === 0) continue;
      
      const totalDuration = recentMetrics.reduce((sum, m) => sum + m.duration, 0);
      const avgDuration = totalDuration / recentMetrics.length;
      const maxDuration = Math.max(...recentMetrics.map(m => m.duration));
      const minDuration = Math.min(...recentMetrics.map(m => m.duration));
      
      stats.push({
        queryHash,
        query: recentMetrics[0].query.substring(0, 100) + '...',
        executionCount: recentMetrics.length,
        avgDuration: Number(avgDuration.toFixed(2)),
        minDuration,
        maxDuration,
        totalDuration
      });
    }
    
    return stats.sort((a, b) => b.totalDuration - a.totalDuration);
  }

  private hashQuery(query: string): string {
    // Normalize query for consistent hashing
    const normalizedQuery = query
      .replace(/\s+/g, ' ')
      .replace(/\$\d+/g, '$N')
      .trim()
      .toLowerCase();
    
    return crypto.createHash('sha256').update(normalizedQuery).digest('hex').substring(0, 16);
  }

  private async storeSlowQuery(queryId: string, metrics: QueryMetrics): Promise<void> {
    try {
      const key = `slow_query:${queryId}`;
      await redisClient.setEx(key, 3600, JSON.stringify({
        ...metrics,
        timestamp: Date.now()
      })); // Store for 1 hour
    } catch (error) {
      console.error('Error storing slow query:', error);
    }
  }

  private async storeError(error: Error): Promise<void> {
    try {
      const key = `db_error:${Date.now()}:${crypto.randomUUID().substring(0, 8)}`;
      await redisClient.setEx(key, 3600, JSON.stringify({
        message: error.message,
        stack: error.stack,
        timestamp: Date.now()
      })); // Store for 1 hour
    } catch (err) {
      console.error('Error storing database error:', err);
    }
  }

  private async updateQueryStats(queryHash: string, metrics: QueryMetrics): Promise<void> {
    try {
      const key = `query_stats:${queryHash}`;
      const existing = await redisClient.get(key);
      
      let stats;
      if (existing) {
        stats = JSON.parse(existing);
        stats.executionCount++;
        stats.totalDuration += metrics.duration;
        stats.avgDuration = stats.totalDuration / stats.executionCount;
        stats.minDuration = Math.min(stats.minDuration, metrics.duration);
        stats.maxDuration = Math.max(stats.maxDuration, metrics.duration);
        stats.lastExecuted = Date.now();
      } else {
        stats = {
          queryHash,
          query: metrics.query,
          executionCount: 1,
          totalDuration: metrics.duration,
          avgDuration: metrics.duration,
          minDuration: metrics.duration,
          maxDuration: metrics.duration,
          lastExecuted: Date.now(),
          createdAt: Date.now()
        };
      }
      
      await redisClient.setEx(key, 86400, JSON.stringify(stats)); // Store for 24 hours
    } catch (error) {
      console.error('Error updating query stats:', error);
    }
  }

  private cleanupOldMetrics(): void {
    const cutoffTime = Date.now() - 3600000; // 1 hour ago
    
    for (const [queryHash, metrics] of this.metrics.entries()) {
      const recentMetrics = metrics.filter(m => m.timestamp! > cutoffTime);
      
      if (recentMetrics.length === 0) {
        this.metrics.delete(queryHash);
      } else {
        this.metrics.set(queryHash, recentMetrics);
      }
    }
    
    console.log(`Cleaned up old metrics. Active query types: ${this.metrics.size}`);
  }

  private async reportMetrics(): Promise<void> {
    try {
      const metrics = await this.getMetrics();
      
      // Log metrics if there are performance issues
      if (metrics.averageQueryTime > 50 || metrics.errorRate > 5) {
        console.warn('Database performance alert:', {
          avgQueryTime: `${metrics.averageQueryTime}ms`,
          slowQueries: metrics.slowQueries,
          errorRate: `${metrics.errorRate}%`,
          cacheHitRate: `${metrics.cacheHitRate}%`,
          activeConnections: metrics.activeConnections
        });
      }
      
      // Store metrics in Redis for external monitoring
      await redisClient.setEx('db_metrics:current', 300, JSON.stringify({
        ...metrics,
        timestamp: Date.now()
      }));
      
    } catch (error) {
      console.error('Error reporting metrics:', error);
    }
  }
}
