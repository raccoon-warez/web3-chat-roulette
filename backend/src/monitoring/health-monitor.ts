import { EventEmitter } from 'events';
import logger, { healthLogger } from './logger';
import { metricsManager } from './metrics';
import { Pool } from 'pg';
import { RedisClientType } from 'redis';
import { performance } from 'perf_hooks';

export interface HealthCheckResult {
  component: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  details: any;
  timestamp: Date;
  error?: Error;
}

export interface DependencyCheck {
  name: string;
  check: () => Promise<HealthCheckResult>;
  timeout: number;
  critical: boolean;
}

export interface HealthStatus {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  components: HealthCheckResult[];
  timestamp: Date;
  uptime: number;
  version: string;
  environment: string;
}

export class HealthMonitor extends EventEmitter {
  private dependencies: Map<string, DependencyCheck> = new Map();
  private lastResults: Map<string, HealthCheckResult> = new Map();
  private checkInterval?: NodeJS.Timeout;
  private alertThresholds = {
    response_time_warning: 500,    // 500ms
    response_time_critical: 2000,  // 2s
    failure_count_threshold: 3,    // failures before alerting
    recovery_count_threshold: 2    // successes before recovery
  };
  private failureCounts: Map<string, number> = new Map();
  private recoveryCounts: Map<string, number> = new Map();

  constructor() {
    super();
  }

  /**
   * Register a dependency for health monitoring
   */
  registerDependency(dependency: DependencyCheck): void {
    this.dependencies.set(dependency.name, dependency);
    logger.info(`Health monitor dependency registered: ${dependency.name}`);
  }

  /**
   * Start health monitoring
   */
  start(intervalMs: number = 30000): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    logger.info(`Starting health monitor with ${intervalMs}ms interval`);
    
    // Initial check
    this.performHealthChecks();
    
    // Periodic checks
    this.checkInterval = setInterval(() => {
      this.performHealthChecks();
    }, intervalMs);
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    logger.info('Health monitor stopped');
  }

  /**
   * Perform health checks on all dependencies
   */
  async performHealthChecks(): Promise<HealthStatus> {
    const startTime = performance.now();
    const results: HealthCheckResult[] = [];
    
    logger.debug('Performing health checks');

    // Run all health checks in parallel
    const checkPromises = Array.from(this.dependencies.values()).map(async (dep) => {
      const checkStartTime = performance.now();
      
      try {
        // Apply timeout to the health check
        const result = await Promise.race([
          dep.check(),
          new Promise<HealthCheckResult>((_, reject) => 
            setTimeout(() => reject(new Error('Health check timeout')), dep.timeout)
          )
        ]);

        result.responseTime = performance.now() - checkStartTime;
        result.timestamp = new Date();
        
        // Handle success/failure tracking
        this.handleCheckResult(dep.name, result);
        
        return result;
      } catch (error) {
        const result: HealthCheckResult = {
          component: dep.name,
          status: 'unhealthy',
          responseTime: performance.now() - checkStartTime,
          details: { error: error.message },
          timestamp: new Date(),
          error: error instanceof Error ? error : new Error(String(error))
        };

        this.handleCheckResult(dep.name, result);
        return result;
      }
    });

    const allResults = await Promise.allSettled(checkPromises);
    
    // Process results
    allResults.forEach((promiseResult, index) => {
      const depName = Array.from(this.dependencies.keys())[index];
      
      if (promiseResult.status === 'fulfilled') {
        results.push(promiseResult.value);
        this.lastResults.set(depName, promiseResult.value);
      } else {
        // Create error result for failed promise
        const errorResult: HealthCheckResult = {
          component: depName,
          status: 'unhealthy',
          responseTime: 0,
          details: { error: promiseResult.reason?.message || 'Unknown error' },
          timestamp: new Date(),
          error: promiseResult.reason
        };
        results.push(errorResult);
        this.lastResults.set(depName, errorResult);
      }
    });

    // Determine overall health
    const overallStatus = this.determineOverallHealth(results);
    
    const healthStatus: HealthStatus = {
      overall: overallStatus,
      components: results,
      timestamp: new Date(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };

    // Log health status
    const totalDuration = performance.now() - startTime;
    healthLogger.check('overall', overallStatus, {
      duration: `${totalDuration.toFixed(2)}ms`,
      componentsChecked: results.length
    });

    // Record metrics
    results.forEach(result => {
      metricsManager.recordHealthCheck(result.component, result.status === 'healthy', result.responseTime / 1000);
    });

    // Emit health status event
    this.emit('healthStatus', healthStatus);

    return healthStatus;
  }

  /**
   * Get current health status
   */
  getCurrentHealth(): HealthStatus {
    const results = Array.from(this.lastResults.values());
    
    return {
      overall: this.determineOverallHealth(results),
      components: results,
      timestamp: new Date(),
      uptime: process.uptime(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };
  }

  /**
   * Get health status for a specific component
   */
  getComponentHealth(componentName: string): HealthCheckResult | null {
    return this.lastResults.get(componentName) || null;
  }

  /**
   * Handle check result and track failures/recoveries
   */
  private handleCheckResult(componentName: string, result: HealthCheckResult): void {
    const previousResult = this.lastResults.get(componentName);
    const dependency = this.dependencies.get(componentName);
    
    if (result.status === 'unhealthy') {
      const failureCount = (this.failureCounts.get(componentName) || 0) + 1;
      this.failureCounts.set(componentName, failureCount);
      this.recoveryCounts.delete(componentName);
      
      // Alert on critical dependency failure
      if (dependency?.critical && failureCount >= this.alertThresholds.failure_count_threshold) {
        this.emit('criticalFailure', {
          component: componentName,
          result,
          failureCount
        });
        
        healthLogger.check(componentName, 'unhealthy', {
          failureCount,
          critical: true,
          error: result.error?.message
        });
      }
    } else if (result.status === 'healthy') {
      if (previousResult?.status === 'unhealthy') {
        const recoveryCount = (this.recoveryCounts.get(componentName) || 0) + 1;
        this.recoveryCounts.set(componentName, recoveryCount);
        
        if (recoveryCount >= this.alertThresholds.recovery_count_threshold) {
          this.failureCounts.delete(componentName);
          this.recoveryCounts.delete(componentName);
          
          this.emit('recovery', {
            component: componentName,
            result,
            recoveryCount
          });
          
          healthLogger.check(componentName, 'healthy', { recovered: true });
        }
      } else {
        // Reset counters on stable health
        this.failureCounts.delete(componentName);
        this.recoveryCounts.delete(componentName);
      }
    }

    // Alert on slow response times
    if (result.responseTime > this.alertThresholds.response_time_critical) {
      this.emit('slowResponse', {
        component: componentName,
        responseTime: result.responseTime,
        threshold: this.alertThresholds.response_time_critical
      });
    }
  }

  /**
   * Determine overall health based on component results
   */
  private determineOverallHealth(results: HealthCheckResult[]): 'healthy' | 'degraded' | 'unhealthy' {
    if (results.length === 0) return 'unhealthy';

    const critical = Array.from(this.dependencies.values()).filter(dep => dep.critical);
    const criticalResults = results.filter(result => 
      critical.some(dep => dep.name === result.component)
    );

    // If any critical dependency is unhealthy, overall is unhealthy
    if (criticalResults.some(result => result.status === 'unhealthy')) {
      return 'unhealthy';
    }

    // If any critical dependency is degraded, overall is degraded
    if (criticalResults.some(result => result.status === 'degraded')) {
      return 'degraded';
    }

    // If any non-critical dependency is unhealthy, overall is degraded
    if (results.some(result => result.status === 'unhealthy')) {
      return 'degraded';
    }

    // If any dependency is degraded, overall is degraded
    if (results.some(result => result.status === 'degraded')) {
      return 'degraded';
    }

    return 'healthy';
  }
}

/**
 * Create database health check
 */
export function createDatabaseHealthCheck(pool: Pool): DependencyCheck {
  return {
    name: 'database',
    critical: true,
    timeout: 5000,
    check: async (): Promise<HealthCheckResult> => {
      const startTime = performance.now();
      
      try {
        const client = await pool.connect();
        const result = await client.query('SELECT 1 as health_check');
        client.release();
        
        const responseTime = performance.now() - startTime;
        const poolStats = {
          totalCount: pool.totalCount,
          idleCount: pool.idleCount,
          waitingCount: pool.waitingCount
        };

        return {
          component: 'database',
          status: responseTime < 1000 ? 'healthy' : 'degraded',
          responseTime,
          details: {
            queryResult: result.rows[0],
            poolStats
          },
          timestamp: new Date()
        };
      } catch (error) {
        return {
          component: 'database',
          status: 'unhealthy',
          responseTime: performance.now() - startTime,
          details: { error: error.message },
          timestamp: new Date(),
          error: error instanceof Error ? error : new Error(String(error))
        };
      }
    }
  };
}

/**
 * Create Redis health check
 */
export function createRedisHealthCheck(redis: RedisClientType): DependencyCheck {
  return {
    name: 'redis',
    critical: true,
    timeout: 3000,
    check: async (): Promise<HealthCheckResult> => {
      const startTime = performance.now();
      
      try {
        const pong = await redis.ping();
        const info = await redis.info('server');
        
        const responseTime = performance.now() - startTime;
        
        return {
          component: 'redis',
          status: pong === 'PONG' && responseTime < 500 ? 'healthy' : 'degraded',
          responseTime,
          details: {
            ping: pong,
            serverInfo: info.split('\r\n').slice(0, 5) // First few lines of server info
          },
          timestamp: new Date()
        };
      } catch (error) {
        return {
          component: 'redis',
          status: 'unhealthy',
          responseTime: performance.now() - startTime,
          details: { error: error.message },
          timestamp: new Date(),
          error: error instanceof Error ? error : new Error(String(error))
        };
      }
    }
  };
}

/**
 * Create system health check
 */
export function createSystemHealthCheck(): DependencyCheck {
  return {
    name: 'system',
    critical: false,
    timeout: 2000,
    check: async (): Promise<HealthCheckResult> => {
      const startTime = performance.now();
      
      try {
        const memUsage = process.memoryUsage();
        const loadAvg = require('os').loadavg();
        const freeMemory = require('os').freemem();
        const totalMemory = require('os').totalmem();
        
        const memoryUsagePercent = ((totalMemory - freeMemory) / totalMemory) * 100;
        const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
        
        let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
        
        // Determine status based on system metrics
        if (memoryUsagePercent > 90 || heapUsagePercent > 90 || loadAvg[0] > 10) {
          status = 'unhealthy';
        } else if (memoryUsagePercent > 80 || heapUsagePercent > 80 || loadAvg[0] > 5) {
          status = 'degraded';
        }
        
        return {
          component: 'system',
          status,
          responseTime: performance.now() - startTime,
          details: {
            memory: {
              usage: `${memoryUsagePercent.toFixed(1)}%`,
              free: `${(freeMemory / 1024 / 1024).toFixed(0)}MB`,
              total: `${(totalMemory / 1024 / 1024).toFixed(0)}MB`
            },
            heap: {
              used: `${(memUsage.heapUsed / 1024 / 1024).toFixed(0)}MB`,
              total: `${(memUsage.heapTotal / 1024 / 1024).toFixed(0)}MB`,
              usage: `${heapUsagePercent.toFixed(1)}%`
            },
            load: loadAvg.map(l => l.toFixed(2)),
            uptime: `${(process.uptime() / 3600).toFixed(1)}h`
          },
          timestamp: new Date()
        };
      } catch (error) {
        return {
          component: 'system',
          status: 'unhealthy',
          responseTime: performance.now() - startTime,
          details: { error: error.message },
          timestamp: new Date(),
          error: error instanceof Error ? error : new Error(String(error))
        };
      }
    }
  };
}

/**
 * Create external service health check
 */
export function createExternalServiceHealthCheck(
  name: string, 
  url: string, 
  timeout: number = 5000,
  critical: boolean = false
): DependencyCheck {
  return {
    name,
    critical,
    timeout,
    check: async (): Promise<HealthCheckResult> => {
      const startTime = performance.now();
      
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);
        
        const response = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
          headers: {
            'User-Agent': 'Web3ChatRoulette-HealthMonitor/1.0'
          }
        });
        
        clearTimeout(timeoutId);
        const responseTime = performance.now() - startTime;
        
        let status: 'healthy' | 'degraded' | 'unhealthy';
        if (response.ok && responseTime < 2000) {
          status = 'healthy';
        } else if (response.status >= 500 || responseTime > 5000) {
          status = 'unhealthy';
        } else {
          status = 'degraded';
        }
        
        return {
          component: name,
          status,
          responseTime,
          details: {
            url,
            statusCode: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries())
          },
          timestamp: new Date()
        };
      } catch (error) {
        return {
          component: name,
          status: 'unhealthy',
          responseTime: performance.now() - startTime,
          details: { 
            url,
            error: error.message 
          },
          timestamp: new Date(),
          error: error instanceof Error ? error : new Error(String(error))
        };
      }
    }
  };
}

export const healthMonitor = new HealthMonitor();