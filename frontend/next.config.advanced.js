/** @type {import('next').NextConfig} */
const nextConfig = {
  // Basic optimizations for Vercel deployment
  experimental: {
    // Only use stable experimental features
    optimizePackageImports: [
      '@tanstack/react-query',
      'wagmi',
      'viem',
      'simple-peer',
      'zustand'
    ],
    // Enable optimizations that are stable
    optimizeCss: true
  },

  // Compression
  compress: true,

  // Image optimization
  images: {
    formats: ['image/webp', 'image/avif'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 3840],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
    dangerouslyAllowSVG: true,
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;"
  },

  // Headers for caching and security
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          }
        ]
      }
    ]
  },

  // Enable gzip compression
  poweredByHeader: false,
  
  // Optimize fonts
  optimizeFonts: true,

  // Production source maps (disabled for performance)
  productionBrowserSourceMaps: false,

  // Strict mode
  reactStrictMode: true,

  // Vercel deployment optimization (remove standalone for Vercel)
  output: process.env.VERCEL ? undefined : (process.env.NODE_ENV === 'production' ? 'standalone' : undefined),

  // Compiler options
  compiler: {
    // Remove console logs in production
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn']
    } : false
  }
}

module.exports = nextConfig