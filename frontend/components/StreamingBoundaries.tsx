'use client'

import { Suspense, ReactNode, ErrorBoundary } from 'react'
import { LoadingSpinner, LoadingCard, LoadingPage } from '@/lib/lazy-loading'

// Enhanced loading states with skeleton screens
export const SkeletonCard = ({ className = '', lines = 3 }: { className?: string; lines?: number }) => (
  <div className={`animate-pulse ${className}`}>
    <div className="bg-gray-200 dark:bg-gray-700 h-6 rounded mb-4 w-3/4"></div>
    {Array.from({ length: lines }).map((_, i) => (
      <div 
        key={i} 
        className={`bg-gray-200 dark:bg-gray-700 h-4 rounded mb-3 ${
          i === lines - 1 ? 'w-2/3' : 'w-full'
        }`}
      />
    ))}
  </div>
)

export const SkeletonAvatar = ({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) => {
  const sizeClasses = {
    sm: 'h-8 w-8',
    md: 'h-12 w-12',
    lg: 'h-16 w-16'
  }
  
  return (
    <div className={`${sizeClasses[size]} bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse`} />
  )
}

export const SkeletonButton = ({ width = 'w-24', height = 'h-10' }: { width?: string; height?: string }) => (
  <div className={`${width} ${height} bg-gray-200 dark:bg-gray-700 rounded animate-pulse`} />
)

export const SkeletonList = ({ items = 5 }: { items?: number }) => (
  <div className="space-y-4">
    {Array.from({ length: items }).map((_, i) => (
      <div key={i} className="flex items-center space-x-4">
        <SkeletonAvatar />
        <div className="flex-1">
          <SkeletonCard lines={2} />
        </div>
      </div>
    ))}
  </div>
)

// Streaming boundary components for different UI sections
interface StreamingBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  error?: ReactNode
  identifier?: string
}

export const ChatStreamingBoundary = ({ children, fallback, error, identifier = 'chat' }: StreamingBoundaryProps) => (
  <ErrorBoundary 
    fallback={error || <div className="p-4 text-red-500">Chat failed to load</div>}
  >
    <Suspense 
      fallback={fallback || (
        <div className="flex flex-col h-96 border rounded-lg p-4">
          <div className="flex-1 space-y-4 overflow-hidden">
            <SkeletonList items={3} />
          </div>
          <div className="flex mt-4 space-x-2">
            <div className="flex-1 h-10 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
            <SkeletonButton />
          </div>
        </div>
      )}
    >
      {children}
    </Suspense>
  </ErrorBoundary>
)

export const VideoStreamingBoundary = ({ children, fallback, error, identifier = 'video' }: StreamingBoundaryProps) => (
  <ErrorBoundary 
    fallback={error || <div className="p-4 text-red-500">Video failed to load</div>}
  >
    <Suspense 
      fallback={fallback || (
        <div className="relative aspect-video bg-gray-900 rounded-lg overflow-hidden">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <LoadingSpinner size="lg" />
              <p className="mt-4 text-white/70">Initializing video...</p>
            </div>
          </div>
          <div className="absolute bottom-4 left-4 right-4 flex justify-between items-center">
            <div className="flex space-x-2">
              <SkeletonButton width="w-10" height="h-10" />
              <SkeletonButton width="w-10" height="h-10" />
            </div>
            <SkeletonButton width="w-20" height="h-8" />
          </div>
        </div>
      )}
    >
      {children}
    </Suspense>
  </ErrorBoundary>
)

export const WalletStreamingBoundary = ({ children, fallback, error, identifier = 'wallet' }: StreamingBoundaryProps) => (
  <ErrorBoundary 
    fallback={error || <div className="p-4 text-red-500">Wallet connection failed</div>}
  >
    <Suspense 
      fallback={fallback || (
        <div className="flex items-center space-x-3 p-3 border rounded-lg">
          <SkeletonAvatar size="sm" />
          <div className="flex-1">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-32 mb-2" />
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-24" />
          </div>
          <SkeletonButton width="w-20" height="h-8" />
        </div>
      )}
    >
      {children}
    </Suspense>
  </ErrorBoundary>
)

export const TippingStreamingBoundary = ({ children, fallback, error, identifier = 'tipping' }: StreamingBoundaryProps) => (
  <ErrorBoundary 
    fallback={error || <div className="p-4 text-red-500">Tipping failed to load</div>}
  >
    <Suspense 
      fallback={fallback || (
        <div className="p-4 border rounded-lg space-y-4">
          <div className="text-center">
            <SkeletonAvatar size="lg" className="mx-auto" />
            <div className="mt-2 h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-32 mx-auto" />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonButton key={i} width="w-full" height="h-12" />
            ))}
          </div>
          <SkeletonButton width="w-full" height="h-10" />
        </div>
      )}
    >
      {children}
    </Suspense>
  </ErrorBoundary>
)

export const LobbyStreamingBoundary = ({ children, fallback, error, identifier = 'lobby' }: StreamingBoundaryProps) => (
  <ErrorBoundary 
    fallback={error || <div className="p-4 text-red-500">Lobby failed to load</div>}
  >
    <Suspense 
      fallback={fallback || (
        <div className="space-y-6">
          <div className="text-center space-y-4">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-64 mx-auto" />
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse w-96 mx-auto" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <SkeletonCard lines={4} className="p-6 border rounded-lg" />
            <SkeletonCard lines={4} className="p-6 border rounded-lg" />
          </div>
          <div className="flex justify-center">
            <SkeletonButton width="w-40" height="h-12" />
          </div>
        </div>
      )}
    >
      {children}
    </Suspense>
  </ErrorBoundary>
)

// Progressive enhancement boundary - loads basic version first, then enhanced
export const ProgressiveStreamingBoundary = ({ 
  children, 
  basicFallback, 
  identifier = 'progressive' 
}: {
  children: ReactNode
  basicFallback: ReactNode
  identifier?: string
}) => {
  return (
    <ErrorBoundary fallback={<div className="p-4 text-red-500">Failed to load content</div>}>
      <Suspense fallback={basicFallback}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

// Nested streaming boundaries for complex UI hierarchies
export const NestedStreamingBoundary = ({
  children,
  levels = 1,
  identifier = 'nested'
}: {
  children: ReactNode
  levels?: number
  identifier?: string
}) => {
  if (levels <= 0) return <>{children}</>

  return (
    <ErrorBoundary fallback={<div className="p-4 text-red-500">Content failed to load</div>}>
      <Suspense fallback={<LoadingCard title={`Loading level ${levels}...`} />}>
        <NestedStreamingBoundary levels={levels - 1} identifier={identifier}>
          {children}
        </NestedStreamingBoundary>
      </Suspense>
    </ErrorBoundary>
  )
}

// Smart streaming boundary that adapts based on connection speed
export const AdaptiveStreamingBoundary = ({ 
  children, 
  fastFallback, 
  slowFallback,
  identifier = 'adaptive'
}: {
  children: ReactNode
  fastFallback?: ReactNode
  slowFallback?: ReactNode
  identifier?: string
}) => {
  // Detect connection speed
  const connectionSpeed = typeof navigator !== 'undefined' && 
    'connection' in navigator ? 
    (navigator as any).connection?.effectiveType : '4g'

  const isFastConnection = ['4g', '5g'].includes(connectionSpeed)
  
  const fallback = isFastConnection ? 
    (fastFallback || <LoadingSpinner />) : 
    (slowFallback || <LoadingCard title="Loading..." />)

  return (
    <ErrorBoundary fallback={<div className="p-4 text-red-500">Content failed to load</div>}>
      <Suspense fallback={fallback}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

// Streaming boundary with retry mechanism
export const RetryableStreamingBoundary = ({
  children,
  maxRetries = 3,
  fallback,
  identifier = 'retryable'
}: {
  children: ReactNode
  maxRetries?: number
  fallback?: ReactNode
  identifier?: string
}) => {
  return (
    <ErrorBoundary 
      fallback={fallback || <div className="p-4 text-red-500">Content failed to load</div>}
      onReset={() => {
        // Retry logic would be implemented here
        console.log(`Retrying ${identifier}`)
      }}
    >
      <Suspense fallback={<LoadingSpinner />}>
        {children}
      </Suspense>
    </ErrorBoundary>
  )
}

// Performance-optimized streaming boundary with metrics
export const MetricsStreamingBoundary = ({
  children,
  fallback,
  identifier,
  onLoadStart,
  onLoadEnd
}: StreamingBoundaryProps & {
  onLoadStart?: () => void
  onLoadEnd?: () => void
}) => {
  const startTime = performance.now()

  return (
    <ErrorBoundary fallback={<div className="p-4 text-red-500">Content failed to load</div>}>
      <Suspense 
        fallback={
          <>
            {onLoadStart?.()}
            {fallback || <LoadingSpinner />}
          </>
        }
      >
        <div
          onLoad={() => {
            const endTime = performance.now()
            const loadTime = endTime - startTime
            console.debug(`${identifier} loaded in ${loadTime.toFixed(2)}ms`)
            onLoadEnd?.()
          }}
        >
          {children}
        </div>
      </Suspense>
    </ErrorBoundary>
  )
}

// Export all boundary types for easy use
export const StreamingBoundaries = {
  Chat: ChatStreamingBoundary,
  Video: VideoStreamingBoundary,
  Wallet: WalletStreamingBoundary,
  Tipping: TippingStreamingBoundary,
  Lobby: LobbyStreamingBoundary,
  Progressive: ProgressiveStreamingBoundary,
  Nested: NestedStreamingBoundary,
  Adaptive: AdaptiveStreamingBoundary,
  Retryable: RetryableStreamingBoundary,
  Metrics: MetricsStreamingBoundary
}

// Default export for main streaming boundary
export default StreamingBoundaries