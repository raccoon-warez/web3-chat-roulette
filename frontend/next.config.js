/** @type {import('next').NextConfig} */
const nextConfig = {
  // Performance optimizations
  experimental: {
    // Optimize package imports
    optimizePackageImports: [
      '@tanstack/react-query',
      'wagmi',
      'viem',
      'simple-peer',
      'zustand',
      'web-vitals',
      'react-error-boundary'
    ],
    // Enable turbo mode for faster builds
    turbo: {
      rules: {
        '*.svg': {
          loaders: ['@svgr/webpack'],
          as: '*.js',
        },
      },
    },
    // Enable static worker for better performance
    staticWorkerRequestDeduping: true,
    // Optimize CSS
    optimizeCss: true,
    // Enable server component HMR cache
    serverComponentsHmrCache: true,
    // Enable partial prerendering for better performance
    ppr: 'incremental',
    // Enable React compiler for better performance
    reactCompiler: true,
    // Enable memory usage optimization
    memoryBasedWorkersCount: true,
    // Enable web workers for better performance
    webWorkers: true,
    // Enable advanced tree shaking
    useLightningcss: true,
    // Enable better code splitting
    optimizeServerReact: true,
  },

  // Webpack optimizations
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // Optimize bundle splitting
    if (!dev && !isServer) {
      config.optimization.splitChunks = {
        chunks: 'all',
        cacheGroups: {
          default: false,
          vendors: false,
          // Vendor chunk for common libraries
          vendor: {
            name: 'vendor',
            chunks: 'all',
            test: /node_modules/,
            priority: 20,
          },
          // Separate chunk for Web3 libraries
          web3: {
            name: 'web3',
            chunks: 'all',
            test: /node_modules\/(wagmi|viem|@tanstack\/react-query)/,
            priority: 30,
          },
          // Separate chunk for WebRTC
          webrtc: {
            name: 'webrtc',
            chunks: 'all',
            test: /node_modules\/simple-peer/,
            priority: 30,
          },
          // Common chunk for shared code
          common: {
            name: 'common',
            minChunks: 2,
            chunks: 'all',
            enforce: true,
            priority: 10,
          },
        },
      }

      // Tree shaking optimization
      config.optimization.usedExports = true
      config.optimization.sideEffects = false
      
      // Enable advanced optimizations
      config.optimization.moduleIds = 'deterministic'
      config.optimization.chunkIds = 'deterministic'
      config.optimization.mangleWasmImports = true
      config.optimization.removeAvailableModules = true
      config.optimization.removeEmptyChunks = true
      config.optimization.mergeDuplicateChunks = true
      config.optimization.flagIncludedChunks = true
      config.optimization.providedExports = true
      config.optimization.concatenateModules = true

      // Minimize bundle size
      config.resolve.alias = {
        ...config.resolve.alias,
        'simple-peer/simplepeer.min.js': 'simple-peer',
        // Reduce bundle size by aliasing to smaller alternatives
        'react/jsx-runtime': 'react/jsx-runtime',
        'react/jsx-dev-runtime': 'react/jsx-dev-runtime',
      }

      // Enable aggressive module concatenation
      config.plugins.push(
        new webpack.optimize.ModuleConcatenationPlugin()
      )

      // Add performance hints
      config.performance = {
        maxAssetSize: 512000, // 500kb
        maxEntrypointSize: 512000, // 500kb
        hints: dev ? false : 'warning',
      }
    }

    // Bundle analyzer (only in development or when ANALYZE=true)
    if (process.env.ANALYZE === 'true') {
      const BundleAnalyzerPlugin = require('webpack-bundle-analyzer').BundleAnalyzerPlugin
      config.plugins.push(
        new BundleAnalyzerPlugin({
          analyzerMode: 'static',
          openAnalyzer: false,
          generateStatsFile: true,
          statsFilename: 'bundle-stats.json',
        })
      )
    }

    return config
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
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },

  // Headers for caching and security
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
        ],
      },
      {
        source: '/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/_next/static/(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        source: '/_next/image(.*)',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
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
      exclude: ['error', 'warn'],
    } : false,
  },
}

module.exports = nextConfig