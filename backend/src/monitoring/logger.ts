import winston from 'winston';
import path from 'path';
import os from 'os';

// Define log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for different log levels
const logColors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Add colors to winston
winston.addColors(logColors);

// Create custom format
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.metadata(),
  winston.format.printf(({ timestamp, level, message, stack, metadata, ...rest }) => {
    const metaStr = Object.keys(metadata || {}).length ? JSON.stringify(metadata) : '';
    const restStr = Object.keys(rest).length ? JSON.stringify(rest) : '';
    
    return JSON.stringify({
      timestamp,
      level,
      message,
      stack,
      hostname: os.hostname(),
      pid: process.pid,
      service: 'web3-chat-roulette',
      environment: process.env.NODE_ENV || 'development',
      metadata: metadata || {},
      ...rest
    });
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, stack, ...metadata }) => {
    const metaStr = Object.keys(metadata).length > 2 ? 
      JSON.stringify(metadata, null, 2) : '';
    return `${timestamp} [${level}]: ${message}${stack ? '\n' + stack : ''}${metaStr ? '\n' + metaStr : ''}`;
  })
);

// Define transports
const transports: winston.transport[] = [];

// Console transport
if (process.env.NODE_ENV !== 'production') {
  transports.push(
    new winston.transports.Console({
      level: 'debug',
      format: consoleFormat,
    })
  );
}

// File transports
const logsDir = path.join(process.cwd(), 'logs');
transports.push(
  // Error logs
  new winston.transports.File({
    filename: path.join(logsDir, 'error.log'),
    level: 'error',
    format: customFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 10,
    tailable: true
  }),
  // Combined logs
  new winston.transports.File({
    filename: path.join(logsDir, 'combined.log'),
    format: customFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 20,
    tailable: true
  }),
  // HTTP request logs
  new winston.transports.File({
    filename: path.join(logsDir, 'requests.log'),
    level: 'http',
    format: customFormat,
    maxsize: 10485760, // 10MB
    maxFiles: 5,
    tailable: true
  })
);

// Create logger instance
const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  transports,
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'exceptions.log'),
      format: customFormat,
      maxsize: 10485760,
      maxFiles: 5
    })
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join(logsDir, 'rejections.log'),
      format: customFormat,
      maxsize: 10485760,
      maxFiles: 5
    })
  ],
  exitOnError: false
});

// Performance logging
export const perfLogger = {
  start: (operation: string) => {
    const start = process.hrtime.bigint();
    return {
      end: (metadata?: any) => {
        const duration = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds
        logger.info('Performance measurement', {
          operation,
          duration: `${duration.toFixed(2)}ms`,
          ...metadata
        });
        return duration;
      }
    };
  }
};

// Request logging helper
export const requestLogger = (req: any, res: any, duration: number, error?: Error) => {
  const logLevel = error ? 'error' : (res.statusCode >= 400 ? 'warn' : 'http');
  
  logger.log(logLevel, 'HTTP Request', {
    method: req.method,
    url: req.url,
    statusCode: res.statusCode,
    duration: `${duration.toFixed(2)}ms`,
    userAgent: req.get('user-agent'),
    ip: req.ip || req.connection?.remoteAddress,
    userId: req.user?.id,
    userAddress: req.user?.address,
    error: error ? {
      message: error.message,
      stack: error.stack,
      name: error.name
    } : undefined
  });
};

// Database logging helper
export const dbLogger = {
  query: (query: string, params: any[], duration: number) => {
    logger.debug('Database Query', {
      query: query.replace(/\s+/g, ' ').trim(),
      params: JSON.stringify(params),
      duration: `${duration.toFixed(2)}ms`
    });
  },
  
  error: (query: string, params: any[], error: Error, duration: number) => {
    logger.error('Database Error', {
      query: query.replace(/\s+/g, ' ').trim(),
      params: JSON.stringify(params),
      duration: `${duration.toFixed(2)}ms`,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      }
    });
  }
};

// WebSocket logging helper
export const wsLogger = {
  connection: (clientId: string, ip: string, metadata?: any) => {
    logger.info('WebSocket Connection', {
      event: 'connection',
      clientId,
      ip,
      ...metadata
    });
  },
  
  message: (clientId: string, messageType: string, metadata?: any) => {
    logger.debug('WebSocket Message', {
      event: 'message',
      clientId,
      messageType,
      ...metadata
    });
  },
  
  error: (clientId: string, error: Error, metadata?: any) => {
    logger.error('WebSocket Error', {
      event: 'error',
      clientId,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name
      },
      ...metadata
    });
  },
  
  disconnect: (clientId: string, reason: string, metadata?: any) => {
    logger.info('WebSocket Disconnect', {
      event: 'disconnect',
      clientId,
      reason,
      ...metadata
    });
  }
};

// Security logging helper
export const securityLogger = {
  authAttempt: (address: string, ip: string, success: boolean, metadata?: any) => {
    logger.info('Authentication Attempt', {
      event: 'auth_attempt',
      address,
      ip,
      success,
      ...metadata
    });
  },
  
  rateLimitHit: (ip: string, endpoint: string, metadata?: any) => {
    logger.warn('Rate Limit Exceeded', {
      event: 'rate_limit',
      ip,
      endpoint,
      ...metadata
    });
  },
  
  suspiciousActivity: (ip: string, activity: string, metadata?: any) => {
    logger.warn('Suspicious Activity', {
      event: 'suspicious_activity',
      ip,
      activity,
      ...metadata
    });
  },
  
  securityIncident: (type: string, severity: 'low' | 'medium' | 'high' | 'critical', metadata?: any) => {
    logger.error('Security Incident', {
      event: 'security_incident',
      type,
      severity,
      ...metadata
    });
  }
};

// Business logic logging helper
export const businessLogger = {
  userAction: (userId: string, action: string, metadata?: any) => {
    logger.info('User Action', {
      event: 'user_action',
      userId,
      action,
      ...metadata
    });
  },
  
  web3Transaction: (transactionHash: string, type: string, metadata?: any) => {
    logger.info('Web3 Transaction', {
      event: 'web3_transaction',
      transactionHash,
      type,
      ...metadata
    });
  },
  
  matchmaking: (event: string, metadata?: any) => {
    logger.info('Matchmaking Event', {
      event: 'matchmaking',
      matchmakingEvent: event,
      ...metadata
    });
  },
  
  webrtc: (event: string, sessionId: string, metadata?: any) => {
    logger.info('WebRTC Event', {
      event: 'webrtc',
      webrtcEvent: event,
      sessionId,
      ...metadata
    });
  }
};

// Health check logging
export const healthLogger = {
  check: (component: string, status: 'healthy' | 'degraded' | 'unhealthy', metadata?: any) => {
    const level = status === 'healthy' ? 'info' : status === 'degraded' ? 'warn' : 'error';
    logger.log(level, 'Health Check', {
      event: 'health_check',
      component,
      status,
      ...metadata
    });
  }
};

// Create logs directory if it doesn't exist
import fs from 'fs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

export default logger;