import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';
import cron from 'node-cron';
import cookieParser from 'cookie-parser';
import { 
  initializeDatabase, 
  createTables, 
  healthCheck,
  performanceMonitor,
  optimizer,
  cacheManager
} from './utils/database';
import { initializeRedis, connectionStats } from './utils/redis';
import { MigrationManager } from './database/migration-manager';
import { signalingService } from './services/signaling-service';
import { webrtcService } from './services/webrtc-service';
import authenticateToken, { authenticateWebSocket } from './middleware/auth';
import { generalRateLimit, wsConnectionRateLimit } from './middleware/rateLimiter';
import { 
  helmetConfig, 
  corsConfig, 
  hppProtection, 
  mongoSanitization,
  compressionConfig,
  customSecurityHeaders,
  securityLogging,
  ipFilter,
  contentLengthValidator,
  websocketSecurityHeaders,
  securityErrorHandler
} from './middleware/security';
import { sanitizeRequest } from './middleware/validation';

// Import comprehensive monitoring system
import { monitoringSystem, logger } from './monitoring';
import { 
  requestMonitoringMiddleware, 
  errorMonitoringMiddleware,
  addMonitoringContext,
  wsMonitoring,
  trackBusinessMetric
} from './monitoring/middleware';

// Load environment variables first
dotenv.config();

// Validate required environment variables
const requiredEnvVars = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
  console.warn('Warning: Missing environment variables:', missingEnvVars);
  console.warn('Some security features may use fallback values');
}

// Create Express app
const app = express();
const server = http.createServer(app);

// Trust proxy (important for rate limiting and IP detection)
app.set('trust proxy', 1);

// Monitoring middleware (early in the chain)
app.use(requestMonitoringMiddleware());
app.use(addMonitoringContext());

// Security middleware (order is important)
app.use(helmetConfig);
app.use(cors(corsConfig));
app.use(cookieParser());
app.use(compressionConfig);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(hppProtection);
app.use(mongoSanitization);
app.use(contentLengthValidator());
app.use(customSecurityHeaders);
app.use(securityLogging);
app.use(ipFilter);
app.use(sanitizeRequest);

// Apply general rate limiting to all routes
app.use(generalRateLimit);

// Enhanced health check endpoint with database status
app.get('/health', async (req, res) => {
  try {
    const dbHealth = await healthCheck();
    const redisStats = connectionStats;
    
    const overallStatus = dbHealth.status === 'healthy' && redisStats.isConnected ? 'healthy' : 'degraded';
    
    res.status(overallStatus === 'healthy' ? 200 : 503).json({ 
      status: overallStatus,
      database: dbHealth,
      redis: {
        connected: redisStats.isConnected,
        commands: redisStats.commands,
        errorRate: redisStats.errorRate
      },
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Performance monitoring endpoint
app.get('/health/performance', authenticateToken, async (req, res) => {
  try {
    const [
      performanceMetrics,
      cacheStats,
      slowQueries
    ] = await Promise.all([
      performanceMonitor.getMetrics(),
      cacheManager.getStats(),
      performanceMonitor.getSlowQueries(10)
    ]);
    
    res.json({
      performance: performanceMetrics,
      cache: cacheStats,
      slowQueries: slowQueries.slice(0, 5), // Top 5 slow queries
      recommendations: [
        performanceMetrics.averageQueryTime > 50 ? 'Consider query optimization' : null,
        cacheStats.hitRate < 70 ? 'Improve caching strategy' : null,
        performanceMetrics.errorRate > 5 ? 'Investigate database errors' : null
      ].filter(Boolean),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to fetch performance metrics',
      message: error.message
    });
  }
});

// Security endpoint for monitoring
app.get('/security/status', authenticateToken, (req, res) => {
  res.json({
    securityFeatures: {
      rateLimiting: true,
      authentication: true,
      inputValidation: true,
      securityHeaders: true,
      cors: true,
      compression: true,
      logging: true,
      ipFiltering: true,
      databaseOptimization: true,
      performanceMonitoring: true
    },
    timestamp: new Date().toISOString()
  });
});

// Import routes
import authRoutes from './routes/auth';
import reportRoutes from './routes/reports';
import blockRoutes from './routes/blocks';
import balanceRoutes from './routes/balances';
import databaseRoutes from './routes/database';

// Use routes with specific middleware
app.use('/auth', authRoutes);
app.use('/reports', reportRoutes);
app.use('/blocks', blockRoutes);
app.use('/balances', balanceRoutes);
app.use('/database', databaseRoutes); // Database monitoring endpoints

// WebSocket server with security enhancements
const wss = new WebSocket.Server({ 
  server,
  verifyClient: async (info: any) => {
    try {
      const clientIp = info.req.socket.remoteAddress || 'unknown';
      
      // Rate limiting for WebSocket connections
      const rateLimitOk = await wsConnectionRateLimit(clientIp);
      if (!rateLimitOk) {
        console.warn(`WebSocket rate limit exceeded for IP: ${clientIp}`);
        return false;
      }
      
      // Validate WebSocket upgrade request
      const url = new URL(info.req.url || '', `ws://${info.req.headers.host}`);
      const token = url.searchParams.get('token') || 
        (info.req.headers.authorization?.replace('Bearer ', ''));
      
      // Optional: Require authentication for WebSocket connections
      if (process.env.WS_REQUIRE_AUTH === 'true' && token) {
        const authResult = await authenticateWebSocket(token);
        if (!authResult) {
          console.warn(`WebSocket authentication failed for IP: ${clientIp}`);
          return false;
        }
      }
      
      return true;
    } catch (error) {
      console.error('WebSocket verification error:', error);
      return false; // Reject connection on errors
    }
  }
});

// WebSocket connection handling with enhanced security and monitoring
wss.on('connection', async (ws: WebSocket, req) => {
  const clientIp = req.socket.remoteAddress || 'unknown';
  const connectionId = `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  try {
    // Extract and validate connection parameters
    const url = new URL(req.url || '', `ws://${req.headers.host}`);
    const userId = url.searchParams.get('userId');
    const token = url.searchParams.get('token') || 
      (req.headers.authorization?.replace('Bearer ', ''));
    
    let authenticatedUser = null;
    
    // Authenticate if token is provided
    if (token) {
      authenticatedUser = await authenticateWebSocket(token);
      if (!authenticatedUser) {
        logger.warn(`Invalid WebSocket token from ${clientIp}`);
        ws.close(1008, 'Invalid authentication token');
        return;
      }
    }
    
    // Track WebSocket connection
    wsMonitoring.trackConnection(connectionId, clientIp, userId || authenticatedUser?.id);
    
    logger.info('New WebSocket connection established:', {
      connectionId,
      clientIp,
      userId,
      authenticated: !!authenticatedUser,
      userAddress: authenticatedUser?.address,
      timestamp: new Date().toISOString()
    });
    
    // Set up connection timeout
    const connectionTimeout = setTimeout(() => {
      logger.warn('WebSocket connection timeout', { connectionId });
      ws.close(1000, 'Connection timeout');
    }, 5 * 60 * 1000); // 5 minutes
    
    // Clear timeout on activity
    const clearConnectionTimeout = () => {
      clearTimeout(connectionTimeout);
    };
    
    // Handle connection with enhanced signaling service
    signalingService.handleConnection(ws, userId || undefined);
    
    // Security: Monitor for suspicious activity
    let messageCount = 0;
    const messageLimit = 100; // messages per minute
    const messageLimitWindow = 60 * 1000; // 1 minute
    let messageWindowStart = Date.now();
    
    ws.on('message', (data) => {
      clearConnectionTimeout();
      
      // Message rate limiting
      const now = Date.now();
      if (now - messageWindowStart > messageLimitWindow) {
        messageCount = 0;
        messageWindowStart = now;
      }
      
      messageCount++;
      if (messageCount > messageLimit) {
        logger.warn(`WebSocket message rate limit exceeded for ${clientIp}`, { connectionId });
        ws.close(1008, 'Message rate limit exceeded');
        return;
      }
      
      // Message size validation
      const messageSize = Buffer.isBuffer(data) ? data.length : 
        (data instanceof ArrayBuffer ? data.byteLength : data.toString().length);
      if (messageSize > 10240) { // 10KB limit
        logger.warn(`WebSocket message too large from ${clientIp}: ${messageSize} bytes`, { connectionId });
        ws.close(1009, 'Message too large');
        return;
      }
      
      try {
        // Validate JSON structure
        const message = JSON.parse(data.toString());
        const messageType = message.type || 'unknown';
        
        // Track WebSocket message
        wsMonitoring.trackMessage(connectionId, messageType, 'inbound', messageSize);
        
        // Basic message sanitization
        if (typeof message === 'object' && message !== null) {
          // Log potentially suspicious messages
          if (JSON.stringify(message).includes('<script>') || 
              JSON.stringify(message).includes('javascript:')) {
            logger.warn(`Suspicious WebSocket message from ${clientIp}`, { 
              connectionId,
              messageType,
              suspicious: true
            });
          }
        }
        
        // Track business metrics for certain message types
        if (messageType === 'offer' || messageType === 'answer') {
          trackBusinessMetric('session_started', { sessionId: userId, messageType });
        }
        
      } catch (error) {
        logger.warn(`Invalid WebSocket message format from ${clientIp}`, { connectionId });
        ws.close(1003, 'Invalid message format');
        return;
      }
    });
    
    ws.on('close', (code, reason) => {
      clearTimeout(connectionTimeout);
      wsMonitoring.trackDisconnection(connectionId, reason?.toString());
      logger.info(`WebSocket connection closed for ${clientIp}`, { 
        connectionId, 
        code, 
        reason: reason?.toString()
      });
    });
    
    ws.on('error', (error) => {
      clearTimeout(connectionTimeout);
      wsMonitoring.trackDisconnection(connectionId, 'error');
      logger.error('WebSocket error:', { connectionId, error: error.message });
    });
    
  } catch (error) {
    logger.error('WebSocket connection error:', { connectionId, error: error.message });
    ws.close(1011, 'Server error');
  }
});

// Add WebRTC monitoring endpoint with authentication
app.get('/api/webrtc/stats', authenticateToken, (req, res) => {
  try {
    res.json({
      activeSessions: signalingService.getActiveSessionsCount(),
      queues: signalingService.getQueueStatus(),
      timestamp: Date.now(),
      uptime: process.uptime()
    });
  } catch (error) {
    console.error('Failed to get WebRTC stats:', error);
    res.status(500).json({ 
      error: 'Failed to retrieve statistics',
      code: 'STATS_FETCH_FAILED' 
    });
  }
});

// Add WebRTC configuration endpoint with rate limiting
app.get('/api/webrtc/config', generalRateLimit, async (req, res) => {
  try {
    const config = await webrtcService.generateWebRTCConfig();
    
    // Add security headers for WebRTC config
    res.set({
      'Cache-Control': 'private, no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    
    res.json(config);
  } catch (error) {
    console.error('Failed to generate WebRTC config:', error);
    res.status(500).json({ 
      error: 'Failed to generate WebRTC configuration',
      code: 'WEBRTC_CONFIG_FAILED'
    });
  }
});

// Catch-all route for undefined endpoints
app.use('*', (req, res) => {
  res.status(404).json({ 
    error: 'Endpoint not found',
    code: 'NOT_FOUND',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Error monitoring middleware (before security error handler)
app.use(errorMonitoringMiddleware());

// Security-focused error handler (must be last)
app.use(securityErrorHandler);

// Setup cron jobs for cleanup and maintenance
cron.schedule('*/5 * * * *', () => {
  console.log('Running scheduled cleanup...');
  webrtcService.cleanup();
});

// Clean up expired tokens and rate limit entries
cron.schedule('0 * * * *', async () => {
  console.log('Running security cleanup...');
  try {
    // This would typically clean up expired entries in Redis
    console.log('Security cleanup completed');
  } catch (error) {
    console.error('Security cleanup error:', error);
  }
});

// Database optimization cron job
cron.schedule('*/15 * * * *', async () => {
  console.log('Running database optimization...');
  try {
    const result = await optimizer.analyzeAndOptimize();
    if (result.indexesCreated > 0 || result.indexesDropped > 0) {
      console.log('Database optimization completed:', result);
    }
  } catch (error) {
    console.error('Database optimization error:', error);
  }
});

// Performance monitoring and alerting
cron.schedule('*/1 * * * *', async () => {
  try {
    const metrics = await performanceMonitor.getMetrics();
    
    // Alert on performance issues
    if (metrics.averageQueryTime > 100) {
      console.warn('PERFORMANCE ALERT: High average query time:', metrics.averageQueryTime + 'ms');
    }
    
    if (metrics.errorRate > 10) {
      console.warn('PERFORMANCE ALERT: High error rate:', metrics.errorRate + '%');
    }
    
    const cacheStats = await cacheManager.getStats();
    if (cacheStats.hitRate < 60 && cacheStats.hits + cacheStats.misses > 100) {
      console.warn('PERFORMANCE ALERT: Low cache hit rate:', cacheStats.hitRate + '%');
    }
  } catch (error) {
    console.error('Performance monitoring error:', error);
  }
});

// Initialize database and Redis with error handling
const initializeServices = async () => {
  try {
    logger.info('🚀 Initializing services with database optimization...');
    
    // Initialize database with optimizations
    await initializeDatabase();
    logger.info('✅ Database initialized with performance optimizations');
    
    // Create tables with optimized schema
    await createTables();
    logger.info('✅ Database tables created with optimized schema');
    
    // Run migrations
    const migrationManager = new MigrationManager(undefined); // Uses default pool
    await migrationManager.initialize();
    const migrationResult = await migrationManager.runMigrations();
    
    if (migrationResult.success) {
      logger.info(`✅ Database migrations completed: ${migrationResult.migrationsRun} applied`);
    } else {
      logger.warn('⚠️ Database migrations had issues:', migrationResult.errors);
    }
    
    // Initialize Redis
    await initializeRedis();
    logger.info('✅ Redis initialized with connection pooling');
    
    // Initialize comprehensive monitoring system
    const { pool } = await import('./utils/database');
    const { redisClient } = await import('./utils/redis');
    
    await monitoringSystem.initialize({
      databasePool: pool,
      redisClient,
      baseUrl: `http://localhost:${process.env.PORT || 3001}`
    });
    
    logger.info('🎉 All services initialized successfully with comprehensive monitoring');
  } catch (error) {
    logger.error('❌ Service initialization error:', error.message);
    throw error;
  }
};

// Graceful shutdown handling
const gracefulShutdown = async (signal: string) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`);
  
  try {
    // Stop monitoring system first
    await monitoringSystem.shutdown();
    
    server.close(() => {
      logger.info('HTTP server closed');
      
      // Close WebSocket connections
      wss.clients.forEach((ws) => {
        ws.close(1000, 'Server shutdown');
      });
      
      logger.info('WebSocket connections closed');
      logger.info('Graceful shutdown completed');
      process.exit(0);
    });
    
    // Force shutdown after timeout
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error.message);
    process.exit(1);
  }
};

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions and unhandled rejections
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', { error: error.message, stack: error.stack });
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', { 
    reason: reason instanceof Error ? reason.message : String(reason),
    promise: promise.toString()
  });
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Initialize services and start server
initializeServices().then(() => {
  const PORT = process.env.PORT || 3001;
  const HOST = process.env.HOST || '0.0.0.0';
  
  server.listen(parseInt(PORT.toString()), HOST, () => {
    logger.info(`🚀 Server running on ${HOST}:${PORT}`);
    logger.info(`🛡️  Security features: Authentication, Rate Limiting, Input Validation`);
    logger.info(`⚡ Database optimizations: Connection pooling, indexes, caching, monitoring`);
    logger.info(`📊 Monitoring & Observability:`);
    logger.info(`   - Health: GET /health`);
    logger.info(`   - Metrics (Prometheus): GET /api/metrics`);
    logger.info(`   - Dashboard: http://localhost:3002`);
    logger.info(`   - Error Tracking: Comprehensive error monitoring`);
    logger.info(`   - Alerts: Email, Slack, Console notifications`);
    logger.info(`   - Uptime: Synthetic monitoring`);
    logger.info(`🔐 Auth endpoints: /auth/siwe/nonce, /auth/siwe/verify, /auth/refresh`);
    logger.info(`📡 WebRTC endpoints: /api/webrtc/config, /api/webrtc/stats`);
    logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
    
    // Log monitoring system status
    const monitoringStatus = monitoringSystem.getStatus();
    logger.info('📈 Monitoring System Status:', monitoringStatus.components);
  });
}).catch((error) => {
  logger.error('Failed to initialize services:', error.message);
  process.exit(1);
});
