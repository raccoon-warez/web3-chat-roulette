import { EventEmitter } from 'events';
import logger, { securityLogger } from './logger';
import { AlertManager } from './alert-manager';

export interface ErrorContext {
  userId?: string;
  userAddress?: string;
  requestId?: string;
  sessionId?: string;
  ip?: string;
  userAgent?: string;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: any;
  query?: any;
  params?: any;
  timestamp?: Date;
  environment?: string;
  version?: string;
  buildId?: string;
  [key: string]: any;
}

export interface ErrorFingerprint {
  type: string;
  message: string;
  file?: string;
  line?: number;
  function?: string;
  hash: string;
}

export interface TrackedError {
  id: string;
  fingerprint: ErrorFingerprint;
  error: Error;
  context: ErrorContext;
  timestamp: Date;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'new' | 'acknowledged' | 'resolved' | 'ignored';
  tags: string[];
  breadcrumbs: Breadcrumb[];
  stackTrace: string;
  affectedUsers: Set<string>;
  occurrencesByHour: Map<string, number>;
}

export interface Breadcrumb {
  timestamp: Date;
  message: string;
  level: 'debug' | 'info' | 'warning' | 'error';
  category: 'http' | 'navigation' | 'user' | 'system' | 'database' | 'websocket';
  data?: any;
}

export class ErrorTracker extends EventEmitter {
  private errors: Map<string, TrackedError> = new Map();
  private breadcrumbs: Breadcrumb[] = [];
  private maxBreadcrumbs = 100;
  private alertManager: AlertManager;
  private errorCounts: Map<string, number> = new Map();
  private rateLimiter: Map<string, number> = new Map();

  constructor(alertManager: AlertManager) {
    super();
    this.alertManager = alertManager;
    
    // Clean up old data periodically
    setInterval(() => this.cleanup(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Capture and track an error
   */
  captureError(error: Error, context: ErrorContext = {}): string {
    try {
      const fingerprint = this.generateFingerprint(error);
      const errorId = this.getOrCreateError(fingerprint, error, context);
      
      // Add breadcrumbs from current context
      this.addBreadcrumb({
        timestamp: new Date(),
        message: `Error occurred: ${error.message}`,
        level: 'error',
        category: this.categorizeBreadcrumb(context),
        data: { context }
      });

      // Rate limiting for similar errors
      if (!this.shouldProcessError(fingerprint.hash)) {
        return errorId;
      }

      const trackedError = this.errors.get(errorId)!;
      
      // Determine severity
      const severity = this.determineSeverity(error, context, trackedError);
      trackedError.severity = severity;
      
      // Log the error
      logger.error('Tracked Error', {
        errorId,
        fingerprint,
        context,
        severity,
        count: trackedError.count,
        stackTrace: error.stack
      });

      // Send alerts for critical errors
      if (severity === 'critical' || (severity === 'high' && trackedError.count === 1)) {
        this.alertManager.sendAlert({
          type: 'error',
          severity,
          title: `${severity.toUpperCase()}: ${error.name}`,
          message: error.message,
          metadata: {
            errorId,
            fingerprint,
            context,
            stackTrace: error.stack,
            count: trackedError.count
          }
        });
      }

      // Emit event
      this.emit('errorCaptured', trackedError);

      return errorId;
    } catch (trackingError) {
      logger.error('Error tracking failed', {
        originalError: error.message,
        trackingError: trackingError.message,
        context
      });
      return 'tracking-failed';
    }
  }

  /**
   * Capture exception with enhanced context
   */
  captureException(error: Error, context: ErrorContext = {}): string {
    // Add system context
    const enhancedContext = {
      ...context,
      timestamp: new Date(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      breadcrumbs: [...this.breadcrumbs]
    };

    return this.captureError(error, enhancedContext);
  }

  /**
   * Capture message as warning
   */
  captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'warning', context: ErrorContext = {}): void {
    const error = new Error(message);
    error.name = `CapturedMessage_${level}`;
    
    this.captureError(error, { ...context, level });
  }

  /**
   * Add breadcrumb for context
   */
  addBreadcrumb(breadcrumb: Breadcrumb): void {
    this.breadcrumbs.push(breadcrumb);
    
    // Keep only recent breadcrumbs
    if (this.breadcrumbs.length > this.maxBreadcrumbs) {
      this.breadcrumbs = this.breadcrumbs.slice(-this.maxBreadcrumbs);
    }
  }

  /**
   * Set user context
   */
  setUserContext(userId: string, userAddress?: string, metadata?: any): void {
    this.addBreadcrumb({
      timestamp: new Date(),
      message: `User context set: ${userId}`,
      level: 'info',
      category: 'user',
      data: { userId, userAddress, ...metadata }
    });
  }

  /**
   * Track performance issue
   */
  capturePerformanceIssue(operation: string, duration: number, threshold: number, context: ErrorContext = {}): string | null {
    if (duration <= threshold) return null;

    const error = new Error(`Performance issue: ${operation} took ${duration}ms (threshold: ${threshold}ms)`);
    error.name = 'PerformanceIssue';

    return this.captureError(error, {
      ...context,
      operation,
      duration,
      threshold,
      category: 'performance'
    });
  }

  /**
   * Get error statistics
   */
  getErrorStats(timeRange: { start: Date; end: Date } = { 
    start: new Date(Date.now() - 24 * 60 * 60 * 1000), 
    end: new Date() 
  }): {
    total: number;
    byStatus: Record<string, number>;
    bySeverity: Record<string, number>;
    topErrors: Array<{ fingerprint: ErrorFingerprint; count: number; severity: string }>;
    errorRate: number;
    affectedUsers: number;
  } {
    const errors = Array.from(this.errors.values()).filter(error => 
      error.timestamp >= timeRange.start && error.timestamp <= timeRange.end
    );

    const byStatus: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    const allAffectedUsers = new Set<string>();

    errors.forEach(error => {
      byStatus[error.status] = (byStatus[error.status] || 0) + error.count;
      bySeverity[error.severity] = (bySeverity[error.severity] || 0) + error.count;
      error.affectedUsers.forEach(user => allAffectedUsers.add(user));
    });

    const topErrors = errors
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
      .map(error => ({
        fingerprint: error.fingerprint,
        count: error.count,
        severity: error.severity
      }));

    const totalOccurrences = errors.reduce((sum, error) => sum + error.count, 0);
    const timeRangeHours = (timeRange.end.getTime() - timeRange.start.getTime()) / (1000 * 60 * 60);
    const errorRate = totalOccurrences / Math.max(timeRangeHours, 1);

    return {
      total: errors.length,
      byStatus,
      bySeverity,
      topErrors,
      errorRate,
      affectedUsers: allAffectedUsers.size
    };
  }

  /**
   * Get specific error details
   */
  getError(errorId: string): TrackedError | null {
    return this.errors.get(errorId) || null;
  }

  /**
   * Update error status
   */
  updateErrorStatus(errorId: string, status: TrackedError['status'], userId?: string): boolean {
    const error = this.errors.get(errorId);
    if (!error) return false;

    error.status = status;
    
    logger.info('Error status updated', {
      errorId,
      status,
      updatedBy: userId,
      fingerprint: error.fingerprint
    });

    this.emit('errorStatusChanged', { errorId, status, userId });
    return true;
  }

  /**
   * Generate error fingerprint for deduplication
   */
  private generateFingerprint(error: Error): ErrorFingerprint {
    const stack = error.stack || '';
    const lines = stack.split('\n');
    
    // Extract file and line from stack trace
    let file = '';
    let line = 0;
    let func = '';

    for (const stackLine of lines.slice(1)) {
      const match = stackLine.match(/at\s+([^(]+)?\s*\(([^:]+):(\d+):\d+\)/);
      if (match) {
        func = (match[1] || '').trim();
        file = match[2].replace(process.cwd(), '');
        line = parseInt(match[3]);
        break;
      }
    }

    // Create hash for deduplication
    const hashInput = `${error.name}:${error.message}:${file}:${line}`;
    const hash = Buffer.from(hashInput).toString('base64').slice(0, 16);

    return {
      type: error.name,
      message: error.message,
      file,
      line,
      function: func,
      hash
    };
  }

  /**
   * Get or create tracked error
   */
  private getOrCreateError(fingerprint: ErrorFingerprint, error: Error, context: ErrorContext): string {
    const existingError = Array.from(this.errors.values()).find(e => e.fingerprint.hash === fingerprint.hash);
    
    if (existingError) {
      // Update existing error
      existingError.count++;
      existingError.lastSeen = new Date();
      
      // Update context if user information is available
      if (context.userId) {
        existingError.affectedUsers.add(context.userId);
      }
      
      // Track occurrences by hour
      const hourKey = new Date().toISOString().slice(0, 13); // YYYY-MM-DDTHH
      existingError.occurrencesByHour.set(hourKey, (existingError.occurrencesByHour.get(hourKey) || 0) + 1);
      
      return existingError.id;
    }

    // Create new tracked error
    const errorId = `error_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const now = new Date();
    
    const trackedError: TrackedError = {
      id: errorId,
      fingerprint,
      error,
      context,
      timestamp: now,
      count: 1,
      firstSeen: now,
      lastSeen: now,
      severity: 'medium',
      status: 'new',
      tags: this.generateTags(error, context),
      breadcrumbs: [...this.breadcrumbs],
      stackTrace: error.stack || '',
      affectedUsers: new Set(context.userId ? [context.userId] : []),
      occurrencesByHour: new Map([[now.toISOString().slice(0, 13), 1]])
    };

    this.errors.set(errorId, trackedError);
    return errorId;
  }

  /**
   * Determine error severity based on context and patterns
   */
  private determineSeverity(error: Error, context: ErrorContext, trackedError: TrackedError): 'low' | 'medium' | 'high' | 'critical' {
    // Critical errors
    if (error.name === 'DatabaseConnectionError' || 
        error.message.toLowerCase().includes('database') ||
        error.message.toLowerCase().includes('redis') ||
        error.name === 'SecurityError') {
      return 'critical';
    }

    // High frequency errors become high severity
    if (trackedError.count > 10) {
      return 'high';
    }

    // Performance issues
    if (error.name === 'PerformanceIssue') {
      return context.duration && context.duration > 5000 ? 'high' : 'medium';
    }

    // Authentication/Authorization errors
    if (error.name === 'UnauthorizedError' || error.name === 'AuthenticationError') {
      return 'medium';
    }

    // Validation errors are usually low severity
    if (error.name === 'ValidationError') {
      return 'low';
    }

    return 'medium';
  }

  /**
   * Generate tags for error categorization
   */
  private generateTags(error: Error, context: ErrorContext): string[] {
    const tags: string[] = [];
    
    // Error type tags
    tags.push(`type:${error.name.toLowerCase()}`);
    
    // Context-based tags
    if (context.method) tags.push(`method:${context.method.toLowerCase()}`);
    if (context.url) {
      const path = context.url.split('?')[0];
      tags.push(`endpoint:${path}`);
    }
    if (context.userId) tags.push('has:user');
    if (context.userAddress) tags.push('has:wallet');
    
    // Environment tags
    tags.push(`env:${context.environment || process.env.NODE_ENV || 'development'}`);
    
    return tags;
  }

  /**
   * Rate limiting for similar errors
   */
  private shouldProcessError(hash: string): boolean {
    const now = Date.now();
    const key = `${hash}_${Math.floor(now / (5 * 60 * 1000))}`; // 5-minute windows
    
    const count = this.rateLimiter.get(key) || 0;
    this.rateLimiter.set(key, count + 1);
    
    // Allow first 10 occurrences in 5-minute window
    return count < 10;
  }

  /**
   * Categorize breadcrumb based on context
   */
  private categorizeBreadcrumb(context: ErrorContext): Breadcrumb['category'] {
    if (context.method || context.url) return 'http';
    if (context.sessionId) return 'websocket';
    if (context.userId) return 'user';
    return 'system';
  }

  /**
   * Cleanup old errors and breadcrumbs
   */
  private cleanup(): void {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
    
    // Remove old errors
    for (const [id, error] of this.errors.entries()) {
      if (error.lastSeen < cutoff && error.status === 'resolved') {
        this.errors.delete(id);
      }
    }

    // Clean rate limiter
    this.rateLimiter.clear();

    logger.info('Error tracker cleanup completed', {
      activeErrors: this.errors.size,
      breadcrumbs: this.breadcrumbs.length
    });
  }

  /**
   * Export errors for external analysis
   */
  exportErrors(format: 'json' | 'csv' = 'json', timeRange?: { start: Date; end: Date }) {
    let errors = Array.from(this.errors.values());
    
    if (timeRange) {
      errors = errors.filter(error => 
        error.timestamp >= timeRange.start && error.timestamp <= timeRange.end
      );
    }

    if (format === 'json') {
      return JSON.stringify(errors.map(error => ({
        id: error.id,
        fingerprint: error.fingerprint,
        message: error.error.message,
        timestamp: error.timestamp,
        count: error.count,
        severity: error.severity,
        status: error.status,
        tags: error.tags,
        affectedUsers: Array.from(error.affectedUsers),
        context: error.context
      })), null, 2);
    }

    // CSV format would be implemented here if needed
    return errors;
  }
}

// Global error tracker instance
let globalErrorTracker: ErrorTracker | null = null;

export function initializeErrorTracker(alertManager: AlertManager): ErrorTracker {
  if (!globalErrorTracker) {
    globalErrorTracker = new ErrorTracker(alertManager);
    
    // Set up global error handlers
    process.on('uncaughtException', (error) => {
      globalErrorTracker!.captureException(error, {
        category: 'uncaught_exception',
        fatal: true
      });
    });

    process.on('unhandledRejection', (reason, promise) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      error.name = 'UnhandledRejection';
      
      globalErrorTracker!.captureException(error, {
        category: 'unhandled_rejection',
        promise: promise.toString()
      });
    });
  }
  
  return globalErrorTracker;
}

export function getErrorTracker(): ErrorTracker | null {
  return globalErrorTracker;
}