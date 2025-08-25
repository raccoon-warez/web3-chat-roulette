// Service Worker for Web3 Chat Roulette
// Provides advanced caching, offline support, and performance optimization

const CACHE_NAME = 'web3-chat-roulette-v1'
const STATIC_CACHE_NAME = 'static-assets-v1'
const DYNAMIC_CACHE_NAME = 'dynamic-content-v1'

// Files to cache immediately
const STATIC_ASSETS = [
  '/',
  '/lobby',
  '/offline.html',
  '/manifest.json',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/apple-touch-icon.png',
]

// Cache strategies
const CACHE_STRATEGIES = {
  // Static assets - Cache first
  static: [
    '/_next/static/',
    '/fonts/',
    '/images/',
    '/icons/',
  ],
  
  // API calls - Network first with cache fallback
  api: [
    '/api/',
  ],
  
  // Pages - Stale while revalidate
  pages: [
    '/',
    '/lobby',
    '/call',
    '/tip',
    '/moderation',
  ],
}

// Install event - Cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...')
  
  event.waitUntil(
    Promise.all([
      // Cache static assets
      caches.open(STATIC_CACHE_NAME).then((cache) => {
        return cache.addAll(STATIC_ASSETS)
      }),
      
      // Skip waiting to activate immediately
      self.skipWaiting(),
    ])
  )
})

// Activate event - Clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...')
  
  event.waitUntil(
    Promise.all([
      // Take control of all clients immediately
      self.clients.claim(),
      
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (
              cacheName !== CACHE_NAME &&
              cacheName !== STATIC_CACHE_NAME &&
              cacheName !== DYNAMIC_CACHE_NAME
            ) {
              console.log('[SW] Deleting old cache:', cacheName)
              return caches.delete(cacheName)
            }
          })
        )
      }),
    ])
  )
})

// Fetch event - Route requests to appropriate cache strategy
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  
  // Skip non-GET requests
  if (request.method !== 'GET') return
  
  // Skip chrome-extension requests
  if (url.protocol === 'chrome-extension:') return
  
  // Skip external requests (except for same origin)
  if (url.origin !== location.origin && !url.pathname.startsWith('/_next/')) return

  event.respondWith(handleRequest(request))
})

// Main request handler
async function handleRequest(request) {
  const url = new URL(request.url)
  const pathname = url.pathname

  try {
    // Route to appropriate cache strategy
    if (isStaticAsset(pathname)) {
      return cacheFirst(request)
    } else if (isApiRequest(pathname)) {
      return networkFirst(request)
    } else if (isPageRequest(pathname)) {
      return staleWhileRevalidate(request)
    } else {
      return networkFirst(request)
    }
  } catch (error) {
    console.error('[SW] Request handling error:', error)
    return handleOffline(request)
  }
}

// Check if request is for static asset
function isStaticAsset(pathname) {
  return CACHE_STRATEGIES.static.some(pattern => pathname.startsWith(pattern))
}

// Check if request is for API
function isApiRequest(pathname) {
  return CACHE_STRATEGIES.api.some(pattern => pathname.startsWith(pattern))
}

// Check if request is for a page
function isPageRequest(pathname) {
  return CACHE_STRATEGIES.pages.includes(pathname) || pathname === '/'
}

// Cache First Strategy - Good for static assets
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE_NAME)
  const cachedResponse = await cache.match(request)
  
  if (cachedResponse) {
    // Optionally update cache in background for critical resources
    if (isCriticalResource(request.url)) {
      updateCacheInBackground(request, cache)
    }
    return cachedResponse
  }

  try {
    const networkResponse = await fetch(request)
    if (networkResponse.status === 200) {
      cache.put(request, networkResponse.clone())
    }
    return networkResponse
  } catch (error) {
    console.warn('[SW] Cache first fallback failed:', error)
    throw error
  }
}

// Network First Strategy - Good for API calls
async function networkFirst(request, timeout = 3000) {
  const cache = await caches.open(DYNAMIC_CACHE_NAME)

  try {
    // Race network request against timeout
    const networkResponse = await Promise.race([
      fetch(request),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Network timeout')), timeout)
      )
    ])

    if (networkResponse.status === 200) {
      cache.put(request, networkResponse.clone())
    }
    return networkResponse
  } catch (error) {
    console.warn('[SW] Network first failed, trying cache:', error)
    const cachedResponse = await cache.match(request)
    
    if (cachedResponse) {
      return cachedResponse
    }
    
    throw error
  }
}

// Stale While Revalidate Strategy - Good for pages
async function staleWhileRevalidate(request) {
  const cache = await caches.open(DYNAMIC_CACHE_NAME)
  const cachedResponse = await cache.match(request)

  // Update cache in background
  const updateCache = async () => {
    try {
      const networkResponse = await fetch(request)
      if (networkResponse.status === 200) {
        cache.put(request, networkResponse.clone())
      }
    } catch (error) {
      console.warn('[SW] Background update failed:', error)
    }
  }

  // Don't await this - update in background
  updateCache()

  // Return cached response immediately if available
  if (cachedResponse) {
    return cachedResponse
  }

  // If no cache, wait for network
  try {
    const networkResponse = await fetch(request)
    if (networkResponse.status === 200) {
      cache.put(request, networkResponse.clone())
    }
    return networkResponse
  } catch (error) {
    return handleOffline(request)
  }
}

// Update cache in background for critical resources
async function updateCacheInBackground(request, cache) {
  try {
    const networkResponse = await fetch(request)
    if (networkResponse.status === 200) {
      cache.put(request, networkResponse.clone())
    }
  } catch (error) {
    // Silent failure for background updates
  }
}

// Check if resource is critical and should be updated frequently
function isCriticalResource(url) {
  const criticalPatterns = [
    '/_next/static/chunks/main',
    '/_next/static/chunks/webpack',
    '/manifest.json',
  ]
  return criticalPatterns.some(pattern => url.includes(pattern))
}

// Handle offline scenarios
async function handleOffline(request) {
  const url = new URL(request.url)
  
  // For navigation requests, return offline page
  if (request.mode === 'navigate') {
    const cache = await caches.open(STATIC_CACHE_NAME)
    const offlinePage = await cache.match('/offline.html')
    if (offlinePage) {
      return offlinePage
    }
  }

  // For other requests, return a generic offline response
  return new Response(
    JSON.stringify({
      error: 'Offline',
      message: 'This content is not available offline',
    }),
    {
      status: 503,
      statusText: 'Service Unavailable',
      headers: {
        'Content-Type': 'application/json',
      },
    }
  )
}

// Background sync for failed requests
self.addEventListener('sync', (event) => {
  if (event.tag === 'background-sync') {
    event.waitUntil(handleBackgroundSync())
  }
})

// Handle background sync
async function handleBackgroundSync() {
  console.log('[SW] Background sync triggered')
  
  // Retry failed API requests
  const cache = await caches.open('failed-requests')
  const requests = await cache.keys()
  
  for (const request of requests) {
    try {
      await fetch(request)
      await cache.delete(request)
    } catch (error) {
      console.warn('[SW] Background sync retry failed:', error)
    }
  }
}

// Push notification handling
self.addEventListener('push', (event) => {
  if (!event.data) return

  const data = event.data.json()
  const options = {
    body: data.body,
    icon: '/favicon-32x32.png',
    badge: '/favicon-16x16.png',
    data: data.url,
    actions: [
      {
        action: 'open',
        title: 'Open App',
      },
      {
        action: 'close',
        title: 'Close',
      },
    ],
  }

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  )
})

// Notification click handling
self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  if (event.action === 'open' || !event.action) {
    event.waitUntil(
      self.clients.openWindow(event.notification.data || '/')
    )
  }
})

// Message handling from main thread
self.addEventListener('message', (event) => {
  const { type, payload } = event.data

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting()
      break
      
    case 'GET_CACHE_STATS':
      getCacheStats().then(stats => {
        event.ports[0].postMessage(stats)
      })
      break
      
    case 'CLEAR_CACHE':
      clearAllCaches().then(() => {
        event.ports[0].postMessage({ success: true })
      })
      break
      
    default:
      console.warn('[SW] Unknown message type:', type)
  }
})

// Get cache statistics
async function getCacheStats() {
  const cacheNames = await caches.keys()
  const stats = {}

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName)
    const keys = await cache.keys()
    stats[cacheName] = keys.length
  }

  return stats
}

// Clear all caches
async function clearAllCaches() {
  const cacheNames = await caches.keys()
  await Promise.all(cacheNames.map(name => caches.delete(name)))
}

// Periodic cache cleanup
setInterval(async () => {
  try {
    await performCacheCleanup()
  } catch (error) {
    console.error('[SW] Cache cleanup failed:', error)
  }
}, 24 * 60 * 60 * 1000) // Daily cleanup

// Perform cache cleanup
async function performCacheCleanup() {
  const cache = await caches.open(DYNAMIC_CACHE_NAME)
  const requests = await cache.keys()
  const now = Date.now()
  const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days

  for (const request of requests) {
    const response = await cache.match(request)
    if (response) {
      const dateHeader = response.headers.get('date')
      if (dateHeader) {
        const responseDate = new Date(dateHeader).getTime()
        if (now - responseDate > maxAge) {
          await cache.delete(request)
        }
      }
    }
  }
}

// Advanced caching enhancements
const PERFORMANCE_CACHE_NAME = 'performance-assets-v1'
const WEBRTC_CACHE_NAME = 'webrtc-assets-v1'

// Performance-based cache selection
class AdaptiveCacheStrategy {
  constructor() {
    this.networkSpeed = this.getNetworkSpeed()
    this.memoryInfo = this.getMemoryInfo()
  }

  getNetworkSpeed() {
    if ('connection' in navigator) {
      const connection = navigator.connection
      return {
        effectiveType: connection.effectiveType,
        downlink: connection.downlink,
        rtt: connection.rtt
      }
    }
    return { effectiveType: '4g', downlink: 10, rtt: 100 }
  }

  getMemoryInfo() {
    if ('memory' in performance) {
      const memory = performance.memory
      return {
        used: memory.usedJSHeapSize,
        total: memory.totalJSHeapSize,
        limit: memory.jsHeapSizeLimit
      }
    }
    return { used: 0, total: 0, limit: 0 }
  }

  // Adaptive timeout based on network conditions
  getTimeout(requestType) {
    const baseTimeouts = {
      api: 5000,
      static: 10000,
      page: 8000
    }

    const networkMultiplier = {
      'slow-2g': 3,
      '2g': 2,
      '3g': 1.5,
      '4g': 1,
      '5g': 0.8
    }

    const multiplier = networkMultiplier[this.networkSpeed.effectiveType] || 1
    return Math.round(baseTimeouts[requestType] * multiplier)
  }

  // Determine if aggressive caching should be used
  shouldUseAggressiveCaching() {
    const memoryUsage = this.memoryInfo.used / this.memoryInfo.limit
    const isSlowNetwork = ['slow-2g', '2g', '3g'].includes(this.networkSpeed.effectiveType)
    
    return isSlowNetwork && memoryUsage < 0.8
  }
}

const adaptiveStrategy = new AdaptiveCacheStrategy()

// Enhanced network first with adaptive timeout
async function enhancedNetworkFirst(request, requestType = 'api') {
  const cache = await caches.open(DYNAMIC_CACHE_NAME)
  const timeout = adaptiveStrategy.getTimeout(requestType)

  try {
    const networkResponse = await Promise.race([
      fetch(request),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Network timeout')), timeout)
      )
    ])

    if (networkResponse.status === 200) {
      // Use different cache based on content type
      const targetCache = await getCacheForResponse(networkResponse, request)
      targetCache.put(request, networkResponse.clone())
    }
    
    return networkResponse
  } catch (error) {
    console.warn('[SW] Enhanced network first failed, trying cache:', error)
    const cachedResponse = await cache.match(request)
    
    if (cachedResponse) {
      return cachedResponse
    }
    
    // Store failed request for background sync
    if (request.method === 'POST' || request.method === 'PUT') {
      await storeFaillledRequest(request)
    }
    
    throw error
  }
}

// Get appropriate cache based on response type
async function getCacheForResponse(response, request) {
  const contentType = response.headers.get('content-type') || ''
  const url = new URL(request.url)

  if (contentType.includes('image/') || url.pathname.includes('/images/')) {
    return caches.open(PERFORMANCE_CACHE_NAME)
  }
  
  if (url.pathname.includes('/webrtc/') || url.pathname.includes('/signaling/')) {
    return caches.open(WEBRTC_CACHE_NAME)
  }
  
  return caches.open(DYNAMIC_CACHE_NAME)
}

// Store failed requests for background sync
async function storeFaillledRequest(request) {
  try {
    const cache = await caches.open('failed-requests')
    await cache.put(request.url + '-' + Date.now(), new Response(
      JSON.stringify({
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(request.headers.entries()),
        timestamp: Date.now()
      }),
      {
        headers: { 'Content-Type': 'application/json' }
      }
    ))
  } catch (error) {
    console.warn('[SW] Failed to store failed request:', error)
  }
}

// Predictive preloading based on navigation patterns
class PredictivePreloader {
  constructor() {
    this.navigationHistory = []
    this.preloadQueue = new Set()
  }

  // Analyze navigation patterns and preload likely next resources
  analyzeAndPreload(currentPath) {
    this.navigationHistory.push({
      path: currentPath,
      timestamp: Date.now()
    })

    // Keep only last 20 navigations
    if (this.navigationHistory.length > 20) {
      this.navigationHistory.shift()
    }

    const predictions = this.predictNextNavigation()
    predictions.forEach(prediction => {
      if (prediction.probability > 0.6 && !this.preloadQueue.has(prediction.path)) {
        this.preloadResource(prediction.path)
        this.preloadQueue.add(prediction.path)
      }
    })
  }

  predictNextNavigation() {
    if (this.navigationHistory.length < 3) return []

    const recentPaths = this.navigationHistory.slice(-3).map(entry => entry.path)
    const patterns = this.findNavigationPatterns()
    
    return patterns
      .filter(pattern => this.isPatternMatch(pattern.sequence, recentPaths))
      .map(pattern => ({
        path: pattern.nextPath,
        probability: pattern.probability
      }))
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 3) // Top 3 predictions
  }

  findNavigationPatterns() {
    const patterns = []
    const sequences = new Map()

    // Analyze 2-step sequences
    for (let i = 0; i < this.navigationHistory.length - 2; i++) {
      const sequence = [
        this.navigationHistory[i].path,
        this.navigationHistory[i + 1].path
      ]
      const nextPath = this.navigationHistory[i + 2].path
      const key = sequence.join('->')

      if (!sequences.has(key)) {
        sequences.set(key, { total: 0, outcomes: new Map() })
      }

      const sequenceData = sequences.get(key)
      sequenceData.total++
      
      const currentCount = sequenceData.outcomes.get(nextPath) || 0
      sequenceData.outcomes.set(nextPath, currentCount + 1)
    }

    // Convert to patterns with probabilities
    sequences.forEach((data, key) => {
      data.outcomes.forEach((count, nextPath) => {
        patterns.push({
          sequence: key.split('->'),
          nextPath,
          probability: count / data.total,
          confidence: Math.min(data.total / 5, 1) // More occurrences = higher confidence
        })
      })
    })

    return patterns.filter(p => p.confidence > 0.3)
  }

  isPatternMatch(patternSequence, recentPaths) {
    if (patternSequence.length > recentPaths.length) return false
    
    const startIndex = recentPaths.length - patternSequence.length
    for (let i = 0; i < patternSequence.length; i++) {
      if (recentPaths[startIndex + i] !== patternSequence[i]) {
        return false
      }
    }
    
    return true
  }

  async preloadResource(path) {
    try {
      const cache = await caches.open(PERFORMANCE_CACHE_NAME)
      
      // Preload page
      const pageRequest = new Request(path, { method: 'GET' })
      const response = await fetch(pageRequest)
      
      if (response.status === 200) {
        cache.put(pageRequest, response.clone())
        console.debug('[SW] Preloaded:', path)
      }
    } catch (error) {
      console.warn('[SW] Preload failed for:', path, error)
    }
  }
}

const predictivePreloader = new PredictivePreloader()

// Enhanced message handling with predictive analytics
self.addEventListener('message', (event) => {
  const { type, payload } = event.data

  switch (type) {
    case 'SKIP_WAITING':
      self.skipWaiting()
      break
      
    case 'GET_CACHE_STATS':
      getCacheStats().then(stats => {
        event.ports[0].postMessage(stats)
      })
      break
      
    case 'CLEAR_CACHE':
      clearAllCaches().then(() => {
        event.ports[0].postMessage({ success: true })
      })
      break

    case 'NAVIGATION':
      if (payload && payload.path) {
        predictivePreloader.analyzeAndPreload(payload.path)
      }
      break

    case 'PRELOAD_RESOURCES':
      if (payload && payload.resources) {
        preloadResourceList(payload.resources)
      }
      break

    case 'GET_PERFORMANCE_METRICS':
      getPerformanceMetrics().then(metrics => {
        event.ports[0].postMessage(metrics)
      })
      break
      
    default:
      console.warn('[SW] Unknown message type:', type)
  }
})

// Preload list of resources
async function preloadResourceList(resources) {
  const cache = await caches.open(PERFORMANCE_CACHE_NAME)
  
  for (const resource of resources) {
    try {
      const request = new Request(resource.url)
      const response = await fetch(request)
      
      if (response.status === 200) {
        cache.put(request, response)
      }
    } catch (error) {
      console.warn('[SW] Failed to preload resource:', resource.url, error)
    }
  }
}

// Get performance metrics from service worker perspective
async function getPerformanceMetrics() {
  const cacheStats = await getCacheStats()
  const memoryInfo = adaptiveStrategy.getMemoryInfo()
  const networkInfo = adaptiveStrategy.getNetworkSpeed()
  
  return {
    caches: cacheStats,
    memory: memoryInfo,
    network: networkInfo,
    preloadQueue: predictivePreloader.preloadQueue.size,
    navigationHistory: predictivePreloader.navigationHistory.length,
    timestamp: Date.now()
  }
}

// Enhanced cache cleanup with size limits
async function performAdvancedCacheCleanup() {
  const caches = [
    { name: DYNAMIC_CACHE_NAME, maxSize: 50, maxAge: 7 * 24 * 60 * 60 * 1000 },
    { name: PERFORMANCE_CACHE_NAME, maxSize: 30, maxAge: 24 * 60 * 60 * 1000 },
    { name: WEBRTC_CACHE_NAME, maxSize: 20, maxAge: 60 * 60 * 1000 }
  ]

  for (const cacheConfig of caches) {
    try {
      await cleanupCacheByConfig(cacheConfig)
    } catch (error) {
      console.error(`[SW] Failed to cleanup cache ${cacheConfig.name}:`, error)
    }
  }
}

async function cleanupCacheByConfig(config) {
  const cache = await caches.open(config.name)
  const requests = await cache.keys()
  const now = Date.now()
  
  // Sort by last used (using response date as proxy)
  const requestsWithDates = await Promise.all(
    requests.map(async request => {
      const response = await cache.match(request)
      const dateHeader = response?.headers.get('date')
      const date = dateHeader ? new Date(dateHeader).getTime() : 0
      return { request, date }
    })
  )
  
  requestsWithDates.sort((a, b) => b.date - a.date)
  
  // Remove old entries
  const toDelete = []
  
  for (let i = 0; i < requestsWithDates.length; i++) {
    const item = requestsWithDates[i]
    const isOld = now - item.date > config.maxAge
    const isOverLimit = i >= config.maxSize
    
    if (isOld || isOverLimit) {
      toDelete.push(item.request)
    }
  }
  
  // Delete marked entries
  await Promise.all(toDelete.map(request => cache.delete(request)))
  
  if (toDelete.length > 0) {
    console.debug(`[SW] Cleaned up ${toDelete.length} entries from ${config.name}`)
  }
}

// Initialize advanced features
if ('serviceWorker' in self) {
  // Run advanced cleanup daily
  setInterval(performAdvancedCacheCleanup, 24 * 60 * 60 * 1000)
  
  // Initialize network monitoring
  if ('connection' in navigator) {
    navigator.connection.addEventListener('change', () => {
      // Update adaptive strategy on network change
      adaptiveStrategy.networkSpeed = adaptiveStrategy.getNetworkSpeed()
      console.debug('[SW] Network conditions changed:', adaptiveStrategy.networkSpeed)
    })
  }
}

console.log('[SW] Enhanced Service Worker loaded and ready with advanced caching strategies')