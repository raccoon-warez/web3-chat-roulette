'use client'

// Bundle size analyzer and optimizer utilities
export class BundleAnalyzer {
  private performanceEntries: PerformanceEntry[] = []
  private resourceTimings: PerformanceResourceTiming[] = []

  constructor() {
    if (typeof window !== 'undefined') {
      this.initializeTracking()
    }
  }

  private initializeTracking(): void {
    // Track resource loading
    if ('PerformanceObserver' in window) {
      const observer = new PerformanceObserver((list) => {
        const entries = list.getEntries()
        this.performanceEntries.push(...entries)
        
        // Filter resource timings
        const resourceEntries = entries.filter(
          entry => entry.entryType === 'resource'
        ) as PerformanceResourceTiming[]
        
        this.resourceTimings.push(...resourceEntries)
      })

      observer.observe({ entryTypes: ['resource', 'navigation', 'measure'] })
    }
  }

  // Analyze JavaScript bundle sizes
  getJavaScriptBundles(): Array<{
    name: string
    size: number
    loadTime: number
    type: 'main' | 'chunk' | 'vendor' | 'runtime'
    cached: boolean
  }> {
    return this.resourceTimings
      .filter(entry => entry.name.includes('.js'))
      .map(entry => {
        const url = new URL(entry.name)
        const filename = url.pathname.split('/').pop() || 'unknown'
        
        let type: 'main' | 'chunk' | 'vendor' | 'runtime' = 'chunk'
        
        if (filename.includes('main')) type = 'main'
        else if (filename.includes('vendor')) type = 'vendor'
        else if (filename.includes('runtime')) type = 'runtime'
        
        return {
          name: filename,
          size: entry.transferSize || entry.encodedBodySize || 0,
          loadTime: entry.duration,
          type,
          cached: entry.transferSize === 0 && entry.encodedBodySize > 0
        }
      })
      .sort((a, b) => b.size - a.size)
  }

  // Get bundle loading insights
  getBundleInsights(): {
    totalSize: number
    totalLoadTime: number
    largestBundle: string
    slowestBundle: string
    cacheHitRatio: number
    recommendations: string[]
  } {
    const bundles = this.getJavaScriptBundles()
    const totalSize = bundles.reduce((sum, b) => sum + b.size, 0)
    const totalLoadTime = bundles.reduce((sum, b) => sum + b.loadTime, 0)
    const cachedBundles = bundles.filter(b => b.cached).length
    
    const largestBundle = bundles[0]?.name || 'none'
    const slowestBundle = bundles
      .sort((a, b) => b.loadTime - a.loadTime)[0]?.name || 'none'
    
    const recommendations: string[] = []
    
    // Generate recommendations
    if (totalSize > 1000000) { // > 1MB
      recommendations.push('Total bundle size exceeds 1MB. Consider code splitting.')
    }
    
    if (bundles.some(b => b.size > 500000)) { // > 500KB
      recommendations.push('Large bundles detected. Implement route-based code splitting.')
    }
    
    if (cachedBundles / bundles.length < 0.5) {
      recommendations.push('Low cache hit ratio. Review caching headers and versioning.')
    }
    
    if (bundles.some(b => b.loadTime > 1000)) {
      recommendations.push('Slow bundle loading detected. Consider preloading critical chunks.')
    }

    return {
      totalSize,
      totalLoadTime,
      largestBundle,
      slowestBundle,
      cacheHitRatio: cachedBundles / bundles.length,
      recommendations
    }
  }

  // Log bundle analysis to console (development only)
  logAnalysis(): void {
    if (process.env.NODE_ENV === 'development') {
      const bundles = this.getJavaScriptBundles()
      const insights = this.getBundleInsights()
      
      console.group('📦 Bundle Analysis')
      console.table(bundles)
      console.log('Insights:', insights)
      console.groupEnd()
    }
  }
}

// Tree shaking utilities
export const treeShakingUtils = {
  // Mark unused exports for elimination
  markUnused: (exportName: string, modulePath: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`Unused export detected: ${exportName} from ${modulePath}`)
    }
  },

  // Check if module is side-effect free
  isSideEffectFree: (modulePath: string): boolean => {
    const sideEffectFreePatterns = [
      /lodash/,
      /date-fns/,
      /ramda/,
      /utility libraries/
    ]
    
    return sideEffectFreePatterns.some(pattern => pattern.test(modulePath))
  },

  // Analyze import usage
  analyzeImports: (imports: Record<string, boolean>) => {
    const used = Object.values(imports).filter(Boolean).length
    const total = Object.keys(imports).length
    const unusedRatio = (total - used) / total
    
    return {
      used,
      total,
      unusedRatio,
      recommendation: unusedRatio > 0.3 
        ? 'High unused import ratio. Review and remove unused imports.'
        : 'Good import utilization.'
    }
  }
}

// Module optimization strategies
export const moduleOptimizer = {
  // Dynamic import with chunk naming
  dynamicImportWithChunk: (
    importFn: () => Promise<any>,
    chunkName: string,
    priority: 'low' | 'medium' | 'high' = 'medium'
  ) => {
    const importWithMetadata = () => importFn()
    
    // Add webpack magic comments
    ;(importWithMetadata as any).webpackChunkName = chunkName
    ;(importWithMetadata as any).webpackPrefetch = priority === 'low'
    ;(importWithMetadata as any).webpackPreload = priority === 'high'
    
    return importWithMetadata
  },

  // Selective imports to reduce bundle size
  createSelectiveImporter: <T extends Record<string, any>>(
    modulePath: string,
    allowedExports: (keyof T)[]
  ) => {
    return async (): Promise<Partial<T>> => {
      const module = await import(modulePath)
      const selective: Partial<T> = {}
      
      allowedExports.forEach(exportName => {
        if (module[exportName]) {
          selective[exportName] = module[exportName]
        }
      })
      
      return selective
    }
  },

  // Bundle size budget checker
  checkBudget: (
    currentSize: number,
    budget: number,
    bundleName: string
  ): {
    passed: boolean
    usage: number
    recommendation: string
  } => {
    const usage = currentSize / budget
    const passed = usage <= 1
    
    let recommendation = ''
    if (usage > 1.2) {
      recommendation = `${bundleName} significantly exceeds budget. Urgent optimization needed.`
    } else if (usage > 1) {
      recommendation = `${bundleName} exceeds budget. Consider code splitting or removing unused code.`
    } else if (usage > 0.8) {
      recommendation = `${bundleName} approaching budget limit. Monitor closely.`
    } else {
      recommendation = `${bundleName} within budget limits.`
    }
    
    return { passed, usage, recommendation }
  }
}

// Webpack bundle analyzer integration
export const webpackAnalyzer = {
  // Generate bundle stats for analysis
  generateStats: () => {
    if (typeof window !== 'undefined' && (window as any).__webpack_require__) {
      const webpack = (window as any).__webpack_require__
      
      return {
        chunks: webpack.cache || {},
        modules: Object.keys(webpack.modules || {}),
        assets: performance.getEntriesByType('resource')
          .filter(entry => entry.name.includes('.js') || entry.name.includes('.css'))
          .map(entry => ({
            name: entry.name,
            size: (entry as PerformanceResourceTiming).transferSize || 0
          }))
      }
    }
    
    return null
  },

  // Analyze chunk dependencies
  analyzeChunkDependencies: () => {
    const stats = webpackAnalyzer.generateStats()
    if (!stats) return null
    
    // This would typically require webpack stats.json
    // For now, return basic analysis
    return {
      circularDependencies: [],
      duplicateModules: [],
      unusedChunks: []
    }
  }
}

// Bundle optimization recommendations
export const optimizationRecommendations = {
  // Generate recommendations based on bundle analysis
  generate: (bundleData: {
    totalSize: number
    chunks: Array<{ name: string; size: number }>
    loadTime: number
  }): string[] => {
    const recommendations: string[] = []
    
    // Size-based recommendations
    if (bundleData.totalSize > 1000000) {
      recommendations.push('Implement route-based code splitting to reduce initial bundle size')
    }
    
    if (bundleData.totalSize > 500000) {
      recommendations.push('Consider lazy loading non-critical components')
    }
    
    // Chunk-based recommendations
    const largeChunks = bundleData.chunks.filter(chunk => chunk.size > 200000)
    if (largeChunks.length > 0) {
      recommendations.push(`Split large chunks: ${largeChunks.map(c => c.name).join(', ')}`)
    }
    
    // Load time recommendations
    if (bundleData.loadTime > 3000) {
      recommendations.push('Optimize bundle loading with prefetching and preloading')
    }
    
    // General recommendations
    recommendations.push('Use webpack-bundle-analyzer for detailed analysis')
    recommendations.push('Implement tree shaking for unused code elimination')
    recommendations.push('Consider using dynamic imports for vendor libraries')
    
    return recommendations
  },

  // Priority-based recommendations
  prioritize: (recommendations: string[]): Array<{
    recommendation: string
    priority: 'high' | 'medium' | 'low'
    impact: 'high' | 'medium' | 'low'
  }> => {
    return recommendations.map(rec => {
      let priority: 'high' | 'medium' | 'low' = 'medium'
      let impact: 'high' | 'medium' | 'low' = 'medium'
      
      if (rec.includes('route-based') || rec.includes('large chunks')) {
        priority = 'high'
        impact = 'high'
      } else if (rec.includes('lazy loading') || rec.includes('prefetching')) {
        priority = 'medium'
        impact = 'high'
      } else if (rec.includes('tree shaking') || rec.includes('dynamic imports')) {
        priority = 'low'
        impact = 'medium'
      }
      
      return { recommendation: rec, priority, impact }
    })
  }
}

// Global bundle analyzer instance
export const bundleAnalyzer = new BundleAnalyzer()

// Initialize bundle analysis logging in development
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // Log analysis after page load
  window.addEventListener('load', () => {
    setTimeout(() => {
      bundleAnalyzer.logAnalysis()
    }, 2000)
  })
}