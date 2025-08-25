import { createClient, RedisClientType } from 'redis';

// Enhanced Redis client configuration
const redisClient: RedisClientType = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // Connection settings optimized for performance
  socket: {
    keepAlive: true,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error('Redis connection failed after 10 retries');
        return false; // Stop reconnecting
      }
      return Math.min(retries * 100, 3000); // Exponential backoff, max 3 seconds
    },
    connectTimeout: 5000
  },
  
  // Compression and serialization
  legacyMode: false,
  
  // Error handling
  retry_unfulfilled_commands: true,
});

// Enhanced connection event handlers
redisClient.on('connect', () => {
  console.log('Redis client connected');
});

redisClient.on('ready', () => {
  console.log('Redis client ready');
});

redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('end', () => {
  console.log('Redis client connection ended');
});

redisClient.on('reconnecting', () => {
  console.log('Redis client reconnecting...');
});

// Connection statistics
let connectionStats = {
  commands: 0,
  errors: 0,
  lastConnected: null as Date | null,
  totalReconnects: 0,
  isConnected: false,
  errorRate: 0
};

// Enhanced Redis operations with error handling and retries
class RedisManager {
  private client: RedisClientType;
  
  constructor(client: RedisClientType) {
    this.client = client;
  }

  /**
   * Get value with automatic retry on failure
   */
  async get(key: string, retries: number = 2): Promise<string | null> {
    try {
      connectionStats.commands++;
      const result = await this.client.get(key);
      return result;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis GET error for key ${key}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.get(key, retries - 1);
      }
      return null;
    }
  }

  /**
   * Set value with TTL and compression for large values
   */
  async setEx(key: string, seconds: number, value: string, retries: number = 2): Promise<boolean> {
    try {
      connectionStats.commands++;
      
      // Compress large values
      let finalValue = value;
      if (value.length > 1024) {
        // In production, implement actual compression
        console.log(`Large Redis value for key ${key}: ${value.length} bytes`);
      }
      
      await this.client.setEx(key, seconds, finalValue);
      return true;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis SETEX error for key ${key}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.setEx(key, seconds, value, retries - 1);
      }
      return false;
    }
  }

  /**
   * Set value without TTL
   */
  async set(key: string, value: string, retries: number = 2): Promise<boolean> {
    try {
      connectionStats.commands++;
      await this.client.set(key, value);
      return true;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis SET error for key ${key}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.set(key, value, retries - 1);
      }
      return false;
    }
  }

  /**
   * Delete key(s)
   */
  async del(keys: string | string[], retries: number = 2): Promise<number> {
    try {
      connectionStats.commands++;
      const result = await this.client.del(keys);
      return result;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis DEL error:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.del(keys, retries - 1);
      }
      return 0;
    }
  }

  /**
   * Increment value
   */
  async incr(key: string, retries: number = 2): Promise<number> {
    try {
      connectionStats.commands++;
      const result = await this.client.incr(key);
      return result;
    } catch (error: any) {
      connectionStats.errors++;
      console.error(`Redis INCR error for key ${key}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.incr(key, retries - 1);
      }
      return 0;
    }
  }

  /**
   * Decrement value
   */
  async decr(key: string, retries: number = 2): Promise<number> {
    try {
      connectionStats.commands++;
      const result = await this.client.decr(key);
      return result;
    } catch (error: any) {
      connectionStats.errors++;
      console.error(`Redis DECR error for key ${key}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.decr(key, retries - 1);
      }
      return 0;
    }
  }

  /**
   * Set expiration
   */
  async expire(key: string, seconds: number, retries: number = 2): Promise<boolean> {
    try {
      connectionStats.commands++;
      const result = await this.client.expire(key, seconds);
      return result;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis EXPIRE error for key ${key}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.expire(key, seconds, retries - 1);
      }
      return false;
    }
  }

  /**
   * Get TTL
   */
  async ttl(key: string, retries: number = 2): Promise<number> {
    try {
      connectionStats.commands++;
      const result = await this.client.ttl(key);
      return result;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis TTL error for key ${key}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.ttl(key, retries - 1);
      }
      return -2; // Key doesn't exist
    }
  }

  /**
   * Get keys by pattern
   */
  async keys(pattern: string, retries: number = 2): Promise<string[]> {
    try {
      connectionStats.commands++;
      const result = await this.client.keys(pattern);
      return result;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis KEYS error for pattern ${pattern}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.keys(pattern, retries - 1);
      }
      return [];
    }
  }

  /**
   * Add to set
   */
  async sAdd(key: string, members: string | string[], retries: number = 2): Promise<number> {
    try {
      connectionStats.commands++;
      const result = await this.client.sAdd(key, members);
      return result;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis SADD error for key ${key}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.sAdd(key, members, retries - 1);
      }
      return 0;
    }
  }

  /**
   * Remove from set
   */
  async sRem(key: string, members: string | string[], retries: number = 2): Promise<number> {
    try {
      connectionStats.commands++;
      const result = await this.client.sRem(key, members);
      return result;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis SREM error for key ${key}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.sRem(key, members, retries - 1);
      }
      return 0;
    }
  }

  /**
   * Get set members
   */
  async sMembers(key: string, retries: number = 2): Promise<string[]> {
    try {
      connectionStats.commands++;
      const result = await this.client.sMembers(key);
      return result;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis SMEMBERS error for key ${key}:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.sMembers(key, retries - 1);
      }
      return [];
    }
  }

  /**
   * Get Redis info
   */
  async info(section?: string, retries: number = 2): Promise<string> {
    try {
      connectionStats.commands++;
      const result = await this.client.info(section);
      return result;
    } catch (error) {
      connectionStats.errors++;
      console.error(`Redis INFO error:`, error.message);
      
      if (retries > 0 && this.shouldRetry(error)) {
        await this.delay(100);
        return this.info(section, retries - 1);
      }
      return '';
    }
  }

  /**
   * Create multi/pipeline
   */
  multi() {
    return this.client.multi();
  }

  /**
   * Get connection statistics
   */
  getStats() {
    const errorRate = connectionStats.commands > 0 
      ? (connectionStats.errors / connectionStats.commands) * 100 
      : 0;

    return {
      ...connectionStats,
      errorRate: Number(errorRate.toFixed(2)),
      isConnected: this.client.isReady
    };
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{ status: string; latency?: number; error?: string }> {
    try {
      const start = Date.now();
      await this.client.ping();
      const latency = Date.now() - start;
      
      return {
        status: 'healthy',
        latency
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  private shouldRetry(error: any): boolean {
    // Retry on connection errors, not on data errors
    const retryableErrors = [
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EPIPE',
      'Connection is closed'
    ];
    
    return retryableErrors.some(retryableError => 
      error.message.includes(retryableError)
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Create enhanced Redis manager
const redisManager = new RedisManager(redisClient);

// Initialize Redis connection with enhanced features
const initializeRedis = async (): Promise<void> => {
  try {
    await redisClient.connect();
    connectionStats.lastConnected = new Date();
    console.log('Connected to Redis with enhanced features');
    
    // Set up connection monitoring
    setInterval(async () => {
      const health = await redisManager.healthCheck();
      if (health.status === 'unhealthy') {
        console.warn('Redis health check failed:', health.error);
      }
    }, 30000); // Check every 30 seconds
    
    // Log statistics periodically
    setInterval(() => {
      const stats = redisManager.getStats();
      if (stats.errorRate > 5) {
        console.warn('High Redis error rate:', {
          errorRate: `${stats.errorRate}%`,
          totalCommands: stats.commands,
          totalErrors: stats.errors
        });
      }
    }, 300000); // Every 5 minutes
    
  } catch (error) {
    console.error('Error connecting to Redis:', error);
    throw error;
  }
};

// Rate limiting helper
const rateLimitCheck = async (
  identifier: string, 
  limit: number, 
  windowMs: number
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> => {
  const key = `rate_limit:${identifier}`;
  const now = Date.now();
  const window = Math.floor(now / windowMs);
  const windowKey = `${key}:${window}`;
  
  try {
    const current = await redisManager.get(windowKey);
    const count = current ? parseInt(current) : 0;
    
    if (count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: (window + 1) * windowMs
      };
    }
    
    // Increment counter with pipeline
    const pipeline = redisManager.multi();
    pipeline.incr(windowKey);
    pipeline.expire(windowKey, Math.ceil(windowMs / 1000));
    await pipeline.exec();
    
    return {
      allowed: true,
      remaining: limit - count - 1,
      resetTime: (window + 1) * windowMs
    };
  } catch (error) {
    console.error('Rate limit check error:', error);
    // On error, allow the request (fail open)
    return { allowed: true, remaining: limit - 1, resetTime: now + windowMs };
  }
};

// Session management helpers
const sessionHelpers = {
  async storeSession(sessionId: string, data: any, ttl: number = 3600): Promise<boolean> {
    return redisManager.setEx(`session:${sessionId}`, ttl, JSON.stringify(data));
  },
  
  async getSession(sessionId: string): Promise<any | null> {
    const data = await redisManager.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  },
  
  async deleteSession(sessionId: string): Promise<boolean> {
    const result = await redisManager.del(`session:${sessionId}`);
    return result > 0;
  },
  
  async extendSession(sessionId: string, ttl: number = 3600): Promise<boolean> {
    return redisManager.expire(`session:${sessionId}`, ttl);
  }
};

// Export enhanced Redis client and utilities
export { 
  redisManager as redisClient, // Use enhanced manager instead of raw client
  initializeRedis,
  rateLimitCheck,
  sessionHelpers,
  connectionStats
};

// Backward compatibility - export raw client as well
export const rawRedisClient = redisClient;
