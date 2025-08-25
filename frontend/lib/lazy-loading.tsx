'use client'

import { lazy, Suspense, ComponentType, ReactNode, useState, useEffect, useRef } from 'react'
import { ErrorBoundary } from 'react-error-boundary'

// Loading fallback components
export const LoadingSpinner = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
  const sizeClasses = {
    sm: 'h-6 w-6',
    md: 'h-12 w-12',
    lg: 'h-16 w-16'
  }

  return (
    <div className="flex items-center justify-center p-4">
      <div className={`animate-spin rounded-full border-b-2 border-blue-500 ${sizeClasses[size]}`} />
    </div>
  )
}

export const LoadingCard = ({ title }: { title?: string }) => (
  <div className="bg-white rounded-lg shadow-md p-6 animate-pulse">
    <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
    <div className="space-y-3">
      <div className="h-3 bg-gray-200 rounded"></div>
      <div className="h-3 bg-gray-200 rounded w-5/6"></div>
    </div>
    {title && <div className="text-center text-gray-500 mt-4">{title}</div>}
  </div>
)

export const LoadingPage = ({ title }: { title?: string }) => (
  <div className="flex flex-col items-center justify-center min-h-screen">
    <LoadingSpinner size="lg" />
    <p className="mt-4 text-gray-600">{title || 'Loading...'}</p>
  </div>
)

// Error fallback component
const ErrorFallback = ({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) => (
  <div className="flex flex-col items-center justify-center p-8 bg-red-50 rounded-lg border border-red-200">
    <div className="text-red-600 mb-4">
      <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 19c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
    </div>
    <h3 className="text-lg font-semibold text-gray-900 mb-2">Something went wrong</h3>
    <p className="text-gray-600 text-center mb-4">{error.message}</p>
    <button
      onClick={resetErrorBoundary}
      className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
    >
      Try again
    </button>
  </div>
)

// HOC for lazy loading with error boundary and loading states
export function withLazyLoading<T extends ComponentType<any>>(
  LazyComponent: ComponentType<T>,
  options: {
    fallback?: ReactNode
    errorFallback?: ComponentType<any>
    loadingTitle?: string
  } = {}
) {
  const WrappedComponent = (props: React.ComponentProps<T>) => (
    <ErrorBoundary
      FallbackComponent={options.errorFallback || ErrorFallback}
      onReset={() => window.location.reload()}
    >
      <Suspense fallback={options.fallback || <LoadingPage title={options.loadingTitle} />}>
        <LazyComponent {...props} />
      </Suspense>
    </ErrorBoundary>
  )

  WrappedComponent.displayName = `withLazyLoading(${LazyComponent.displayName || LazyComponent.name})`
  
  return WrappedComponent
}

// Utility for creating route-based lazy components
export const createLazyRoute = (
  importFn: () => Promise<{ default: ComponentType<any> }>,
  loadingTitle?: string
) => {
  const LazyComponent = lazy(importFn)
  return withLazyLoading(LazyComponent, { loadingTitle })
}

// Preload utility for eager loading
export const preloadComponent = (importFn: () => Promise<{ default: ComponentType<any> }>) => {
  const componentImport = importFn()
  return componentImport
}

// Resource preloader utility
export const preloadResources = {
  image: (src: string) => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = src
    document.head.appendChild(link)
  },
  
  script: (src: string) => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'script'
    link.href = src
    document.head.appendChild(link)
  },
  
  font: (src: string, type = 'font/woff2') => {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'font'
    link.type = type
    link.href = src
    link.crossOrigin = 'anonymous'
    document.head.appendChild(link)
  }
}

// Intersection Observer for lazy loading on scroll
export const useLazyLoading = (threshold = 0.1) => {
  const [isVisible, setIsVisible] = useState(false)
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { threshold }
    )

    if (ref.current) {
      observer.observe(ref.current)
    }

    return () => observer.disconnect()
  }, [threshold])

  return { ref, isVisible }
}

// Advanced dynamic import with retry logic
export const dynamicImport = <T = any>(
  importFn: () => Promise<T>,
  options: {
    retries?: number
    retryDelay?: number
    timeout?: number
  } = {}
): Promise<T> => {
  const { retries = 3, retryDelay = 1000, timeout = 10000 } = options

  const attemptImport = async (attempt: number): Promise<T> => {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Import timeout')), timeout)
    )

    try {
      return await Promise.race([importFn(), timeoutPromise])
    } catch (error) {
      if (attempt < retries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay * attempt))
        return attemptImport(attempt + 1)
      }
      throw error
    }
  }

  return attemptImport(1)
}

// Progressive loading with different strategies
export const createProgressiveComponent = <T extends ComponentType<any>>(
  strategies: {
    immediate?: () => Promise<{ default: T }>
    onIdle?: () => Promise<{ default: T }>
    onVisible?: () => Promise<{ default: T }>
    onInteraction?: () => Promise<{ default: T }>
  },
  fallback: ReactNode = <LoadingSpinner />
) => {
  return (props: React.ComponentProps<T>) => {
    const [Component, setComponent] = useState<T | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<Error | null>(null)
    const { ref, isVisible } = useLazyLoading()

    // Load immediately if strategy exists
    useEffect(() => {
      if (strategies.immediate) {
        setLoading(true)
        dynamicImport(strategies.immediate)
          .then(module => setComponent(() => module.default))
          .catch(setError)
          .finally(() => setLoading(false))
      }
    }, [])

    // Load on idle
    useEffect(() => {
      if (strategies.onIdle && !Component && !loading) {
        const loadOnIdle = () => {
          setLoading(true)
          dynamicImport(strategies.onIdle!)
            .then(module => setComponent(() => module.default))
            .catch(setError)
            .finally(() => setLoading(false))
        }

        if ('requestIdleCallback' in window) {
          requestIdleCallback(loadOnIdle)
        } else {
          setTimeout(loadOnIdle, 0)
        }
      }
    }, [Component, loading])

    // Load when visible
    useEffect(() => {
      if (strategies.onVisible && isVisible && !Component && !loading) {
        setLoading(true)
        dynamicImport(strategies.onVisible)
          .then(module => setComponent(() => module.default))
          .catch(setError)
          .finally(() => setLoading(false))
      }
    }, [isVisible, Component, loading])

    // Load on interaction
    const loadOnInteraction = () => {
      if (strategies.onInteraction && !Component && !loading) {
        setLoading(true)
        dynamicImport(strategies.onInteraction)
          .then(module => setComponent(() => module.default))
          .catch(setError)
          .finally(() => setLoading(false))
      }
    }

    if (error) {
      return <ErrorFallback error={error} resetErrorBoundary={() => setError(null)} />
    }

    if (!Component) {
      return (
        <div
          ref={ref}
          onMouseEnter={loadOnInteraction}
          onFocus={loadOnInteraction}
          onClick={loadOnInteraction}
        >
          {loading ? fallback : <div className="min-h-[100px]" />}
        </div>
      )
    }

    return <Component {...props} />
  }
}

// Bundle splitting utilities
export const bundleSplitters = {
  // Split by route
  byRoute: (routeName: string) => ({
    chunkName: `route-${routeName}`,
    webpackChunkName: `route-${routeName}`
  }),

  // Split by feature
  byFeature: (featureName: string) => ({
    chunkName: `feature-${featureName}`,
    webpackChunkName: `feature-${featureName}`
  }),

  // Split by vendor
  byVendor: (vendorName: string) => ({
    chunkName: `vendor-${vendorName}`,
    webpackChunkName: `vendor-${vendorName}`
  })
}

// Advanced lazy component factory
export const createAdvancedLazyComponent = <T extends ComponentType<any>>(
  importFn: () => Promise<{ default: T }>,
  options: {
    preload?: 'idle' | 'visible' | 'interaction'
    chunkName?: string
    fallback?: ReactNode
    errorBoundary?: boolean
    retries?: number
    timeout?: number
  } = {}
) => {
  const {
    preload,
    chunkName,
    fallback = <LoadingSpinner />,
    errorBoundary = true,
    retries = 3,
    timeout = 10000
  } = options

  const LazyComponent = lazy(() => dynamicImport(importFn, { retries, timeout }))

  // Add chunk name if provided
  if (chunkName) {
    (LazyComponent as any).webpackChunkName = chunkName
  }

  const WrappedComponent = (props: React.ComponentProps<T>) => {
    const suspenseContent = (
      <Suspense fallback={fallback}>
        <LazyComponent {...props} />
      </Suspense>
    )

    if (errorBoundary) {
      return (
        <ErrorBoundary FallbackComponent={ErrorFallback}>
          {suspenseContent}
        </ErrorBoundary>
      )
    }

    return suspenseContent
  }

  // Add preloading logic
  if (preload) {
    const PreloadWrapper = (props: React.ComponentProps<T>) => {
      const strategies = {
        [preload]: importFn
      } as any

      return createProgressiveComponent(strategies, fallback)(props)
    }

    return PreloadWrapper
  }

  return WrappedComponent
}