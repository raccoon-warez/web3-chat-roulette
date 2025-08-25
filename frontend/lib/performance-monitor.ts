'use client'

import { getCLS, getFID, getFCP, getLCP, getTTFB, Metric, onINP } from 'web-vitals'
import { useState, useEffect } from 'react'

// Performance metrics interface
export interface PerformanceMetrics {
  // Core Web Vitals
  LCP?: number // Largest Contentful Paint
  FID?: number // First Input Delay  
  CLS?: number // Cumulative Layout Shift
  INP?: number // Interaction to Next Paint
  
  // Other important metrics
  FCP?: number // First Contentful Paint
  TTFB?: number // Time to First Byte
  
  // Custom metrics
  customMetrics?: Record<string, number>
  
  // Page info
  url: string
  timestamp: number
  userAgent: string
  connectionType?: string
}

// Performance analytics class
class PerformanceAnalytics {
  private metrics: Partial<PerformanceMetrics> = {}
  private observers: PerformanceObserver[] = []
  private onMetricCallback?: (metric: Metric) => void

  constructor() {
    if (typeof window !== 'undefined') {
      this.initializeWebVitals()
      this.initializeCustomMetrics()
      this.initializeNavigationTiming()
      this.initializeResourceTiming()
    }
  }

  // Initialize Web Vitals tracking
  private initializeWebVitals(): void {
    const handleMetric = (metric: Metric) => {
      this.metrics[metric.name as keyof PerformanceMetrics] = metric.value
      this.onMetricCallback?.(metric)
      
      // Send to analytics endpoint
      this.sendMetric(metric)
    }

    // Track Core Web Vitals
    getCLS(handleMetric)
    getFID(handleMetric)
    getFCP(handleMetric)
    getLCP(handleMetric)
    getTTFB(handleMetric)
    
    // Track INP (newer metric)
    onINP(handleMetric)
  }

  // Initialize custom performance metrics
  private initializeCustomMetrics(): void {
    // Track custom timing marks
    if ('performance' in window && 'mark' in performance) {
      // Navigation start to DOM ready
      window.addEventListener('DOMContentLoaded', () => {
        performance.mark('dom-ready')
        this.measureCustomMetric('dom-ready-time', 'navigationStart', 'dom-ready')
      })

      // Navigation start to load complete
      window.addEventListener('load', () => {
        performance.mark('load-complete')
        this.measureCustomMetric('load-complete-time', 'navigationStart', 'load-complete')
      })

      // Track React hydration if available
      if ('PerformanceObserver' in window) {
        const observer = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry) => {
            if (entry.name === 'Next.js-hydration') {
              this.metrics.customMetrics = {
                ...this.metrics.customMetrics,
                hydrationTime: entry.duration,
              }
            }
          })
        })
        
        observer.observe({ entryTypes: ['measure'] })
        this.observers.push(observer)
      }
    }
  }

  // Initialize Navigation Timing API
  private initializeNavigationTiming(): void {
    if ('performance' in window && 'getEntriesByType' in performance) {
      window.addEventListener('load', () => {
        setTimeout(() => {
          const navTiming = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
          if (navTiming) {
            this.metrics.customMetrics = {
              ...this.metrics.customMetrics,
              dnsLookup: navTiming.domainLookupEnd - navTiming.domainLookupStart,
              tcpConnect: navTiming.connectEnd - navTiming.connectStart,
              sslTime: navTiming.connectEnd - navTiming.secureConnectionStart,
              domInteractive: navTiming.domInteractive - navTiming.navigationStart,
              domComplete: navTiming.domComplete - navTiming.navigationStart,
              loadEventTime: navTiming.loadEventEnd - navTiming.loadEventStart,
            }
          }
        }, 0)
      })
    }
  }

  // Initialize Resource Timing API
  private initializeResourceTiming(): void {
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        const resources = list.getEntries()
        const resourceSummary = this.analyzeResources(resources as PerformanceResourceTiming[])
        
        this.metrics.customMetrics = {
          ...this.metrics.customMetrics,
          ...resourceSummary,
        }
      })
      
      observer.observe({ entryTypes: ['resource'] })
      this.observers.push(observer)
    }
  }

  // Analyze resource loading performance
  private analyzeResources(resources: PerformanceResourceTiming[]) {
    const summary = {
      totalResources: resources.length,
      totalTransferSize: 0,
      totalEncodedSize: 0,
      slowestResource: 0,
      averageResourceTime: 0,
      resourcesByType: {} as Record<string, number>,
    }

    resources.forEach((resource) => {
      summary.totalTransferSize += resource.transferSize || 0
      summary.totalEncodedSize += resource.encodedBodySize || 0
      summary.slowestResource = Math.max(summary.slowestResource, resource.duration)
      
      // Count by resource type
      const type = this.getResourceType(resource.name)
      summary.resourcesByType[type] = (summary.resourcesByType[type] || 0) + 1
    })

    summary.averageResourceTime = resources.reduce((sum, r) => sum + r.duration, 0) / resources.length

    return summary
  }

  // Get resource type from URL
  private getResourceType(url: string): string {
    if (url.includes('.js')) return 'script'
    if (url.includes('.css')) return 'stylesheet' 
    if (url.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i)) return 'image'
    if (url.includes('.woff') || url.includes('.ttf')) return 'font'
    return 'other'
  }

  // Measure custom metric between two marks
  private measureCustomMetric(name: string, startMark: string, endMark: string): void {
    try {
      performance.measure(name, startMark, endMark)
      const measure = performance.getEntriesByName(name, 'measure')[0]
      if (measure) {
        this.metrics.customMetrics = {
          ...this.metrics.customMetrics,
          [name]: measure.duration,
        }
      }
    } catch (error) {
      console.warn(`Failed to measure ${name}:`, error)
    }
  }

  // Send metric to analytics endpoint
  private async sendMetric(metric: Metric): Promise<void> {
    try {
      // Only send in production
      if (process.env.NODE_ENV !== 'production') return

      const body = JSON.stringify({
        metric: metric.name,
        value: metric.value,
        id: metric.id,
        url: window.location.pathname,
        timestamp: Date.now(),
        userAgent: navigator.userAgent,
        connectionType: (navigator as any)?.connection?.effectiveType || 'unknown',
      })

      // Use sendBeacon for reliability, fallback to fetch
      if ('sendBeacon' in navigator) {
        navigator.sendBeacon('/api/analytics/vitals', body)
      } else {
        fetch('/api/analytics/vitals', {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
          keepalive: true,
        }).catch(() => {}) // Ignore errors for analytics
      }
    } catch (error) {
      // Silently fail for analytics
      console.debug('Analytics error:', error)
    }
  }

  // Get all collected metrics
  getMetrics(): PerformanceMetrics {
    return {
      ...this.metrics,
      url: window.location.pathname,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      connectionType: (navigator as any)?.connection?.effectiveType || 'unknown',
    } as PerformanceMetrics
  }

  // Set callback for real-time metric updates
  onMetric(callback: (metric: Metric) => void): void {
    this.onMetricCallback = callback
  }

  // Clean up observers
  cleanup(): void {
    this.observers.forEach(observer => observer.disconnect())
    this.observers = []
  }

  // Performance budget checker
  checkPerformanceBudget(): { passed: boolean; violations: string[] } {
    const budget = {
      LCP: 2500, // 2.5s
      FID: 100,  // 100ms
      CLS: 0.1,  // 0.1
      FCP: 1800, // 1.8s
      TTFB: 600, // 600ms
    }

    const violations: string[] = []
    
    Object.entries(budget).forEach(([metric, threshold]) => {
      const value = this.metrics[metric as keyof PerformanceMetrics] as number
      if (value !== undefined && value > threshold) {
        violations.push(`${metric}: ${value} > ${threshold}`)
      }
    })

    return {
      passed: violations.length === 0,
      violations,
    }
  }
}

// React hook for performance monitoring
export function usePerformanceMonitor() {
  const [analytics] = useState(() => new PerformanceAnalytics())
  const [metrics, setMetrics] = useState<Partial<PerformanceMetrics>>({})

  useEffect(() => {
    const handleMetric = (metric: Metric) => {
      setMetrics(prev => ({
        ...prev,
        [metric.name]: metric.value,
      }))
    }

    analytics.onMetric(handleMetric)

    return () => {
      analytics.cleanup()
    }
  }, [analytics])

  return {
    metrics,
    getFullMetrics: () => analytics.getMetrics(),
    checkBudget: () => analytics.checkPerformanceBudget(),
  }
}

// Performance monitoring component
export function PerformanceMonitor({ children }: { children: React.ReactNode }) {
  const { metrics, checkBudget } = usePerformanceMonitor()

  // Log performance violations in development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      setTimeout(() => {
        const budget = checkBudget()
        if (!budget.passed) {
          console.group('🚨 Performance Budget Violations')
          budget.violations.forEach(violation => console.warn(violation))
          console.groupEnd()
        }
      }, 5000) // Check after 5 seconds
    }
  }, [checkBudget])

  return <>{children}</>
}

// Global analytics instance
export const performanceAnalytics = new PerformanceAnalytics()

// Advanced performance monitoring utilities
export const performanceUtils = {
  // Mark start of a custom operation
  markStart: (name: string) => {
    if ('performance' in window && 'mark' in performance) {
      performance.mark(`${name}-start`)
    }
  },

  // Mark end of a custom operation and measure duration
  markEnd: (name: string) => {
    if ('performance' in window && 'mark' in performance) {
      performance.mark(`${name}-end`)
      try {
        performance.measure(name, `${name}-start`, `${name}-end`)
        const measure = performance.getEntriesByName(name, 'measure')[0]
        return measure?.duration || 0
      } catch {
        return 0
      }
    }
    return 0
  },

  // Measure a function execution
  measureAsync: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    performanceUtils.markStart(name)
    try {
      const result = await fn()
      const duration = performanceUtils.markEnd(name)
      console.debug(`${name} took ${duration.toFixed(2)}ms`)
      return result
    } catch (error) {
      performanceUtils.markEnd(name)
      throw error
    }
  },

  // Measure synchronous function
  measure: <T>(name: string, fn: () => T): T => {
    performanceUtils.markStart(name)
    try {
      const result = fn()
      const duration = performanceUtils.markEnd(name)
      console.debug(`${name} took ${duration.toFixed(2)}ms`)
      return result
    } catch (error) {
      performanceUtils.markEnd(name)
      throw error
    }
  },

  // Advanced timing utilities
  measureComponent: <P>(
    Component: React.ComponentType<P>,
    componentName: string
  ): React.ComponentType<P> => {
    return (props: P) => {
      const startTime = performance.now()
      
      React.useEffect(() => {
        const endTime = performance.now()
        const renderTime = endTime - startTime
        
        console.debug(`${componentName} render took ${renderTime.toFixed(2)}ms`)
        
        // Report to analytics if enabled
        if (process.env.NODE_ENV === 'production') {
          performanceAnalytics.reportCustomMetric(`component-render-${componentName}`, renderTime)
        }
      })

      return React.createElement(Component, props)
    }
  },

  // Measure hook performance
  measureHook: <T>(hookName: string, hookFn: () => T): T => {
    const startTime = performance.now()
    const result = hookFn()
    const endTime = performance.now()
    
    console.debug(`Hook ${hookName} took ${(endTime - startTime).toFixed(2)}ms`)
    return result
  }
}

// Enhanced Web Vitals tracking with detailed breakdowns
export class EnhancedWebVitalsTracker {
  private vitalsData: Map<string, Metric[]> = new Map()
  private thresholds = {
    LCP: { good: 2500, poor: 4000 },
    FID: { good: 100, poor: 300 },
    CLS: { good: 0.1, poor: 0.25 },
    FCP: { good: 1800, poor: 3000 },
    TTFB: { good: 800, poor: 1800 },
    INP: { good: 200, poor: 500 }
  }

  private observers: PerformanceObserver[] = []

  constructor() {
    if (typeof window !== 'undefined') {
      this.initializeTracking()
    }
  }

  private initializeTracking(): void {
    // Track all Web Vitals
    this.trackWebVitals()
    
    // Track long tasks
    this.trackLongTasks()
    
    // Track layout shifts in detail
    this.trackDetailedCLS()
    
    // Track user interactions
    this.trackUserInteractions()
    
    // Track memory usage
    this.trackMemoryUsage()
  }

  private trackWebVitals(): void {
    const handleMetric = (metric: Metric) => {
      const existing = this.vitalsData.get(metric.name) || []
      existing.push(metric)
      this.vitalsData.set(metric.name, existing)

      // Analyze metric quality
      const quality = this.analyzeMetricQuality(metric)
      
      // Report detailed metric
      this.reportDetailedMetric(metric, quality)
    }

    // Import and track all vitals
    getCLS(handleMetric)
    getFID(handleMetric)
    getFCP(handleMetric)
    getLCP(handleMetric)
    getTTFB(handleMetric)
    onINP(handleMetric)
  }

  private trackLongTasks(): void {
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry: any) => {
          console.warn(`Long task detected: ${entry.duration.toFixed(2)}ms`)
          
          this.reportCustomMetric('long-task', entry.duration)
        })
      })

      try {
        observer.observe({ entryTypes: ['longtask'] })
        this.observers.push(observer)
      } catch (error) {
        // longtask not supported in all browsers
      }
    }
  }

  private trackDetailedCLS(): void {
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry: any) => {
          if (entry.value > 0) {
            console.debug(`Layout shift detected: ${entry.value}`, {
              sources: entry.sources?.map((source: any) => ({
                element: source.node?.tagName || 'unknown',
                rect: source.currentRect
              }))
            })
          }
        })
      })

      try {
        observer.observe({ type: 'layout-shift', buffered: true })
        this.observers.push(observer)
      } catch (error) {
        // layout-shift not supported in all browsers
      }
    }
  }

  private trackUserInteractions(): void {
    let interactionCount = 0
    const interactionTypes = ['click', 'keydown', 'scroll']

    interactionTypes.forEach(type => {
      document.addEventListener(type, () => {
        interactionCount++
        
        // Report interaction metrics periodically
        if (interactionCount % 10 === 0) {
          this.reportCustomMetric('user-interactions', interactionCount)
        }
      }, { passive: true })
    })
  }

  private trackMemoryUsage(): void {
    if ('memory' in performance) {
      const reportMemory = () => {
        const memInfo = (performance as any).memory
        
        this.reportCustomMetric('memory-used', memInfo.usedJSHeapSize)
        this.reportCustomMetric('memory-total', memInfo.totalJSHeapSize)
        this.reportCustomMetric('memory-limit', memInfo.jsHeapSizeLimit)
      }

      // Report memory usage every 30 seconds
      setInterval(reportMemory, 30000)
      
      // Report on page visibility change
      document.addEventListener('visibilitychange', reportMemory)
    }
  }

  private analyzeMetricQuality(metric: Metric): 'good' | 'needs-improvement' | 'poor' {
    const thresholds = this.thresholds[metric.name as keyof typeof this.thresholds]
    if (!thresholds) return 'good'

    if (metric.value <= thresholds.good) return 'good'
    if (metric.value <= thresholds.poor) return 'needs-improvement'
    return 'poor'
  }

  private reportDetailedMetric(metric: Metric, quality: string): void {
    const report = {
      name: metric.name,
      value: metric.value,
      id: metric.id,
      quality,
      url: window.location.pathname,
      timestamp: Date.now(),
      userAgent: navigator.userAgent,
      connection: (navigator as any)?.connection ? {
        effectiveType: (navigator as any).connection.effectiveType,
        downlink: (navigator as any).connection.downlink,
        rtt: (navigator as any).connection.rtt
      } : null,
      deviceMemory: (navigator as any)?.deviceMemory || null,
      hardwareConcurrency: navigator.hardwareConcurrency || null
    }

    // Send to analytics endpoint
    this.sendToAnalytics('web-vitals-detailed', report)
  }

  private reportCustomMetric(name: string, value: number): void {
    const report = {
      name,
      value,
      url: window.location.pathname,
      timestamp: Date.now()
    }

    this.sendToAnalytics('custom-metrics', report)
  }

  private async sendToAnalytics(endpoint: string, data: any): Promise<void> {
    try {
      if (process.env.NODE_ENV !== 'production') return

      const body = JSON.stringify(data)

      if ('sendBeacon' in navigator) {
        navigator.sendBeacon(`/api/analytics/${endpoint}`, body)
      } else {
        fetch(`/api/analytics/${endpoint}`, {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
          keepalive: true
        }).catch(() => {}) // Ignore analytics errors
      }
    } catch (error) {
      console.debug('Analytics error:', error)
    }
  }

  // Get comprehensive performance report
  getPerformanceReport(): {
    webVitals: Record<string, Metric[]>
    recommendations: string[]
    score: number
  } {
    const webVitals = Object.fromEntries(this.vitalsData)
    const recommendations: string[] = []
    let totalScore = 0
    let metricCount = 0

    // Analyze each metric
    Object.entries(webVitals).forEach(([name, metrics]) => {
      const latestMetric = metrics[metrics.length - 1]
      const quality = this.analyzeMetricQuality(latestMetric)
      
      // Calculate score (100 for good, 50 for needs improvement, 0 for poor)
      const score = quality === 'good' ? 100 : quality === 'needs-improvement' ? 50 : 0
      totalScore += score
      metricCount++

      // Generate recommendations
      if (quality === 'poor') {
        recommendations.push(...this.getRecommendationsForMetric(name, latestMetric.value))
      }
    })

    const finalScore = metricCount > 0 ? Math.round(totalScore / metricCount) : 100

    return {
      webVitals,
      recommendations,
      score: finalScore
    }
  }

  private getRecommendationsForMetric(name: string, value: number): string[] {
    const recommendations: Record<string, string[]> = {
      LCP: [
        'Optimize server response times',
        'Use resource preloading for critical assets',
        'Optimize images and use modern formats',
        'Remove unused JavaScript and CSS'
      ],
      FID: [
        'Reduce JavaScript execution time',
        'Break up long tasks',
        'Use web workers for heavy computations',
        'Optimize third-party scripts'
      ],
      CLS: [
        'Set size attributes on images and videos',
        'Reserve space for dynamic content',
        'Avoid inserting content above existing content',
        'Use transform animations instead of layout changes'
      ],
      FCP: [
        'Optimize critical rendering path',
        'Minimize render-blocking resources',
        'Use resource preloading',
        'Optimize server response times'
      ],
      TTFB: [
        'Optimize server processing time',
        'Use CDN for static assets',
        'Implement proper caching strategies',
        'Optimize database queries'
      ]
    }

    return recommendations[name] || []
  }

  // Cleanup observers
  cleanup(): void {
    this.observers.forEach(observer => observer.disconnect())
    this.observers = []
  }
}

// Performance budget monitoring
export class PerformanceBudgetMonitor {
  private budgets = {
    // Time-based budgets (ms)
    LCP: 2500,
    FID: 100,
    FCP: 1800,
    TTFB: 800,
    
    // Resource budgets (bytes)
    totalJavaScript: 300 * 1024, // 300KB
    totalCSS: 100 * 1024, // 100KB
    totalImages: 1000 * 1024, // 1MB
    totalFonts: 200 * 1024, // 200KB
    
    // Performance score budget
    lighthouseScore: 90
  }

  checkBudgets(): {
    passed: boolean
    violations: Array<{
      metric: string
      budget: number
      actual: number
      impact: 'high' | 'medium' | 'low'
    }>
  } {
    const violations: Array<{
      metric: string
      budget: number
      actual: number
      impact: 'high' | 'medium' | 'low'
    }> = []

    // Check Web Vitals budgets
    const vitalsData = enhancedWebVitalsTracker.getPerformanceReport()
    Object.entries(vitalsData.webVitals).forEach(([name, metrics]) => {
      const budget = this.budgets[name as keyof typeof this.budgets] as number
      if (budget && metrics.length > 0) {
        const actual = metrics[metrics.length - 1].value
        if (actual > budget) {
          violations.push({
            metric: name,
            budget,
            actual,
            impact: this.getImpactLevel(name, actual, budget)
          })
        }
      }
    })

    // Check resource budgets
    const resourceSizes = this.getResourceSizes()
    Object.entries(resourceSizes).forEach(([type, size]) => {
      const budget = this.budgets[type as keyof typeof this.budgets] as number
      if (budget && size > budget) {
        violations.push({
          metric: type,
          budget,
          actual: size,
          impact: this.getImpactLevel(type, size, budget)
        })
      }
    })

    return {
      passed: violations.length === 0,
      violations
    }
  }

  private getResourceSizes(): Record<string, number> {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    const sizes = {
      totalJavaScript: 0,
      totalCSS: 0,
      totalImages: 0,
      totalFonts: 0
    }

    resources.forEach(resource => {
      const size = resource.transferSize || 0
      const name = resource.name.toLowerCase()

      if (name.includes('.js')) {
        sizes.totalJavaScript += size
      } else if (name.includes('.css')) {
        sizes.totalCSS += size
      } else if (/\.(jpg|jpeg|png|gif|webp|svg)/.test(name)) {
        sizes.totalImages += size
      } else if (/\.(woff|woff2|ttf|eot)/.test(name)) {
        sizes.totalFonts += size
      }
    })

    return sizes
  }

  private getImpactLevel(metric: string, actual: number, budget: number): 'high' | 'medium' | 'low' {
    const ratio = actual / budget

    if (ratio > 2) return 'high'
    if (ratio > 1.5) return 'medium'
    return 'low'
  }

  setBudget(metric: string, value: number): void {
    (this.budgets as any)[metric] = value
  }

  getBudget(metric: string): number {
    return (this.budgets as any)[metric] || 0
  }
}

// Global instances
export const enhancedWebVitalsTracker = new EnhancedWebVitalsTracker()
export const performanceBudgetMonitor = new PerformanceBudgetMonitor()