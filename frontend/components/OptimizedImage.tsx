'use client'

import Image from 'next/image'
import { useState, memo } from 'react'

interface OptimizedImageProps {
  src: string
  alt: string
  width?: number
  height?: number
  className?: string
  priority?: boolean
  placeholder?: 'blur' | 'empty'
  blurDataURL?: string
  sizes?: string
  fill?: boolean
  quality?: number
  loading?: 'eager' | 'lazy'
  onLoad?: () => void
  onError?: () => void
}

const OptimizedImage = memo(function OptimizedImage({
  src,
  alt,
  width,
  height,
  className = '',
  priority = false,
  placeholder = 'empty',
  blurDataURL,
  sizes,
  fill = false,
  quality = 85,
  loading = 'lazy',
  onLoad,
  onError,
}: OptimizedImageProps) {
  const [imageError, setImageError] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)

  // Default blur placeholder for better UX
  const defaultBlurDataURL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="

  const handleImageLoad = () => {
    setImageLoaded(true)
    onLoad?.()
  }

  const handleImageError = () => {
    setImageError(true)
    onError?.()
  }

  if (imageError) {
    return (
      <div
        className={`flex items-center justify-center bg-gray-200 text-gray-400 ${className}`}
        style={fill ? undefined : { width, height }}
      >
        <svg
          className="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
      </div>
    )
  }

  const imageProps = {
    src,
    alt,
    className: `${className} ${!imageLoaded ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`,
    priority,
    placeholder,
    blurDataURL: blurDataURL || (placeholder === 'blur' ? defaultBlurDataURL : undefined),
    sizes: sizes || (fill ? '100vw' : undefined),
    quality,
    loading: priority ? 'eager' : loading,
    onLoad: handleImageLoad,
    onError: handleImageError,
    ...(fill ? { fill: true } : { width, height }),
  }

  return <Image {...imageProps} />
})

OptimizedImage.displayName = 'OptimizedImage'

export default OptimizedImage

// Utility function to generate responsive image sizes
export const generateResponsiveSizes = (
  breakpoints: { [key: string]: number } = {
    sm: 640,
    md: 768,
    lg: 1024,
    xl: 1280,
    '2xl': 1536,
  }
) => {
  const entries = Object.entries(breakpoints).sort(([, a], [, b]) => a - b)
  
  return entries
    .map(([name, width], index) => {
      if (index === entries.length - 1) {
        return `${width}px`
      }
      return `(max-width: ${width}px) ${Math.floor(width * 0.9)}px`
    })
    .join(', ')
}

// Preload critical images
export const preloadImage = (src: string, priority: boolean = true) => {
  if (typeof window !== 'undefined') {
    const link = document.createElement('link')
    link.rel = 'preload'
    link.as = 'image'
    link.href = src
    if (priority) {
      (link as any).fetchPriority = 'high'
    }
    document.head.appendChild(link)
  }
}

// Advanced image optimization utilities
export const imageOptimizer = {
  // Generate WebP fallback
  getOptimizedSrc: (src: string, format: 'webp' | 'avif' = 'webp'): string => {
    if (!src) return src
    
    // If it's already an optimized format or external URL, return as-is
    if (src.includes('.webp') || src.includes('.avif') || src.startsWith('http')) {
      return src
    }
    
    // For Next.js optimized images, add format parameter
    if (src.startsWith('/')) {
      return `/_next/image?url=${encodeURIComponent(src)}&w=1920&q=85&f=${format}`
    }
    
    return src
  },

  // Calculate responsive sizes based on container
  calculateResponsiveSizes: (
    containerWidth: number,
    breakpoints: Record<string, number> = {
      sm: 640,
      md: 768,
      lg: 1024,
      xl: 1280,
      '2xl': 1536
    }
  ): string => {
    const sortedBreakpoints = Object.entries(breakpoints)
      .sort(([, a], [, b]) => a - b)
    
    const sizes = sortedBreakpoints.map(([, width], index) => {
      const isLast = index === sortedBreakpoints.length - 1
      const imageWidth = Math.min(containerWidth, width)
      
      if (isLast) {
        return `${imageWidth}px`
      }
      
      return `(max-width: ${width}px) ${imageWidth}px`
    })
    
    return sizes.join(', ')
  },

  // Generate blur placeholder from image URL
  generateBlurPlaceholder: async (src: string): Promise<string> => {
    // Default low-quality placeholder
    const defaultPlaceholder = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k="
    
    try {
      // In a real implementation, you might want to generate this server-side
      // or use a service like Plaiceholder
      return defaultPlaceholder
    } catch {
      return defaultPlaceholder
    }
  },

  // Optimize image dimensions for performance
  optimizeDimensions: (
    originalWidth: number,
    originalHeight: number,
    maxWidth: number = 1920,
    maxHeight: number = 1080
  ): { width: number; height: number } => {
    const aspectRatio = originalWidth / originalHeight
    
    let width = originalWidth
    let height = originalHeight
    
    // Scale down if exceeding max dimensions
    if (width > maxWidth) {
      width = maxWidth
      height = width / aspectRatio
    }
    
    if (height > maxHeight) {
      height = maxHeight
      width = height * aspectRatio
    }
    
    return {
      width: Math.round(width),
      height: Math.round(height)
    }
  },

  // Image format detection and recommendation
  getRecommendedFormat: (src: string, context: 'hero' | 'thumbnail' | 'icon' | 'background' = 'thumbnail'): {
    format: 'webp' | 'avif' | 'jpeg' | 'png'
    quality: number
  } => {
    const extension = src.split('.').pop()?.toLowerCase()
    
    // Context-based optimization
    const contextSettings = {
      hero: { format: 'avif' as const, quality: 90 },
      thumbnail: { format: 'webp' as const, quality: 80 },
      icon: { format: 'webp' as const, quality: 90 },
      background: { format: 'webp' as const, quality: 75 }
    }
    
    // Preserve transparency for PNGs in icon context
    if (extension === 'png' && context === 'icon') {
      return { format: 'webp', quality: 90 }
    }
    
    return contextSettings[context]
  }
}

// Intersection Observer based lazy loading hook
export const useIntersectionObserver = (
  options: IntersectionObserverInit = {}
) => {
  const [isIntersecting, setIsIntersecting] = useState(false)
  const [hasIntersected, setHasIntersected] = useState(false)
  const ref = useState<HTMLElement | null>(null)[0]

  useState(() => {
    if (!ref || typeof window === 'undefined') return

    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting)
        if (entry.isIntersecting && !hasIntersected) {
          setHasIntersected(true)
        }
      },
      {
        threshold: 0.1,
        rootMargin: '100px',
        ...options
      }
    )

    if (ref) observer.observe(ref)

    return () => {
      observer.disconnect()
    }
  })

  return { ref, isIntersecting, hasIntersected }
}

// Progressive image component with advanced optimization
interface ProgressiveImageProps extends OptimizedImageProps {
  lowQualitySrc?: string
  context?: 'hero' | 'thumbnail' | 'icon' | 'background'
  lazy?: boolean
  progressive?: boolean
}

export const ProgressiveImage = memo(function ProgressiveImage({
  src,
  lowQualitySrc,
  context = 'thumbnail',
  lazy = true,
  progressive = true,
  ...props
}: ProgressiveImageProps) {
  const [currentSrc, setCurrentSrc] = useState(lowQualitySrc || src)
  const [isHighQualityLoaded, setIsHighQualityLoaded] = useState(false)
  const { ref, hasIntersected } = useIntersectionObserver()

  // Load high quality image when in viewport
  useState(() => {
    if (!lazy || hasIntersected) {
      if (progressive && lowQualitySrc) {
        const highQualityImage = new window.Image()
        highQualityImage.onload = () => {
          setCurrentSrc(src)
          setIsHighQualityLoaded(true)
        }
        highQualityImage.src = src
      } else {
        setCurrentSrc(src)
        setIsHighQualityLoaded(true)
      }
    }
  })

  // Get optimized settings based on context
  const optimizedSettings = imageOptimizer.getRecommendedFormat(src, context)

  return (
    <div ref={ref} className={props.className}>
      {(lazy && !hasIntersected) ? (
        <div 
          className="bg-gray-200 animate-pulse"
          style={{ width: props.width, height: props.height }}
        />
      ) : (
        <OptimizedImage
          {...props}
          src={imageOptimizer.getOptimizedSrc(currentSrc, optimizedSettings.format)}
          quality={optimizedSettings.quality}
          className={`${props.className} ${
            progressive && !isHighQualityLoaded ? 'filter blur-sm' : ''
          } transition-all duration-300`}
          loading={lazy ? 'lazy' : 'eager'}
        />
      )}
    </div>
  )
})

// Image preloading service
export class ImagePreloader {
  private static instance: ImagePreloader
  private preloadedImages = new Set<string>()
  private preloadQueue = new Map<string, Promise<void>>()

  static getInstance(): ImagePreloader {
    if (!ImagePreloader.instance) {
      ImagePreloader.instance = new ImagePreloader()
    }
    return ImagePreloader.instance
  }

  // Preload single image
  async preload(src: string, priority: boolean = false): Promise<void> {
    if (this.preloadedImages.has(src)) {
      return Promise.resolve()
    }

    if (this.preloadQueue.has(src)) {
      return this.preloadQueue.get(src)!
    }

    const preloadPromise = new Promise<void>((resolve, reject) => {
      const img = new window.Image()
      
      img.onload = () => {
        this.preloadedImages.add(src)
        this.preloadQueue.delete(src)
        resolve()
      }
      
      img.onerror = () => {
        this.preloadQueue.delete(src)
        reject(new Error(`Failed to preload image: ${src}`))
      }
      
      // Add to DOM for preloading
      if (priority && typeof document !== 'undefined') {
        const link = document.createElement('link')
        link.rel = 'preload'
        link.as = 'image'
        link.href = src
        document.head.appendChild(link)
      }
      
      img.src = src
    })

    this.preloadQueue.set(src, preloadPromise)
    return preloadPromise
  }

  // Preload multiple images
  async preloadBatch(sources: string[], priority: boolean = false): Promise<void> {
    const promises = sources.map(src => this.preload(src, priority))
    await Promise.allSettled(promises)
  }

  // Check if image is preloaded
  isPreloaded(src: string): boolean {
    return this.preloadedImages.has(src)
  }

  // Clear preload cache
  clear(): void {
    this.preloadedImages.clear()
    this.preloadQueue.clear()
  }
}

// Global image preloader instance
export const imagePreloader = ImagePreloader.getInstance()