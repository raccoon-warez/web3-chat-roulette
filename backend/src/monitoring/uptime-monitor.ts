import { EventEmitter } from 'events';
import logger from './logger';
import { AlertManager } from './alert-manager';
import { performance } from 'perf_hooks';

export interface UptimeCheck {
  id: string;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'HEAD';
  timeout: number;
  interval: number;
  expectedStatusCode: number;
  expectedBodyContains?: string;
  headers?: Record<string, string>;
  body?: string;
  enabled: boolean;
  alertOnFailure: boolean;
  alertThreshold: number; // failures before alerting
}

export interface UptimeResult {
  checkId: string;
  timestamp: Date;
  success: boolean;
  responseTime: number;
  statusCode?: number;
  error?: string;
  bodyMatched?: boolean;
}

export interface UptimeStats {
  checkId: string;
  name: string;
  uptime: number; // percentage
  averageResponseTime: number;
  totalChecks: number;
  successfulChecks: number;
  failedChecks: number;
  lastCheck?: UptimeResult;
  currentStreak: {
    type: 'success' | 'failure';
    count: number;
    startTime: Date;
  };
}

export class UptimeMonitor extends EventEmitter {
  private checks: Map<string, UptimeCheck> = new Map();
  private results: Map<string, UptimeResult[]> = new Map();
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private alertManager: AlertManager;
  private maxResultsPerCheck = 10080; // 7 days worth of minute intervals

  constructor(alertManager: AlertManager) {
    super();
    this.alertManager = alertManager;
    
    // Cleanup old results periodically
    setInterval(() => this.cleanupOldResults(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Add uptime check
   */
  addCheck(check: UptimeCheck): void {
    this.checks.set(check.id, check);
    
    if (!this.results.has(check.id)) {
      this.results.set(check.id, []);
    }
    
    if (check.enabled) {
      this.startCheck(check.id);
    }
    
    logger.info('Uptime check added', {
      checkId: check.id,
      name: check.name,
      url: check.url,
      enabled: check.enabled
    });
  }

  /**
   * Remove uptime check
   */
  removeCheck(checkId: string): boolean {
    const check = this.checks.get(checkId);
    if (!check) return false;
    
    this.stopCheck(checkId);
    this.checks.delete(checkId);
    this.results.delete(checkId);
    
    logger.info('Uptime check removed', { checkId });
    return true;
  }

  /**
   * Start monitoring for a check
   */
  startCheck(checkId: string): boolean {
    const check = this.checks.get(checkId);
    if (!check) return false;
    
    // Stop existing interval if any
    this.stopCheck(checkId);
    
    // Perform initial check
    this.performCheck(checkId);
    
    // Set up recurring checks
    const interval = setInterval(() => {
      this.performCheck(checkId);
    }, check.interval);
    
    this.intervals.set(checkId, interval);
    
    logger.info('Uptime check started', {
      checkId,
      name: check.name,
      interval: check.interval
    });
    
    return true;
  }

  /**
   * Stop monitoring for a check
   */
  stopCheck(checkId: string): boolean {
    const interval = this.intervals.get(checkId);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(checkId);
      
      logger.info('Uptime check stopped', { checkId });
      return true;
    }
    
    return false;
  }

  /**
   * Enable/disable a check
   */
  toggleCheck(checkId: string, enabled: boolean): boolean {
    const check = this.checks.get(checkId);
    if (!check) return false;
    
    check.enabled = enabled;
    
    if (enabled) {
      this.startCheck(checkId);
    } else {
      this.stopCheck(checkId);
    }
    
    return true;
  }

  /**
   * Perform a single uptime check
   */
  private async performCheck(checkId: string): Promise<UptimeResult> {
    const check = this.checks.get(checkId);
    if (!check) {
      throw new Error(`Check not found: ${checkId}`);
    }

    const startTime = performance.now();
    const result: UptimeResult = {
      checkId,
      timestamp: new Date(),
      success: false,
      responseTime: 0
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), check.timeout);

      const response = await fetch(check.url, {
        method: check.method,
        headers: {
          'User-Agent': 'Web3ChatRoulette-UptimeMonitor/1.0',
          ...check.headers
        },
        body: check.body,
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      
      result.responseTime = performance.now() - startTime;
      result.statusCode = response.status;
      
      // Check status code
      const statusOk = response.status === check.expectedStatusCode;
      
      // Check body content if specified
      let bodyMatched = true;
      if (check.expectedBodyContains) {
        const body = await response.text();
        bodyMatched = body.includes(check.expectedBodyContains);
        result.bodyMatched = bodyMatched;
      }
      
      result.success = statusOk && bodyMatched;
      
      if (!result.success) {
        result.error = `Status: ${response.status}, Expected: ${check.expectedStatusCode}${
          !bodyMatched ? ', Body check failed' : ''
        }`;
      }

    } catch (error) {
      result.responseTime = performance.now() - startTime;
      result.error = error instanceof Error ? error.message : String(error);
      result.success = false;
      
      // Handle specific error types
      if (error.name === 'AbortError') {
        result.error = `Timeout after ${check.timeout}ms`;
      }
    }

    // Store result
    this.storeResult(checkId, result);
    
    // Handle alerts
    this.handleAlerts(check, result);
    
    // Emit event
    this.emit('checkCompleted', result);
    
    logger.debug('Uptime check completed', {
      checkId,
      name: check.name,
      success: result.success,
      responseTime: `${result.responseTime.toFixed(2)}ms`,
      statusCode: result.statusCode,
      error: result.error
    });

    return result;
  }

  /**
   * Store check result
   */
  private storeResult(checkId: string, result: UptimeResult): void {
    const results = this.results.get(checkId) || [];
    results.push(result);
    
    // Keep only recent results
    if (results.length > this.maxResultsPerCheck) {
      results.splice(0, results.length - this.maxResultsPerCheck);
    }
    
    this.results.set(checkId, results);
  }

  /**
   * Handle alerting for failed checks
   */
  private handleAlerts(check: UptimeCheck, result: UptimeResult): void {
    if (!check.alertOnFailure) return;
    
    const results = this.results.get(check.id) || [];
    const recentResults = results.slice(-check.alertThreshold);
    
    // Check if we have enough recent failures to trigger alert
    if (recentResults.length >= check.alertThreshold &&
        recentResults.every(r => !r.success)) {
      
      // Check if we haven't already alerted recently
      const lastAlert = recentResults.find(r => r.timestamp > 
        new Date(Date.now() - 60 * 60 * 1000)); // Within last hour
      
      if (!lastAlert) {
        this.alertManager.sendAlert({
          type: 'health',
          severity: 'high',
          title: `Uptime Check Failed: ${check.name}`,
          message: `${check.name} has failed ${check.alertThreshold} consecutive times. Last error: ${result.error}`,
          metadata: {
            checkId: check.id,
            url: check.url,
            responseTime: result.responseTime,
            statusCode: result.statusCode,
            error: result.error,
            recentFailures: recentResults.length
          }
        });
      }
    }
    
    // Alert on recovery
    if (result.success && results.length > 1) {
      const previousResult = results[results.length - 2];
      if (!previousResult.success) {
        // Check if this is after a streak of failures
        const failureCount = this.getRecentFailureStreak(results);
        if (failureCount >= check.alertThreshold) {
          this.alertManager.sendAlert({
            type: 'health',
            severity: 'medium',
            title: `Uptime Check Recovered: ${check.name}`,
            message: `${check.name} has recovered after ${failureCount} failures.`,
            metadata: {
              checkId: check.id,
              url: check.url,
              responseTime: result.responseTime,
              statusCode: result.statusCode,
              failureCount
            }
          });
        }
      }
    }
  }

  /**
   * Get recent failure streak count
   */
  private getRecentFailureStreak(results: UptimeResult[]): number {
    let streak = 0;
    for (let i = results.length - 2; i >= 0; i--) {
      if (!results[i].success) {
        streak++;
      } else {
        break;
      }
    }
    return streak;
  }

  /**
   * Get uptime statistics for a check
   */
  getUptimeStats(checkId: string, timeRange?: { start: Date; end: Date }): UptimeStats | null {
    const check = this.checks.get(checkId);
    if (!check) return null;
    
    let results = this.results.get(checkId) || [];
    
    if (timeRange) {
      results = results.filter(r => 
        r.timestamp >= timeRange.start && r.timestamp <= timeRange.end
      );
    }
    
    if (results.length === 0) {
      return {
        checkId,
        name: check.name,
        uptime: 0,
        averageResponseTime: 0,
        totalChecks: 0,
        successfulChecks: 0,
        failedChecks: 0,
        currentStreak: {
          type: 'success',
          count: 0,
          startTime: new Date()
        }
      };
    }

    const successfulChecks = results.filter(r => r.success).length;
    const failedChecks = results.length - successfulChecks;
    const uptime = (successfulChecks / results.length) * 100;
    const averageResponseTime = results.reduce((sum, r) => sum + r.responseTime, 0) / results.length;
    
    // Calculate current streak
    const currentStreak = this.calculateCurrentStreak(results);
    
    return {
      checkId,
      name: check.name,
      uptime: Math.round(uptime * 100) / 100,
      averageResponseTime: Math.round(averageResponseTime * 100) / 100,
      totalChecks: results.length,
      successfulChecks,
      failedChecks,
      lastCheck: results[results.length - 1],
      currentStreak
    };
  }

  /**
   * Calculate current success/failure streak
   */
  private calculateCurrentStreak(results: UptimeResult[]): UptimeStats['currentStreak'] {
    if (results.length === 0) {
      return {
        type: 'success',
        count: 0,
        startTime: new Date()
      };
    }

    const latest = results[results.length - 1];
    let count = 1;
    let startTime = latest.timestamp;
    
    // Count consecutive results of the same type
    for (let i = results.length - 2; i >= 0; i--) {
      if (results[i].success === latest.success) {
        count++;
        startTime = results[i].timestamp;
      } else {
        break;
      }
    }
    
    return {
      type: latest.success ? 'success' : 'failure',
      count,
      startTime
    };
  }

  /**
   * Get all uptime statistics
   */
  getAllUptimeStats(): UptimeStats[] {
    return Array.from(this.checks.keys()).map(checkId => 
      this.getUptimeStats(checkId)
    ).filter(stats => stats !== null) as UptimeStats[];
  }

  /**
   * Get checks summary
   */
  getChecksSummary(): {
    total: number;
    enabled: number;
    disabled: number;
    healthy: number;
    degraded: number;
    down: number;
  } {
    const checks = Array.from(this.checks.values());
    const enabled = checks.filter(c => c.enabled).length;
    const stats = this.getAllUptimeStats();
    
    let healthy = 0;
    let degraded = 0;
    let down = 0;
    
    stats.forEach(stat => {
      if (stat.uptime >= 99) {
        healthy++;
      } else if (stat.uptime >= 95) {
        degraded++;
      } else {
        down++;
      }
    });
    
    return {
      total: checks.length,
      enabled,
      disabled: checks.length - enabled,
      healthy,
      degraded,
      down
    };
  }

  /**
   * Perform check on demand
   */
  async performCheckNow(checkId: string): Promise<UptimeResult> {
    return this.performCheck(checkId);
  }

  /**
   * Get recent results for a check
   */
  getRecentResults(checkId: string, limit: number = 100): UptimeResult[] {
    const results = this.results.get(checkId) || [];
    return results.slice(-limit);
  }

  /**
   * Export uptime data
   */
  exportUptimeData(format: 'json' | 'csv' = 'json', timeRange?: { start: Date; end: Date }): any {
    const data = {
      export_timestamp: new Date().toISOString(),
      time_range: timeRange,
      checks: Array.from(this.checks.values()).map(check => ({
        ...check,
        stats: this.getUptimeStats(check.id, timeRange),
        recent_results: this.getRecentResults(check.id, 1000).filter(result => 
          !timeRange || (result.timestamp >= timeRange.start && result.timestamp <= timeRange.end)
        )
      }))
    };
    
    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    }
    
    // CSV format would be implemented here if needed
    return data;
  }

  /**
   * Cleanup old results
   */
  private cleanupOldResults(): void {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
    
    for (const [checkId, results] of this.results.entries()) {
      const filteredResults = results.filter(result => result.timestamp > cutoff);
      this.results.set(checkId, filteredResults);
    }
    
    logger.debug('Uptime monitor cleanup completed');
  }

  /**
   * Stop all monitoring
   */
  stopAllChecks(): void {
    for (const checkId of this.intervals.keys()) {
      this.stopCheck(checkId);
    }
    logger.info('All uptime checks stopped');
  }

  /**
   * Start all enabled checks
   */
  startAllEnabledChecks(): void {
    for (const [checkId, check] of this.checks.entries()) {
      if (check.enabled) {
        this.startCheck(checkId);
      }
    }
    logger.info('All enabled uptime checks started');
  }
}

/**
 * Create standard web service uptime checks
 */
export function createStandardUptimeChecks(baseUrl: string): UptimeCheck[] {
  return [
    {
      id: 'api-health',
      name: 'API Health Check',
      url: `${baseUrl}/health`,
      method: 'GET',
      timeout: 5000,
      interval: 60000, // 1 minute
      expectedStatusCode: 200,
      expectedBodyContains: '"status"',
      enabled: true,
      alertOnFailure: true,
      alertThreshold: 3
    },
    {
      id: 'api-auth',
      name: 'Authentication Endpoint',
      url: `${baseUrl}/auth/siwe/nonce`,
      method: 'GET',
      timeout: 5000,
      interval: 300000, // 5 minutes
      expectedStatusCode: 200,
      enabled: true,
      alertOnFailure: true,
      alertThreshold: 2
    },
    {
      id: 'api-webrtc-config',
      name: 'WebRTC Config Endpoint',
      url: `${baseUrl}/api/webrtc/config`,
      method: 'GET',
      timeout: 10000,
      interval: 300000, // 5 minutes
      expectedStatusCode: 200,
      enabled: true,
      alertOnFailure: true,
      alertThreshold: 2
    }
  ];
}