'use client'

// Browser storage utilities with compression and expiration
class StorageManager {
  private prefix: string

  constructor(prefix: string = 'web3-chat-') {
    this.prefix = prefix
  }

  // Compress data for storage
  private compress(data: any): string {
    return JSON.stringify(data)
  }

  // Decompress data from storage
  private decompress(data: string): any {
    try {
      return JSON.parse(data)
    } catch {
      return null
    }
  }

  // Set item with expiration
  setItem(key: string, value: any, ttlMinutes?: number): void {
    try {
      const item = {
        value: value,
        timestamp: Date.now(),
        ttl: ttlMinutes ? ttlMinutes * 60 * 1000 : null,
      }
      
      const compressed = this.compress(item)
      localStorage.setItem(this.prefix + key, compressed)
    } catch (error) {
      console.warn('Failed to set cache item:', error)
    }
  }

  // Get item with expiration check
  getItem<T>(key: string): T | null {
    try {
      const compressed = localStorage.getItem(this.prefix + key)
      if (!compressed) return null

      const item = this.decompress(compressed)
      if (!item) return null

      // Check expiration
      if (item.ttl && Date.now() - item.timestamp > item.ttl) {
        this.removeItem(key)
        return null
      }

      return item.value
    } catch (error) {
      console.warn('Failed to get cache item:', error)
      return null
    }
  }

  // Remove item
  removeItem(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key)
    } catch (error) {
      console.warn('Failed to remove cache item:', error)
    }
  }

  // Clear all items with prefix
  clear(): void {
    try {
      const keys = Object.keys(localStorage).filter(key => key.startsWith(this.prefix))
      keys.forEach(key => localStorage.removeItem(key))
    } catch (error) {
      console.warn('Failed to clear cache:', error)
    }
  }

  // Get storage size
  getSize(): number {
    let size = 0
    try {
      for (const key in localStorage) {
        if (key.startsWith(this.prefix)) {
          size += localStorage[key].length
        }
      }
    } catch (error) {
      console.warn('Failed to calculate cache size:', error)
    }
    return size
  }

  // Clean expired items
  cleanExpired(): void {
    try {
      const keys = Object.keys(localStorage).filter(key => key.startsWith(this.prefix))
      keys.forEach(fullKey => {
        const key = fullKey.replace(this.prefix, '')
        this.getItem(key) // This will automatically remove expired items
      })
    } catch (error) {
      console.warn('Failed to clean expired cache items:', error)
    }
  }
}

// Memory cache for runtime performance
class MemoryCache {
  private cache = new Map<string, { value: any; timestamp: number; ttl: number | null }>()
  private maxSize: number

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize
  }

  set(key: string, value: any, ttlMinutes?: number): void {
    // Implement LRU eviction
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }

    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttl: ttlMinutes ? ttlMinutes * 60 * 1000 : null,
    })
  }

  get<T>(key: string): T | null {
    const item = this.cache.get(key)
    if (!item) return null

    // Check expiration
    if (item.ttl && Date.now() - item.timestamp > item.ttl) {
      this.cache.delete(key)
      return null
    }

    // Move to end (LRU)
    this.cache.delete(key)
    this.cache.set(key, item)

    return item.value
  }

  delete(key: string): void {
    this.cache.delete(key)
  }

  clear(): void {
    this.cache.clear()
  }

  size(): number {
    return this.cache.size
  }
}

// Service Worker cache utilities (if available)
class ServiceWorkerCache {
  private cacheName: string

  constructor(cacheName: string = 'web3-chat-cache-v1') {
    this.cacheName = cacheName
  }

  async isSupported(): Promise<boolean> {
    return 'serviceWorker' in navigator && 'caches' in window
  }

  async cacheResources(urls: string[]): Promise<void> {
    if (!(await this.isSupported())) return

    try {
      const cache = await caches.open(this.cacheName)
      await cache.addAll(urls)
    } catch (error) {
      console.warn('Failed to cache resources:', error)
    }
  }

  async getCachedResponse(url: string): Promise<Response | null> {
    if (!(await this.isSupported())) return null

    try {
      const cache = await caches.open(this.cacheName)
      return await cache.match(url) || null
    } catch (error) {
      console.warn('Failed to get cached response:', error)
      return null
    }
  }

  async clearCache(): Promise<void> {
    if (!(await this.isSupported())) return

    try {
      await caches.delete(this.cacheName)
    } catch (error) {
      console.warn('Failed to clear service worker cache:', error)
    }
  }
}

// Main cache manager
export class CacheManager {
  public storage: StorageManager
  public memory: MemoryCache
  public serviceWorker: ServiceWorkerCache

  constructor() {
    this.storage = new StorageManager()
    this.memory = new MemoryCache()
    this.serviceWorker = new ServiceWorkerCache()

    // Clean expired items on startup
    if (typeof window !== 'undefined') {
      this.storage.cleanExpired()
      
      // Set up periodic cleanup
      setInterval(() => {
        this.storage.cleanExpired()
      }, 60 * 60 * 1000) // Every hour
    }
  }

  // Multi-tier cache get (memory -> storage -> network)
  async get<T>(key: string): Promise<T | null> {
    // Try memory cache first
    let value = this.memory.get<T>(key)
    if (value !== null) return value

    // Try storage cache
    value = this.storage.getItem<T>(key)
    if (value !== null) {
      // Promote to memory cache
      this.memory.set(key, value, 5) // 5 minute memory cache
      return value
    }

    return null
  }

  // Multi-tier cache set
  set(key: string, value: any, options: { 
    memoryTtl?: number
    storageTtl?: number 
  } = {}): void {
    const { memoryTtl = 5, storageTtl = 60 } = options
    
    this.memory.set(key, value, memoryTtl)
    this.storage.setItem(key, value, storageTtl)
  }

  // Remove from all caches
  delete(key: string): void {
    this.memory.delete(key)
    this.storage.removeItem(key)
  }

  // Clear all caches
  clear(): void {
    this.memory.clear()
    this.storage.clear()
  }

  // Get cache statistics
  getStats() {
    return {
      memorySize: this.memory.size(),
      storageSize: this.storage.getSize(),
    }
  }
}

// Global cache instance
export const cacheManager = new CacheManager()

// Cache key generators
export const cacheKeys = {
  userBalance: (address: string) => `balance-${address}`,
  blockData: (blockNumber: number) => `block-${blockNumber}`,
  webrtcConfig: () => 'webrtc-config',
  userProfile: (address: string) => `profile-${address}`,
  chatSession: (sessionId: string) => `session-${sessionId}`,
}

// React hook for cached data
export function useCachedData<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: {
    ttl?: number
    enabled?: boolean
    onSuccess?: (data: T) => void
    onError?: (error: Error) => void
  } = {}
) {
  const { ttl = 5, enabled = true, onSuccess, onError } = options

  const getCachedData = async (): Promise<T | null> => {
    if (!enabled) return null

    try {
      // Try cache first
      const cached = await cacheManager.get<T>(key)
      if (cached !== null) {
        onSuccess?.(cached)
        return cached
      }

      // Fetch fresh data
      const fresh = await fetcher()
      cacheManager.set(key, fresh, { storageTtl: ttl })
      onSuccess?.(fresh)
      return fresh
    } catch (error) {
      onError?.(error as Error)
      throw error
    }
  }

  return { getCachedData, invalidate: () => cacheManager.delete(key) }
}

// Prefetch utility
export function prefetchData<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 5
): Promise<T> {
  return cacheManager.get<T>(key).then(cached => {
    if (cached !== null) return cached

    return fetcher().then(fresh => {
      cacheManager.set(key, fresh, { storageTtl: ttl })
      return fresh
    })
  })
}

// Advanced caching strategies
export class AdvancedCacheManager extends CacheManager {
  private networkFirst = new Map<string, Promise<any>>()
  private cacheFirst = new Map<string, Promise<any>>()
  private staleWhileRevalidate = new Map<string, Promise<any>>()

  // Network-first strategy: Try network, fall back to cache
  async networkFirst<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: { timeout?: number; fallbackTtl?: number } = {}
  ): Promise<T> {
    const { timeout = 5000, fallbackTtl = 60 } = options

    // Return existing network request if in progress
    if (this.networkFirst.has(key)) {
      return this.networkFirst.get(key)!
    }

    const networkPromise = Promise.race([
      fetcher(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Network timeout')), timeout)
      )
    ])

    this.networkFirst.set(key, networkPromise)

    try {
      const data = await networkPromise
      this.set(key, data, { storageTtl: fallbackTtl })
      this.networkFirst.delete(key)
      return data
    } catch (error) {
      this.networkFirst.delete(key)
      
      // Fall back to cache
      const cached = await this.get<T>(key)
      if (cached !== null) {
        return cached
      }
      
      throw error
    }
  }

  // Cache-first strategy: Try cache, update in background
  async cacheFirst<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: { backgroundUpdate?: boolean; ttl?: number } = {}
  ): Promise<T> {
    const { backgroundUpdate = true, ttl = 60 } = options

    // Try cache first
    const cached = await this.get<T>(key)
    if (cached !== null) {
      // Update in background if enabled
      if (backgroundUpdate && !this.cacheFirst.has(key)) {
        const updatePromise = fetcher().then(fresh => {
          this.set(key, fresh, { storageTtl: ttl })
          return fresh
        }).catch(() => {
          // Silently fail background updates
        }).finally(() => {
          this.cacheFirst.delete(key)
        })
        
        this.cacheFirst.set(key, updatePromise)
      }
      
      return cached
    }

    // Cache miss - fetch and cache
    const data = await fetcher()
    this.set(key, data, { storageTtl: ttl })
    return data
  }

  // Stale-while-revalidate strategy
  async staleWhileRevalidate<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: { staleTtl?: number; maxAge?: number } = {}
  ): Promise<T> {
    const { staleTtl = 300, maxAge = 3600 } = options // 5 min stale, 1 hour max

    const cached = await this.get<T>(key)
    const now = Date.now()

    // Check if we have cached data and its age
    if (cached !== null) {
      const cacheTimestamp = this.storage.getItem(`${key}-timestamp`) as number
      const age = now - (cacheTimestamp || 0)

      // If within stale threshold, return immediately and update in background
      if (age < staleTtl * 1000) {
        return cached
      }

      // If stale but within max age, return stale data and revalidate
      if (age < maxAge * 1000) {
        // Revalidate in background
        if (!this.staleWhileRevalidate.has(key)) {
          const revalidatePromise = fetcher().then(fresh => {
            this.set(key, fresh, { storageTtl: maxAge / 60 })
            this.storage.setItem(`${key}-timestamp`, now)
            return fresh
          }).finally(() => {
            this.staleWhileRevalidate.delete(key)
          })
          
          this.staleWhileRevalidate.set(key, revalidatePromise)
        }
        
        return cached
      }
    }

    // No valid cache - fetch fresh
    const data = await fetcher()
    this.set(key, data, { storageTtl: maxAge / 60 })
    this.storage.setItem(`${key}-timestamp`, now)
    return data
  }

  // Batch operations for multiple cache keys
  async getBatch<T>(keys: string[]): Promise<Array<T | null>> {
    return Promise.all(keys.map(key => this.get<T>(key)))
  }

  setBatch<T>(entries: Array<{ key: string; value: T; options?: any }>): void {
    entries.forEach(({ key, value, options }) => {
      this.set(key, value, options)
    })
  }

  deleteBatch(keys: string[]): void {
    keys.forEach(key => this.delete(key))
  }

  // Cache invalidation patterns
  invalidatePattern(pattern: string): void {
    const regex = new RegExp(pattern)
    
    // Clear memory cache
    for (const [key] of this.memory['cache']) {
      if (regex.test(key)) {
        this.memory.delete(key)
      }
    }

    // Clear storage cache
    try {
      for (const fullKey in localStorage) {
        if (fullKey.startsWith(this.storage['prefix'])) {
          const key = fullKey.replace(this.storage['prefix'], '')
          if (regex.test(key)) {
            this.storage.removeItem(key)
          }
        }
      }
    } catch (error) {
      console.warn('Failed to invalidate storage pattern:', error)
    }
  }

  // Cache warming - preload frequently used data
  async warmCache<T>(
    warmupMap: Record<string, () => Promise<T>>,
    options: { parallel?: boolean; timeout?: number } = {}
  ): Promise<void> {
    const { parallel = true, timeout = 10000 } = options
    const entries = Object.entries(warmupMap)

    const warmupPromise = parallel 
      ? Promise.allSettled(entries.map(([key, fetcher]) => 
          this.cacheFirst(key, fetcher).catch(() => null)
        ))
      : entries.reduce(async (prev, [key, fetcher]) => {
          await prev
          return this.cacheFirst(key, fetcher).catch(() => null)
        }, Promise.resolve())

    // Apply timeout to warmup process
    await Promise.race([
      warmupPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Cache warmup timeout')), timeout)
      )
    ]).catch(() => {
      // Ignore warmup failures
    })
  }
}

// Enhanced cache with request deduplication
export class RequestDeduplicationCache extends AdvancedCacheManager {
  private inflightRequests = new Map<string, Promise<any>>()

  async dedupedRequest<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = 60
  ): Promise<T> {
    // Return cached data if available
    const cached = await this.get<T>(key)
    if (cached !== null) {
      return cached
    }

    // Return inflight request if exists
    if (this.inflightRequests.has(key)) {
      return this.inflightRequests.get(key)!
    }

    // Create new request
    const request = fetcher().then(data => {
      this.set(key, data, { storageTtl: ttl })
      this.inflightRequests.delete(key)
      return data
    }).catch(error => {
      this.inflightRequests.delete(key)
      throw error
    })

    this.inflightRequests.set(key, request)
    return request
  }

  // Clear all inflight requests
  clearInflightRequests(): void {
    this.inflightRequests.clear()
  }

  // Get inflight request count
  getInflightCount(): number {
    return this.inflightRequests.size
  }
}

// Global advanced cache instance
export const advancedCacheManager = new AdvancedCacheManager()
export const requestCache = new RequestDeduplicationCache()

// React hooks for advanced caching strategies
export function useNetworkFirst<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { enabled?: boolean; timeout?: number } = {}
) {
  const { enabled = true, timeout = 5000 } = options

  const getData = async () => {
    if (!enabled) return null
    return advancedCacheManager.networkFirst(key, fetcher, { timeout })
  }

  return { getData, invalidate: () => advancedCacheManager.delete(key) }
}

export function useCacheFirst<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { enabled?: boolean; backgroundUpdate?: boolean } = {}
) {
  const { enabled = true, backgroundUpdate = true } = options

  const getData = async () => {
    if (!enabled) return null
    return advancedCacheManager.cacheFirst(key, fetcher, { backgroundUpdate })
  }

  return { getData, invalidate: () => advancedCacheManager.delete(key) }
}

export function useStaleWhileRevalidate<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: { enabled?: boolean; staleTtl?: number; maxAge?: number } = {}
) {
  const { enabled = true, staleTtl = 300, maxAge = 3600 } = options

  const getData = async () => {
    if (!enabled) return null
    return advancedCacheManager.staleWhileRevalidate(key, fetcher, { staleTtl, maxAge })
  }

  return { getData, invalidate: () => advancedCacheManager.delete(key) }
}