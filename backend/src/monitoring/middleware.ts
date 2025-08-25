import { Request, Response, NextFunction } from 'express';
import { performance } from 'perf_hooks';
import logger, { requestLogger, perfLogger } from './logger';
import { metricsManager } from './metrics';
import { getErrorTracker } from './error-tracker';
import { alertManager } from './alert-manager';

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      startTime?: number;
      requestId?: string;
      monitoring?: {
        startTime: number;
        metrics: {
          dbQueries: number;
          cacheHits: number;
          cacheMisses: number;
        };
      };
    }
  }
}

/**
 * Request timing and logging middleware
 */
export function requestMonitoringMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = performance.now();
    req.startTime = startTime;
    req.requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    // Initialize monitoring data
    req.monitoring = {
      startTime,
      metrics: {
        dbQueries: 0,
        cacheHits: 0,
        cacheMisses: 0
      }
    };

    // Add request ID to response headers
    res.setHeader('X-Request-ID', req.requestId);

    // Track response
    res.on('finish', () => {
      const duration = performance.now() - startTime;
      
      // Record HTTP metrics
      metricsManager.recordHttpRequest(req, res, startTime);
      
      // Log request
      requestLogger(req, res, duration);
      
      // Track slow requests
      if (duration > 1000) { // 1 second threshold
        const errorTracker = getErrorTracker();
        if (errorTracker) {
          errorTracker.capturePerformanceIssue(
            `Slow HTTP Request: ${req.method} ${req.path}`,
            duration,
            1000,
            {
              method: req.method,
              url: req.url,
              userAgent: req.get('user-agent'),
              ip: req.ip,
              userId: req.user?.id,
              userAddress: req.user?.address,
              statusCode: res.statusCode,
              requestId: req.requestId
            }
          );
        }
      }
    });

    next();
  };
}

/**
 * Error handling middleware
 */
export function errorMonitoringMiddleware() {
  return (error: Error, req: Request, res: Response, next: NextFunction) => {
    const errorTracker = getErrorTracker();
    
    if (errorTracker) {
      errorTracker.captureError(error, {
        method: req.method,
        url: req.url,
        userAgent: req.get('user-agent'),
        ip: req.ip,
        userId: req.user?.id,
        userAddress: req.user?.address,
        requestId: req.requestId,
        headers: req.headers as Record<string, string>,
        body: req.body,
        query: req.query,
        params: req.params
      });
    }

    // Record error metrics
    const errorType = error.name || 'UnknownError';
    const severity = error.name === 'ValidationError' ? 'low' : 'medium';
    metricsManager.recordError(errorType, severity, 'http');

    next(error);
  };
}

/**
 * Database query monitoring wrapper
 */
export function monitorDatabaseQuery<T>(
  operation: string,
  table: string,
  queryFn: () => Promise<T>
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    const startTime = performance.now();
    
    try {
      const result = await queryFn();
      const duration = performance.now() - startTime;
      
      // Record metrics
      metricsManager.recordDatabaseQuery(operation, table, startTime, true);
      
      // Log if slow
      if (duration > 100) { // 100ms threshold
        logger.warn('Slow database query', {
          operation,
          table,
          duration: `${duration.toFixed(2)}ms`
        });
      }
      
      resolve(result);
    } catch (error) {
      const duration = performance.now() - startTime;
      
      // Record error metrics
      metricsManager.recordDatabaseQuery(operation, table, startTime, false);
      
      // Track error
      const errorTracker = getErrorTracker();
      if (errorTracker) {
        errorTracker.captureError(error as Error, {
          operation,
          table,
          duration,
          category: 'database'
        });
      }
      
      logger.error('Database query error', {
        operation,
        table,
        duration: `${duration.toFixed(2)}ms`,
        error: (error as Error).message
      });
      
      reject(error);
    }
  });
}

/**
 * Redis operation monitoring wrapper
 */
export function monitorRedisOperation<T>(
  operation: string,
  operationFn: () => Promise<T>
): Promise<T> {
  return new Promise(async (resolve, reject) => {
    const startTime = performance.now();
    
    try {
      const result = await operationFn();
      const duration = performance.now() - startTime;
      
      // Record metrics
      metricsManager.recordRedisOperation(operation, startTime, true);
      
      // Log if slow
      if (duration > 50) { // 50ms threshold
        logger.warn('Slow Redis operation', {
          operation,
          duration: `${duration.toFixed(2)}ms`
        });
      }
      
      resolve(result);
    } catch (error) {
      const duration = performance.now() - startTime;
      
      // Record error metrics
      metricsManager.recordRedisOperation(operation, startTime, false);
      
      // Track error
      const errorTracker = getErrorTracker();
      if (errorTracker) {
        errorTracker.captureError(error as Error, {
          operation,
          duration,
          category: 'redis'
        });
      }
      
      logger.error('Redis operation error', {
        operation,
        duration: `${duration.toFixed(2)}ms`,
        error: (error as Error).message
      });
      
      reject(error);
    }
  });
}

/**
 * WebSocket connection monitoring
 */
export class WebSocketMonitoring {
  private activeConnections: Map<string, {
    connectedAt: Date;
    userId?: string;
    ip: string;
    messageCount: number;
  }> = new Map();

  /**
   * Track new WebSocket connection
   */
  trackConnection(connectionId: string, ip: string, userId?: string): void {
    this.activeConnections.set(connectionId, {
      connectedAt: new Date(),
      userId,
      ip,
      messageCount: 0
    });

    metricsManager.recordWebSocketConnection('connected', connectionId);
    
    logger.info('WebSocket connection tracked', {
      connectionId,
      ip,
      userId,
      totalConnections: this.activeConnections.size
    });
  }

  /**
   * Track WebSocket disconnection
   */
  trackDisconnection(connectionId: string, reason?: string): void {
    const connection = this.activeConnections.get(connectionId);
    if (!connection) return;

    const sessionDuration = Date.now() - connection.connectedAt.getTime();
    
    this.activeConnections.delete(connectionId);
    metricsManager.recordWebSocketConnection('disconnected', connectionId);

    logger.info('WebSocket disconnection tracked', {
      connectionId,
      sessionDuration: `${sessionDuration}ms`,
      messageCount: connection.messageCount,
      reason,
      totalConnections: this.activeConnections.size
    });
  }

  /**
   * Track WebSocket message
   */
  trackMessage(
    connectionId: string, 
    messageType: string, 
    direction: 'inbound' | 'outbound',
    size: number
  ): void {
    const connection = this.activeConnections.get(connectionId);
    if (connection) {
      connection.messageCount++;
    }

    metricsManager.recordWebSocketMessage(messageType, direction, size);

    // Track suspicious message patterns
    if (size > 100 * 1024) { // 100KB threshold
      logger.warn('Large WebSocket message', {
        connectionId,
        messageType,
        size,
        direction
      });
    }
  }

  /**
   * Get connection statistics
   */
  getConnectionStats(): {
    active: number;
    totalMessages: number;
    averageSessionDuration: number;
    connectionsPerIP: Record<string, number>;
  } {
    let totalMessages = 0;
    let totalSessionDuration = 0;
    const connectionsPerIP: Record<string, number> = {};

    for (const connection of this.activeConnections.values()) {
      totalMessages += connection.messageCount;
      totalSessionDuration += Date.now() - connection.connectedAt.getTime();
      
      connectionsPerIP[connection.ip] = (connectionsPerIP[connection.ip] || 0) + 1;
    }

    return {
      active: this.activeConnections.size,
      totalMessages,
      averageSessionDuration: this.activeConnections.size > 0 ? 
        totalSessionDuration / this.activeConnections.size : 0,
      connectionsPerIP
    };
  }
}

/**
 * Web3 transaction monitoring wrapper
 */
export async function monitorWeb3Transaction<T>(
  type: string,
  network: string,
  transactionFn: () => Promise<{ result: T; gasUsed?: number }>
): Promise<T> {
  const startTime = performance.now();
  
  try {
    const { result, gasUsed } = await transactionFn();
    const duration = performance.now() - startTime;
    
    // Record metrics
    metricsManager.recordWeb3Transaction(type, network, startTime, true, gasUsed);
    
    logger.info('Web3 transaction completed', {
      type,
      network,
      duration: `${duration.toFixed(2)}ms`,
      gasUsed
    });
    
    return result;
  } catch (error) {
    const duration = performance.now() - startTime;
    
    // Record error metrics
    metricsManager.recordWeb3Transaction(type, network, startTime, false);
    
    // Track error
    const errorTracker = getErrorTracker();
    if (errorTracker) {
      errorTracker.captureError(error as Error, {
        type,
        network,
        duration,
        category: 'web3'
      });
    }
    
    logger.error('Web3 transaction failed', {
      type,
      network,
      duration: `${duration.toFixed(2)}ms`,
      error: (error as Error).message
    });
    
    throw error;
  }
}

/**
 * Performance monitoring decorator
 */
export function monitorPerformance(
  operationName: string,
  thresholdMs: number = 1000
) {
  return function (target: any, propertyName: string, descriptor: PropertyDescriptor) {
    const method = descriptor.value;
    
    descriptor.value = async function (...args: any[]) {
      const perf = perfLogger.start(operationName);
      
      try {
        const result = await method.apply(this, args);
        const duration = perf.end();
        
        // Track performance issues
        if (duration > thresholdMs) {
          const errorTracker = getErrorTracker();
          if (errorTracker) {
            errorTracker.capturePerformanceIssue(
              operationName,
              duration,
              thresholdMs,
              { method: propertyName, args }
            );
          }
        }
        
        return result;
      } catch (error) {
        perf.end({ error: (error as Error).message });
        throw error;
      }
    };
    
    return descriptor;
  };
}

/**
 * Rate limiting monitoring
 */
export function trackRateLimitHit(ip: string, endpoint: string, limit: number): void {
  logger.warn('Rate limit hit', { ip, endpoint, limit });
  
  // Record metrics
  metricsManager.recordError('RateLimitExceeded', 'medium', 'security');
  
  // Send alert for repeated violations
  const errorTracker = getErrorTracker();
  if (errorTracker) {
    errorTracker.captureError(new Error('Rate limit exceeded'), {
      ip,
      endpoint,
      limit,
      category: 'security'
    });
  }
}

/**
 * Security event monitoring
 */
export function trackSecurityEvent(
  eventType: 'auth_failure' | 'suspicious_activity' | 'blocked_request',
  details: any
): void {
  logger.warn('Security event', { eventType, ...details });
  
  metricsManager.recordError('SecurityEvent', 'high', 'security');
  
  // Alert on critical security events
  if (eventType === 'suspicious_activity') {
    alertManager.sendAlert({
      type: 'security',
      severity: 'high',
      title: 'Suspicious Activity Detected',
      message: `Security event: ${eventType}`,
      metadata: details
    });
  }
}

/**
 * Business metrics tracking
 */
export function trackBusinessMetric(
  metric: 'user_signup' | 'session_started' | 'session_completed' | 'transaction_sent',
  metadata?: any
): void {
  logger.info('Business metric', { metric, ...metadata });
  
  switch (metric) {
    case 'user_signup':
      metricsManager.recordUserAction('signup', 'authenticated');
      break;
    case 'session_started':
      metricsManager.recordWebRTCSession('started', metadata?.sessionId);
      break;
    case 'session_completed':
      metricsManager.recordWebRTCSession('ended', metadata?.sessionId, metadata?.duration);
      break;
    case 'transaction_sent':
      metricsManager.recordChatMessage(metadata?.type || 'text');
      break;
  }
}

// Export singleton WebSocket monitoring instance
export const wsMonitoring = new WebSocketMonitoring();

/**
 * Middleware to add monitoring context to requests
 */
export function addMonitoringContext() {
  return (req: Request, res: Response, next: NextFunction) => {
    // Add monitoring utilities to request object
    (req as any).monitoring = {
      ...req.monitoring,
      trackDbQuery: (operation: string, table: string) => {
        if (req.monitoring) {
          req.monitoring.metrics.dbQueries++;
        }
      },
      trackCacheHit: () => {
        if (req.monitoring) {
          req.monitoring.metrics.cacheHits++;
        }
      },
      trackCacheMiss: () => {
        if (req.monitoring) {
          req.monitoring.metrics.cacheMisses++;
        }
      }
    };
    
    next();
  };
}