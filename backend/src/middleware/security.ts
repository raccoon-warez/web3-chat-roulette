import helmet from 'helmet';
import hpp from 'hpp';
import mongoSanitize from 'express-mongo-sanitize';
import compression from 'compression';
import { Request, Response, NextFunction } from 'express';

// Enhanced Helmet configuration with CSP and security headers
export const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:", "https:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      workerSrc: ["'self'"],
      childSrc: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: []
    },
  },
  crossOriginEmbedderPolicy: { policy: "require-corp" },
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: false,
  referrerPolicy: { policy: "no-referrer" },
  xssFilter: true,
});

// CORS configuration for production
export const corsConfig = {
  origin: function (origin: string | undefined, callback: Function) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://localhost:3000',
      'https://localhost:3001'
    ];
    
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'X-CSRF-Token'
  ],
  exposedHeaders: [
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset'
  ],
  maxAge: 86400, // 24 hours
};

// HTTP Parameter Pollution protection
export const hppProtection = hpp({
  whitelist: ['tags', 'filter'] // Allow arrays for these parameters if needed
});

// Request sanitization against NoSQL injection
export const mongoSanitization = mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key }: { req: Request, key: string }) => {
    console.warn(`Sanitized NoSQL injection attempt: ${key} from ${req.ip}`);
  }
});

// Compression middleware with security considerations
export const compressionConfig = compression({
  filter: (req: Request, res: Response) => {
    // Don't compress responses with this header
    if (req.headers['x-no-compression']) {
      return false;
    }
    
    // Fallback to standard filter function
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024, // Only compress responses larger than 1KB
});

// Custom security headers middleware
export const customSecurityHeaders = (req: Request, res: Response, next: NextFunction) => {
  // Remove server information
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  
  // Add custom security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Cache control for sensitive endpoints
  if (req.path.includes('/auth') || req.path.includes('/balances')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  
  next();
};

// Request logging middleware with security focus
export const securityLogging = (req: Request, res: Response, next: NextFunction) => {
  const startTime = Date.now();
  const originalSend = res.send;
  
  // Override res.send to log response
  res.send = function(this: Response, body?: any) {
    const duration = Date.now() - startTime;
    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      statusCode: res.statusCode,
      duration: duration,
      contentLength: body ? Buffer.byteLength(body, 'utf8') : 0,
      suspicious: false
    };
    
    // Flag suspicious requests
    if (
      req.path.includes('..') ||
      req.path.includes('<script>') ||
      req.headers['user-agent']?.includes('sqlmap') ||
      req.headers['user-agent']?.includes('nmap') ||
      duration > 30000 || // Very slow requests
      res.statusCode === 429 // Rate limited
    ) {
      logData.suspicious = true;
      console.warn('Suspicious request detected:', logData);
    }
    
    // Log errors
    if (res.statusCode >= 400) {
      console.error('Error response:', logData);
    } else if (process.env.NODE_ENV === 'development') {
      console.log('Request:', logData);
    }
    
    return originalSend.call(this, body);
  };
  
  next();
};

// IP whitelist/blacklist middleware
export const ipFilter = (req: Request, res: Response, next: NextFunction): any => {
  const clientIp = req.ip || req.connection.remoteAddress;
  
  if (!clientIp) {
    return res.status(400).json({ error: 'Unable to determine client IP' });
  }
  
  // Check IP blacklist (could be stored in Redis)
  const blacklistedIPs = process.env.BLACKLISTED_IPS?.split(',') || [];
  if (blacklistedIPs.includes(clientIp)) {
    console.warn(`Blocked request from blacklisted IP: ${clientIp}`);
    return res.status(403).json({ error: 'Access denied' });
  }
  
  // Optional: Check IP whitelist for admin endpoints
  if (req.path.includes('/admin')) {
    const whitelistedIPs = process.env.ADMIN_WHITELISTED_IPS?.split(',') || [];
    if (whitelistedIPs.length > 0 && !whitelistedIPs.includes(clientIp)) {
      console.warn(`Blocked admin access from non-whitelisted IP: ${clientIp}`);
      return res.status(403).json({ error: 'Admin access denied' });
    }
  }
  
  next();
};

// Content length validation middleware
export const contentLengthValidator = (maxSize: number = 10 * 1024 * 1024) => { // 10MB default
  return (req: Request, res: Response, next: NextFunction): any => {
    const contentLength = req.get('content-length');
    
    if (contentLength && parseInt(contentLength, 10) > maxSize) {
      return res.status(413).json({
        error: 'Request entity too large',
        maxSize: maxSize,
        receivedSize: parseInt(contentLength, 10)
      });
    }
    
    next();
  };
};

// WebSocket security headers
export const websocketSecurityHeaders = (req: Request) => {
  const headers: Record<string, string> = {};
  
  // Basic security headers for WebSocket upgrade
  headers['Sec-WebSocket-Protocol'] = 'web3-chat-protocol';
  headers['X-Content-Type-Options'] = 'nosniff';
  headers['X-Frame-Options'] = 'DENY';
  
  return headers;
};

// Error handling with security considerations
export const securityErrorHandler = (error: Error, req: Request, res: Response, next: NextFunction): any => {
  // Log error details for monitoring
  console.error('Security error:', {
    error: error.message,
    stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  
  // Don't expose sensitive error information in production
  if (process.env.NODE_ENV === 'production') {
    return res.status(500).json({
      error: 'Internal server error',
      timestamp: Date.now(),
      requestId: req.get('X-Request-ID') || 'unknown'
    });
  }
  
  // Development error response with more details
  res.status(500).json({
    error: error.message,
    stack: error.stack,
    timestamp: Date.now(),
    path: req.path,
    method: req.method
  });
};