import crypto from 'crypto';
import { redisClient } from '../utils/redis';

interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  totalKeys: number;
  memoryUsage: string;
}

interface CacheOptions {
  ttl?: number;
  compress?: boolean;
  tags?: string[];
}

export class CacheManager {
  private cacheHits = 0;
  private cacheMisses = 0;
  private readonly DEFAULT_TTL = 300; // 5 minutes
  private readonly MAX_KEY_LENGTH = 250; // Redis key limit

  async initialize(): Promise<void> {
    console.log('Initializing cache manager');
    
    // Start cache cleanup interval
    setInterval(() => this.cleanupExpiredKeys(), 600000); // Every 10 minutes
    
    // Start cache statistics reporting
    setInterval(async () => await this.reportCacheStats(), 300000); // Every 5 minutes
  }

  /**
   * Generate cache key from query and parameters
   */
  generateCacheKey(query: string, params?: any[]): string {
    const normalizedQuery = this.normalizeQuery(query);
    const paramsHash = params ? crypto.createHash('md5').update(JSON.stringify(params)).digest('hex') : '';
    const key = `query:${crypto.createHash('md5').update(normalizedQuery).digest('hex')}:${paramsHash}`;
    
    return key.length > this.MAX_KEY_LENGTH 
      ? `query:${crypto.createHash('sha256').update(key).digest('hex').substring(0, 40)}`
      : key;
  }

  /**
   * Get cached query result
   */
  async get(query: string, params?: any[]): Promise<any | null> {
    try {
      const key = this.generateCacheKey(query, params);
      const cached = await redisClient.get(key);
      
      if (cached) {
        this.cacheHits++;
        const parsed = JSON.parse(cached);
        
        // Check if result has expired based on custom logic
        if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
          await redisClient.del(key);
          this.cacheMisses++;
          return null;
        }
        
        return parsed.data;
      } else {
        this.cacheMisses++;
        return null;
      }
    } catch (error) {
      console.error('Cache get error:', error);
      this.cacheMisses++;
      return null;
    }
  }

  /**
   * Set cached query result
   */
  async set(query: string, data: any, ttl?: number, params?: any[], options?: CacheOptions): Promise<void> {
    try {
      const key = this.generateCacheKey(query, params);
      const cacheTtl = ttl || options?.ttl || this.DEFAULT_TTL;
      
      const cacheData = {
        data,
        cachedAt: Date.now(),
        expiresAt: Date.now() + (cacheTtl * 1000),
        tags: options?.tags || []
      };

      // Compress large data if enabled
      let serialized = JSON.stringify(cacheData);
      if (options?.compress && serialized.length > 1024) {
        // In production, you might want to use actual compression
        console.log(`Large cache entry (${serialized.length} bytes) for key: ${key.substring(0, 50)}...`);
      }

      await redisClient.setEx(key, cacheTtl, serialized);
      
      // Store tags for cache invalidation
      if (options?.tags && options.tags.length > 0) {
        for (const tag of options.tags) {
          await redisClient.sAdd(`cache:tag:${tag}`, key);
          await redisClient.expire(`cache:tag:${tag}`, cacheTtl + 60); // Slightly longer TTL for tags
        }
      }
      
    } catch (error) {
      console.error('Cache set error:', error);
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    let invalidatedCount = 0;
    
    try {
      for (const tag of tags) {
        const tagKey = `cache:tag:${tag}`;
        const keys = await redisClient.sMembers(tagKey);
        
        if (keys.length > 0) {
          const pipeline = redisClient.multi();
          keys.forEach(key => pipeline.del(key));
          await pipeline.exec();
          invalidatedCount += keys.length;
        }
        
        // Clean up the tag set
        await redisClient.del(tagKey);
      }
      
      console.log(`Invalidated ${invalidatedCount} cache entries for tags: ${tags.join(', ')}`);
    } catch (error) {
      console.error('Cache invalidation error:', error);
    }
    
    return invalidatedCount;
  }

  /**
   * Invalidate specific cache entry
   */
  async invalidate(query: string, params?: any[]): Promise<boolean> {
    try {
      const key = this.generateCacheKey(query, params);
      const result = await redisClient.del(key);
      return result > 0;
    } catch (error) {
      console.error('Cache invalidation error:', error);
      return false;
    }
  }

  /**
   * Clear all cache entries
   */
  async clear(): Promise<void> {
    try {
      const keys = await redisClient.keys('query:*');
      if (keys.length > 0) {
        await redisClient.del(keys);
        console.log(`Cleared ${keys.length} cache entries`);
      }
    } catch (error) {
      console.error('Cache clear error:', error);
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<CacheStats> {
    try {
      const keys = await redisClient.keys('query:*');
      const totalRequests = this.cacheHits + this.cacheMisses;
      const hitRate = totalRequests > 0 ? (this.cacheHits / totalRequests) * 100 : 0;
      
      // Get memory usage (approximation)
      const info = await redisClient.info('memory');
      const memoryMatch = info.match(/used_memory_human:(.+)/);
      const memoryUsage = memoryMatch ? memoryMatch[1].trim() : 'Unknown';
      
      return {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: Number(hitRate.toFixed(2)),
        totalKeys: keys.length,
        memoryUsage
      };
    } catch (error) {
      console.error('Error getting cache stats:', error);
      return {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: 0,
        totalKeys: 0,
        memoryUsage: 'Error'
      };
    }
  }

  /**
   * Cached user lookup
   */
  async getCachedUser(walletAddress: string): Promise<any | null> {
    const key = `user:${walletAddress.toLowerCase()}`;
    
    try {
      const cached = await redisClient.get(key);
      if (cached) {
        this.cacheHits++;
        return JSON.parse(cached);
      } else {
        this.cacheMisses++;
        return null;
      }
    } catch (error) {
      console.error('Cached user lookup error:', error);
      this.cacheMisses++;
      return null;
    }
  }

  /**
   * Cache user data
   */
  async setCachedUser(walletAddress: string, userData: any, ttl: number = 600): Promise<void> {
    const key = `user:${walletAddress.toLowerCase()}`;
    
    try {
      await redisClient.setEx(key, ttl, JSON.stringify({
        ...userData,
        cachedAt: Date.now()
      }));
    } catch (error) {
      console.error('Cache user error:', error);
    }
  }

  /**
   * Cached session lookup
   */
  async getCachedSession(sessionId: string): Promise<any | null> {
    const key = `session:${sessionId}`;
    
    try {
      const cached = await redisClient.get(key);
      if (cached) {
        this.cacheHits++;
        return JSON.parse(cached);
      } else {
        this.cacheMisses++;
        return null;
      }
    } catch (error) {
      console.error('Cached session lookup error:', error);
      this.cacheMisses++;
      return null;
    }
  }

  /**
   * Cache session data
   */
  async setCachedSession(sessionId: string, sessionData: any, ttl: number = 3600): Promise<void> {
    const key = `session:${sessionId}`;
    
    try {
      await redisClient.setEx(key, ttl, JSON.stringify({
        ...sessionData,
        cachedAt: Date.now()
      }));
    } catch (error) {
      console.error('Cache session error:', error);
    }
  }

  /**
   * Cached balance lookup
   */
  async getCachedBalance(address: string, chainId: number): Promise<any | null> {
    const key = `balance:${address.toLowerCase()}:${chainId}`;
    
    try {
      const cached = await redisClient.get(key);
      if (cached) {
        this.cacheHits++;
        const data = JSON.parse(cached);
        
        // Check if balance cache is still fresh (30 seconds for balances)
        if (Date.now() - data.cachedAt < 30000) {
          return data;
        } else {
          await redisClient.del(key);
          this.cacheMisses++;
          return null;
        }
      } else {
        this.cacheMisses++;
        return null;
      }
    } catch (error) {
      console.error('Cached balance lookup error:', error);
      this.cacheMisses++;
      return null;
    }
  }

  /**
   * Cache balance data
   */
  async setCachedBalance(address: string, chainId: number, balanceData: any, ttl: number = 30): Promise<void> {
    const key = `balance:${address.toLowerCase()}:${chainId}`;
    
    try {
      await redisClient.setEx(key, ttl, JSON.stringify({
        ...balanceData,
        cachedAt: Date.now()
      }));
    } catch (error) {
      console.error('Cache balance error:', error);
    }
  }

  /**
   * Rate limiting cache
   */
  async checkRateLimit(identifier: string, limit: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const key = `rate_limit:${identifier}`;
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const windowKey = `${key}:${window}`;
    
    try {
      const current = await redisClient.get(windowKey);
      const count = current ? parseInt(current) : 0;
      
      if (count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          resetTime: (window + 1) * windowMs
        };
      }
      
      // Increment counter
      const pipeline = redisClient.multi();
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
      // On error, allow the request
      return { allowed: true, remaining: limit - 1, resetTime: now + windowMs };
    }
  }

  private normalizeQuery(query: string): string {
    return query
      .replace(/\s+/g, ' ')
      .replace(/\$\d+/g, '?')
      .trim()
      .toLowerCase();
  }

  private async cleanupExpiredKeys(): Promise<void> {
    try {
      // Clean up expired tag sets
      const tagKeys = await redisClient.keys('cache:tag:*');
      let cleanedTags = 0;
      
      for (const tagKey of tagKeys) {
        const ttl = await redisClient.ttl(tagKey);
        if (ttl === -2) { // Key doesn't exist
          cleanedTags++;
        } else if (ttl === -1) { // Key exists but has no expiry
          await redisClient.expire(tagKey, 3600); // Set 1 hour expiry
        }
      }
      
      if (cleanedTags > 0) {
        console.log(`Cleaned up ${cleanedTags} expired cache tag sets`);
      }
    } catch (error) {
      console.error('Cache cleanup error:', error);
    }
  }

  private async reportCacheStats(): Promise<void> {
    try {
      const stats = await this.getStats();
      
      if (stats.hitRate < 70 && (this.cacheHits + this.cacheMisses) > 100) {
        console.warn('Low cache hit rate detected:', {
          hitRate: `${stats.hitRate}%`,
          totalKeys: stats.totalKeys,
          memoryUsage: stats.memoryUsage
        });
      }
      
      // Reset counters daily
      const now = new Date();
      if (now.getHours() === 0 && now.getMinutes() < 5) {
        this.cacheHits = 0;
        this.cacheMisses = 0;
        console.log('Cache statistics reset for new day');
      }
      
    } catch (error) {
      console.error('Error reporting cache stats:', error);
    }
  }
}
