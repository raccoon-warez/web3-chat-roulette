import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import { redisClient } from '../utils/redis';
import { Request, Response } from 'express';

// General API rate limiter - per IP
export const generalRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: 15 * 60 // 15 minutes in seconds
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use Redis for distributed rate limiting
  store: {
    increment: async (key: string) => {
      const current = await redisClient.incr(`rate_limit:general:${key}`);
      if (current === 1) {
        await redisClient.expire(`rate_limit:general:${key}`, 15 * 60); // 15 minutes
      }
      return { totalHits: current, resetTime: new Date(Date.now() + 15 * 60 * 1000) };
    },
    decrement: async (key: string) => {
      await redisClient.decr(`rate_limit:general:${key}`);
    },
    resetKey: async (key: string) => {
      await redisClient.del(`rate_limit:general:${key}`);
    }
  }
});

// Authentication specific rate limiter - stricter for auth endpoints
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 auth requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // Don't count successful requests
  store: {
    increment: async (key: string) => {
      const current = await redisClient.incr(`rate_limit:auth:${key}`);
      if (current === 1) {
        await redisClient.expire(`rate_limit:auth:${key}`, 15 * 60);
      }
      return { totalHits: current, resetTime: new Date(Date.now() + 15 * 60 * 1000) };
    },
    decrement: async (key: string) => {
      await redisClient.decr(`rate_limit:auth:${key}`);
    },
    resetKey: async (key: string) => {
      await redisClient.del(`rate_limit:auth:${key}`);
    }
  }
});

// Per-wallet rate limiter
export const createWalletRateLimit = (maxRequests: number = 20, windowMinutes: number = 15) => {
  return async (req: Request & { user?: { address: string } }, res: Response, next: Function) => {
    const wallet = req.body?.address || req.user?.address;
    
    if (!wallet) {
      return next();
    }

    const key = `rate_limit:wallet:${wallet}`;
    const windowMs = windowMinutes * 60 * 1000;
    
    try {
      const current = await redisClient.incr(key);
      if (current === 1) {
        await redisClient.expire(key, windowMinutes * 60);
      }
      
      if (current > maxRequests) {
        return res.status(429).json({
          error: 'Too many requests from this wallet address',
          retryAfter: windowMinutes * 60
        });
      }
      
      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests.toString(),
        'X-RateLimit-Remaining': Math.max(0, maxRequests - current).toString(),
        'X-RateLimit-Reset': new Date(Date.now() + windowMs).toISOString()
      });
      
      next();
    } catch (error) {
      console.error('Wallet rate limit error:', error);
      next(); // Don't block on Redis errors
    }
  };
};

// Speed limiter - gradually slow down responses for rapid requests
export const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 20, // Allow 20 requests at full speed
  delayMs: 500, // Add 500ms delay per request after delayAfter
  maxDelayMs: 20000, // Max delay of 20 seconds
  headers: false
});

// Custom brute force protection for authentication endpoints
export const authBruteForce = {
  prevent: async (req: Request, res: Response, next: Function): Promise<any> => {
    const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `auth_attempts:${clientIp}`;
    
    try {
      const attempts = await redisClient.get(key);
      const attemptCount = attempts ? parseInt(attempts, 10) : 0;
      
      if (attemptCount >= 5) { // Max 5 failed attempts
        const ttl = await redisClient.ttl(key);
        return res.status(429).json({
          error: 'Too many failed authentication attempts',
          retryAfter: ttl > 0 ? ttl : 300 // Default 5 minutes
        });
      }
      
      // Store original response end to track failures
      const originalSend = res.send;
      res.send = function(body: any) {
        // Track failed authentication attempts
        if (res.statusCode === 400 || res.statusCode === 401) {
          redisClient.incr(key).then(count => {
            if (count === 1) {
              redisClient.expire(key, 15 * 60); // 15 minutes lockout
            }
          }).catch(console.error);
        }
        
        return originalSend.call(this, body);
      };
      
      next();
    } catch (error) {
      console.error('Auth brute force protection error:', error);
      next(); // Fail open on Redis errors
    }
  }
};

// WebSocket connection rate limiter
export const wsConnectionRateLimit = async (clientIp: string): Promise<boolean> => {
  const key = `ws_rate_limit:${clientIp}`;
  const maxConnections = 5; // Max 5 WebSocket connections per minute
  const windowSeconds = 60;
  
  try {
    const current = await redisClient.incr(key);
    if (current === 1) {
      await redisClient.expire(key, windowSeconds);
    }
    
    return current <= maxConnections;
  } catch (error) {
    console.error('WebSocket rate limit error:', error);
    return true; // Fail open
  }
};

// Report submission rate limiter
export const reportRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Max 10 reports per hour per IP
  message: {
    error: 'Too many reports submitted, please try again later.',
    retryAfter: 60 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  store: {
    increment: async (key: string) => {
      const current = await redisClient.incr(`rate_limit:reports:${key}`);
      if (current === 1) {
        await redisClient.expire(`rate_limit:reports:${key}`, 60 * 60);
      }
      return { totalHits: current, resetTime: new Date(Date.now() + 60 * 60 * 1000) };
    },
    decrement: async (key: string) => {
      await redisClient.decr(`rate_limit:reports:${key}`);
    },
    resetKey: async (key: string) => {
      await redisClient.del(`rate_limit:reports:${key}`);
    }
  }
});