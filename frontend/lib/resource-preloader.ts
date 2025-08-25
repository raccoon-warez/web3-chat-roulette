'use client'

import { useState, useEffect } from 'react'

// Resource preloading utilities for optimal performance
export class ResourcePreloader {
  private preloadedResources = new Set<string>()
  private observers = new Map<string, IntersectionObserver>()

  // Preload critical JavaScript chunks
  preloadCriticalChunks(): void {
    if (typeof window === 'undefined') return

    const criticalChunks = [
      '/_next/static/chunks/webpack.js',
      '/_next/static/chunks/main.js',
      '/_next/static/chunks/pages/_app.js',
      '/_next/static/chunks/framework.js',
    ]

    criticalChunks.forEach(chunk => {
      this.preloadScript(chunk, 'high')
    })
  }

  // Preload route-specific chunks on hover/focus
  preloadRouteChunk(route: string, priority: 'high' | 'low' = 'low'): void {
    if (this.preloadedResources.has(route)) return

    const chunkPath = `/_next/static/chunks/pages${route}.js`
    this.preloadScript(chunkPath, priority)
    this.preloadedResources.add(route)
  }

  // Preload script with priority
  private preloadScript(src: string, priority: 'high' | 'low' = 'low'): void {
    if (typeof document === 'undefined' || this.preloadedResources.has(src)) return

    const link = document.createElement('link')
    link.rel = 'modulepreload'
    link.href = src
    if (priority === 'high') {
      link.setAttribute('fetchpriority', 'high')
    }
    
    document.head.appendChild(link)
    this.preloadedResources.add(src)
  }

  // Preload images with priority and lazy loading
  preloadImage(src: string, options: {
    priority?: 'high' | 'low'
    sizes?: string
    lazy?: boolean
  } = {}): void {
    if (typeof document === 'undefined' || this.preloadedResources.has(src)) return

    const { priority = 'low', sizes, lazy = false } = options

    if (lazy) {
      // Use Intersection Observer for lazy preloading
      this.lazyPreloadImage(src, options)
      return
    }

    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = src
    
    if (priority === 'high') {
      link.setAttribute('fetchpriority', 'high')
    }
    
    if (sizes) {
      link.setAttribute('imagesizes', sizes)
    }

    document.head.appendChild(link)
    this.preloadedResources.add(src)
  }

  // Lazy preload images when they come into viewport
  private lazyPreloadImage(src: string, options: { priority?: 'high' | 'low' }): void {
    if (!('IntersectionObserver' in window)) {
      // Fallback for browsers without IntersectionObserver
      this.preloadImage(src, { ...options, lazy: false })
      return
    }

    // Create a dummy element to observe
    const placeholder = document.createElement('div')
    placeholder.style.position = 'absolute'
    placeholder.style.top = '-1px'
    placeholder.style.left = '-1px'
    placeholder.style.width = '1px'
    placeholder.style.height = '1px'
    placeholder.style.opacity = '0'
    placeholder.style.pointerEvents = 'none'
    document.body.appendChild(placeholder)

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            this.preloadImage(src, { ...options, lazy: false })
            observer.disconnect()
            document.body.removeChild(placeholder)
          }
        })
      },
      { rootMargin: '50px' }
    )

    observer.observe(placeholder)
    this.observers.set(src, observer)
  }

  // Preload fonts
  preloadFont(src: string, type: string = 'font/woff2'): void {
    if (typeof document === 'undefined' || this.preloadedResources.has(src)) return

    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'font'
    link.type = type
    link.href = src
    link.crossOrigin = 'anonymous'

    document.head.appendChild(link)
    this.preloadedResources.add(src)
  }

  // Preload CSS
  preloadCSS(src: string): void {
    if (typeof document === 'undefined' || this.preloadedResources.has(src)) return

    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'style'
    link.href = src

    document.head.appendChild(link)
    this.preloadedResources.add(src)
  }

  // DNS prefetch for external domains
  dnsPrefetch(domain: string): void {
    if (typeof document === 'undefined' || this.preloadedResources.has(`dns:${domain}`)) return

    const link = document.createElement('link')
    link.rel = 'dns-prefetch'
    link.href = domain

    document.head.appendChild(link)
    this.preloadedResources.add(`dns:${domain}`)
  }

  // Preconnect for critical external resources
  preconnect(domain: string, crossOrigin: boolean = false): void {
    if (typeof document === 'undefined' || this.preloadedResources.has(`preconnect:${domain}`)) return

    const link = document.createElement('link')
    link.rel = 'preconnect'
    link.href = domain
    
    if (crossOrigin) {
      link.crossOrigin = 'anonymous'
    }

    document.head.appendChild(link)
    this.preloadedResources.add(`preconnect:${domain}`)
  }

  // Prefetch for next-likely navigation
  prefetchRoute(route: string): void {
    if (typeof document === 'undefined' || this.preloadedResources.has(`prefetch:${route}`)) return

    const link = document.createElement('link')
    link.rel = 'prefetch'
    link.href = route

    document.head.appendChild(link)
    this.preloadedResources.add(`prefetch:${route}`)
  }

  // Intelligent route preloading based on user behavior
  setupIntelligentPreloading(): void {
    if (typeof window === 'undefined') return

    // Preload on link hover/focus
    document.addEventListener('mouseover', this.handleLinkHover.bind(this))
    document.addEventListener('touchstart', this.handleLinkHover.bind(this))
    document.addEventListener('focusin', this.handleLinkFocus.bind(this))

    // Preload based on user intent signals
    this.setupIntentDetection()
  }

  private handleLinkHover(event: Event): void {
    const target = event.target as HTMLElement
    const link = target.closest('a[href]') as HTMLAnchorElement
    
    if (link && link.href && link.hostname === window.location.hostname) {
      const route = new URL(link.href).pathname
      this.preloadRouteChunk(route, 'low')
      
      // Also prefetch the actual page
      this.prefetchRoute(route)
    }
  }

  private handleLinkFocus(event: Event): void {
    const target = event.target as HTMLElement
    if (target.tagName === 'A') {
      const link = target as HTMLAnchorElement
      if (link.href && link.hostname === window.location.hostname) {
        const route = new URL(link.href).pathname
        this.preloadRouteChunk(route, 'high')
      }
    }
  }

  // Setup user intent detection for predictive preloading
  private setupIntentDetection(): void {
    let mouseDirection = { x: 0, y: 0 }
    let lastMousePos = { x: 0, y: 0 }

    document.addEventListener('mousemove', (event) => {
      mouseDirection = {
        x: event.clientX - lastMousePos.x,
        y: event.clientY - lastMousePos.y,
      }
      lastMousePos = { x: event.clientX, y: event.clientY }

      // Detect if mouse is moving towards a link
      const elementAtCursor = document.elementFromPoint(event.clientX, event.clientY)
      const nearbyLink = elementAtCursor?.closest('a[href]') as HTMLAnchorElement

      if (nearbyLink && this.isMovingTowardsElement(mouseDirection, nearbyLink)) {
        const route = new URL(nearbyLink.href).pathname
        this.preloadRouteChunk(route, 'low')
      }
    })
  }

  private isMovingTowardsElement(direction: { x: number; y: number }, element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect()
    const elementCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    }

    // Simple heuristic: check if mouse direction aligns with element position
    const magnitude = Math.sqrt(direction.x ** 2 + direction.y ** 2)
    if (magnitude < 2) return false // Too slow movement

    const normalizedDirection = {
      x: direction.x / magnitude,
      y: direction.y / magnitude,
    }

    const toElement = {
      x: elementCenter.x - lastMousePos.x,
      y: elementCenter.y - lastMousePos.y,
    }
    
    const toElementMagnitude = Math.sqrt(toElement.x ** 2 + toElement.y ** 2)
    if (toElementMagnitude < 50) return false // Too close already

    const normalizedToElement = {
      x: toElement.x / toElementMagnitude,
      y: toElement.y / toElementMagnitude,
    }

    // Calculate dot product for direction similarity
    const similarity = normalizedDirection.x * normalizedToElement.x + 
                      normalizedDirection.y * normalizedToElement.y

    return similarity > 0.5 // Moving towards the element
  }

  // Cleanup observers
  cleanup(): void {
    this.observers.forEach(observer => observer.disconnect())
    this.observers.clear()
  }

  // Get preloading statistics
  getStats() {
    return {
      preloadedCount: this.preloadedResources.size,
      activeObservers: this.observers.size,
      preloadedResources: Array.from(this.preloadedResources),
    }
  }
}

// React hook for resource preloading
export function useResourcePreloader() {
  const [preloader] = useState(() => new ResourcePreloader())

  useEffect(() => {
    // Setup intelligent preloading on mount
    preloader.setupIntelligentPreloading()

    // Preload critical resources
    preloader.preloadCriticalChunks()

    // DNS prefetch for critical domains
    preloader.dnsPrefetch('//fonts.gstatic.com')
    preloader.dnsPrefetch('//cdn.jsdelivr.net')
    
    // Preconnect to API endpoints
    preloader.preconnect('https://api.web3chatroulette.com', true)

    return () => {
      preloader.cleanup()
    }
  }, [preloader])

  return {
    preloader,
    preloadRoute: (route: string) => preloader.preloadRouteChunk(route),
    preloadImage: (src: string, options?: Parameters<ResourcePreloader['preloadImage']>[1]) => 
      preloader.preloadImage(src, options),
    getStats: () => preloader.getStats(),
  }
}

// Global preloader instance
export const globalPreloader = new ResourcePreloader()

// Route-specific preloading configurations
export const routePreloadConfig = {
  '/lobby': {
    chunks: ['lobby', 'webrtc'],
    images: ['/images/lobby-bg.jpg'],
    fonts: ['Inter-Bold.woff2'],
  },
  '/call': {
    chunks: ['call', 'webrtc', 'simple-peer'],
    images: ['/images/call-bg.jpg', '/images/avatar-placeholder.png'],
    fonts: ['Inter-Medium.woff2'],
  },
  '/tip': {
    chunks: ['tip', 'wagmi', 'viem'],
    images: ['/images/tip-bg.jpg'],
    fonts: ['Inter-Regular.woff2'],
  },
}

// Preload route-specific resources
export function preloadRouteResources(route: keyof typeof routePreloadConfig): void {
  const config = routePreloadConfig[route]
  if (!config) return

  // Preload JavaScript chunks
  config.chunks.forEach(chunk => {
    globalPreloader.preloadRouteChunk(`/${chunk}`)
  })

  // Preload images
  config.images.forEach(image => {
    globalPreloader.preloadImage(image, { priority: 'low' })
  })

  // Preload fonts
  config.fonts.forEach(font => {
    globalPreloader.preloadFont(`/fonts/${font}`)
  })
}

// Service worker cache preloading
export async function preloadStaticAssets(): Promise<void> {
  if (!('serviceWorker' in navigator)) return

  try {
    const staticAssets = [
      '/manifest.json',
      '/favicon-16x16.png',
      '/favicon-32x32.png',
      '/apple-touch-icon.png',
      '/fonts/Inter-Regular.woff2',
      '/fonts/Inter-Medium.woff2',
      '/fonts/Inter-Bold.woff2',
    ]

    // Register service worker if not already registered
    const registration = await navigator.serviceWorker.ready
    
    // Cache static assets
    const cache = await caches.open('static-assets-v1')
    await cache.addAll(staticAssets)
    
    console.log('Static assets preloaded successfully')
  } catch (error) {
    console.warn('Failed to preload static assets:', error)
  }
}

// Advanced resource optimization strategies
export class AdvancedResourceOptimizer {
  private loadingQueue = new Map<string, Promise<void>>()
  private priorityQueue: Array<{ resource: string; priority: number; type: string }> = []
  private networkConnection: any = null

  constructor() {
    if (typeof navigator !== 'undefined' && 'connection' in navigator) {
      this.networkConnection = (navigator as any).connection
    }
  }

  // Adaptive resource loading based on network conditions
  adaptiveResourceLoading(resources: Array<{
    url: string
    type: 'script' | 'image' | 'font' | 'css'
    priority: number
    size?: number
  }>): Promise<void[]> {
    // Sort by priority and network conditions
    const effectiveType = this.networkConnection?.effectiveType || '4g'
    const isSlowConnection = ['slow-2g', '2g', '3g'].includes(effectiveType)

    // Adjust priorities for slow connections
    const adjustedResources = resources.map(resource => ({
      ...resource,
      adjustedPriority: isSlowConnection ? 
        resource.priority * (resource.size || 1000) / 1000 : 
        resource.priority
    }))

    // Sort by adjusted priority
    adjustedResources.sort((a, b) => b.adjustedPriority - a.adjustedPriority)

    // Load resources with backpressure control
    const maxConcurrent = isSlowConnection ? 2 : 6
    return this.loadResourcesWithBackpressure(adjustedResources, maxConcurrent)
  }

  private async loadResourcesWithBackpressure(
    resources: Array<{ url: string; type: string; adjustedPriority: number }>,
    maxConcurrent: number
  ): Promise<void[]> {
    const results: Promise<void>[] = []
    const executing: Promise<void>[] = []

    for (const resource of resources) {
      const promise = this.loadSingleResource(resource.url, resource.type)
      results.push(promise)

      if (resources.length >= maxConcurrent) {
        executing.push(promise.then(() => {
          executing.splice(executing.indexOf(promise), 1)
        }))

        if (executing.length >= maxConcurrent) {
          await Promise.race(executing)
        }
      }
    }

    return Promise.all(results)
  }

  private async loadSingleResource(url: string, type: string): Promise<void> {
    if (this.loadingQueue.has(url)) {
      return this.loadingQueue.get(url)!
    }

    const loadPromise = new Promise<void>((resolve, reject) => {
      if (type === 'script') {
        this.loadScript(url).then(resolve).catch(reject)
      } else if (type === 'image') {
        this.loadImage(url).then(resolve).catch(reject)
      } else if (type === 'font') {
        this.loadFont(url).then(resolve).catch(reject)
      } else if (type === 'css') {
        this.loadCSS(url).then(resolve).catch(reject)
      } else {
        reject(new Error(`Unknown resource type: ${type}`))
      }
    })

    this.loadingQueue.set(url, loadPromise)
    return loadPromise
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.onload = () => resolve()
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
      script.src = src
      document.head.appendChild(script)
    })
  }

  private loadImage(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve()
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`))
      img.src = src
    })
  }

  private loadFont(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const font = new FontFace('preload-font', `url(${src})`)
      font.load()
        .then(() => {
          document.fonts.add(font)
          resolve()
        })
        .catch(() => reject(new Error(`Failed to load font: ${src}`)))
    })
  }

  private loadCSS(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.onload = () => resolve()
      link.onerror = () => reject(new Error(`Failed to load CSS: ${src}`))
      link.href = src
      document.head.appendChild(link)
    })
  }

  // Critical resource path optimization
  optimizeCriticalRenderingPath(resources: {
    critical: string[]
    important: string[]
    deferred: string[]
  }): Promise<void> {
    return new Promise(async (resolve) => {
      // Load critical resources first (blocking)
      await Promise.all(
        resources.critical.map(url => 
          this.loadSingleResource(url, this.getResourceType(url))
        )
      )

      // Load important resources (non-blocking)
      setTimeout(() => {
        resources.important.forEach(url => 
          this.loadSingleResource(url, this.getResourceType(url))
        )
      }, 0)

      // Load deferred resources after a delay
      setTimeout(() => {
        resources.deferred.forEach(url => 
          this.loadSingleResource(url, this.getResourceType(url))
        )
      }, 100)

      resolve()
    })
  }

  private getResourceType(url: string): string {
    if (url.includes('.js')) return 'script'
    if (url.includes('.css')) return 'css'
    if (url.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i)) return 'image'
    if (url.match(/\.(woff|woff2|ttf|eot)$/i)) return 'font'
    return 'script' // default
  }

  // Resource budget management
  checkResourceBudget(): {
    totalSize: number
    breakdown: Record<string, number>
    budgetStatus: 'under' | 'near' | 'over'
    recommendations: string[]
  } {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const breakdown = {
      scripts: 0,
      stylesheets: 0,
      images: 0,
      fonts: 0,
      other: 0
    }

    let totalSize = 0

    resources.forEach(resource => {
      const size = resource.transferSize || resource.encodedBodySize || 0
      totalSize += size

      const url = resource.name.toLowerCase()
      if (url.includes('.js')) {
        breakdown.scripts += size
      } else if (url.includes('.css')) {
        breakdown.stylesheets += size
      } else if (/\.(jpg|jpeg|png|gif|webp|svg)/.test(url)) {
        breakdown.images += size
      } else if (/\.(woff|woff2|ttf|eot)/.test(url)) {
        breakdown.fonts += size
      } else {
        breakdown.other += size
      }
    })

    // Budget thresholds (in bytes)
    const budgets = {
      scripts: 300 * 1024, // 300KB
      stylesheets: 100 * 1024, // 100KB
      images: 1000 * 1024, // 1MB
      fonts: 200 * 1024, // 200KB
      total: 2000 * 1024 // 2MB
    }

    const budgetUsage = totalSize / budgets.total
    let budgetStatus: 'under' | 'near' | 'over' = 'under'
    
    if (budgetUsage > 1) budgetStatus = 'over'
    else if (budgetUsage > 0.8) budgetStatus = 'near'

    const recommendations: string[] = []
    
    if (breakdown.scripts > budgets.scripts) {
      recommendations.push('Reduce JavaScript bundle size with code splitting')
    }
    if (breakdown.images > budgets.images) {
      recommendations.push('Optimize images with modern formats (WebP/AVIF)')
    }
    if (breakdown.stylesheets > budgets.stylesheets) {
      recommendations.push('Minimize CSS and remove unused styles')
    }
    if (breakdown.fonts > budgets.fonts) {
      recommendations.push('Optimize font loading and reduce font variations')
    }

    return {
      totalSize,
      breakdown,
      budgetStatus,
      recommendations
    }
  }

  // Predictive preloading based on user behavior
  setupPredictivePreloading(): void {
    this.trackUserBehavior()
    this.analyzeNavigationPatterns()
  }

  private trackUserBehavior(): void {
    const interactions = {
      scrollDepth: 0,
      timeOnPage: Date.now(),
      clickPatterns: [] as string[]
    }

    // Track scroll depth
    let maxScrollDepth = 0
    window.addEventListener('scroll', () => {
      const scrollDepth = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
      maxScrollDepth = Math.max(maxScrollDepth, scrollDepth)
      interactions.scrollDepth = maxScrollDepth
    })

    // Track clicks
    document.addEventListener('click', (event) => {
      const target = event.target as HTMLElement
      const selector = this.generateSelector(target)
      interactions.clickPatterns.push(selector)
    })

    // Predict next actions based on behavior
    setTimeout(() => {
      this.predictNextActions(interactions)
    }, 5000) // After 5 seconds of user behavior
  }

  private generateSelector(element: HTMLElement): string {
    if (element.id) return `#${element.id}`
    if (element.className) return `.${element.className.split(' ')[0]}`
    return element.tagName.toLowerCase()
  }

  private predictNextActions(interactions: any): void {
    // Simple prediction logic - can be enhanced with ML
    const { scrollDepth, clickPatterns } = interactions

    // If user scrolled far, they're engaged - preload related content
    if (scrollDepth > 70) {
      globalPreloader.prefetchRoute('/related-content')
    }

    // If user clicked on specific elements, predict next navigation
    const hasWalletInteraction = clickPatterns.some(pattern => 
      pattern.includes('wallet') || pattern.includes('connect')
    )
    
    if (hasWalletInteraction) {
      globalPreloader.prefetchRoute('/tip')
      preloadRouteResources('/tip')
    }
  }

  private analyzeNavigationPatterns(): void {
    // Analyze localStorage for navigation patterns
    try {
      const navigationHistory = JSON.parse(
        localStorage.getItem('navigation-history') || '[]'
      )

      // Find common navigation sequences
      const sequences = this.findCommonSequences(navigationHistory)
      
      // Preload likely next pages
      sequences.forEach(sequence => {
        if (sequence.probability > 0.7) {
          globalPreloader.prefetchRoute(sequence.nextRoute)
        }
      })
    } catch (error) {
      console.debug('Failed to analyze navigation patterns:', error)
    }
  }

  private findCommonSequences(history: string[]): Array<{
    sequence: string[]
    nextRoute: string
    probability: number
  }> {
    // Simple sequence analysis - can be enhanced
    const sequences: Array<{ sequence: string[]; nextRoute: string; probability: number }> = []
    
    // Look for 2-step sequences
    for (let i = 0; i < history.length - 2; i++) {
      const sequence = [history[i], history[i + 1]]
      const nextRoute = history[i + 2]
      
      // Calculate probability based on frequency
      const occurrences = this.countSequenceOccurrences(history, [...sequence, nextRoute])
      const totalFromSequence = this.countSequenceOccurrences(history, sequence)
      
      const probability = totalFromSequence > 0 ? occurrences / totalFromSequence : 0
      
      if (probability > 0.5) {
        sequences.push({ sequence, nextRoute, probability })
      }
    }

    return sequences
  }

  private countSequenceOccurrences(array: string[], sequence: string[]): number {
    let count = 0
    for (let i = 0; i <= array.length - sequence.length; i++) {
      if (sequence.every((item, index) => array[i + index] === item)) {
        count++
      }
    }
    return count
  }
}

// Global advanced optimizer instance
export const advancedResourceOptimizer = new AdvancedResourceOptimizer()

// Initialize optimization on page load
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    // Setup predictive preloading after page load
    setTimeout(() => {
      advancedResourceOptimizer.setupPredictivePreloading()
    }, 2000)

    // Check resource budget
    setTimeout(() => {
      const budget = advancedResourceOptimizer.checkResourceBudget()
      console.debug('Resource Budget Status:', budget)
    }, 3000)
  })
}