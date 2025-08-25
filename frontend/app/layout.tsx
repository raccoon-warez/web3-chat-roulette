import './globals.css'
import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import { Suspense } from 'react'
import { Providers } from './providers'
import { PerformanceMonitor } from '@/lib/performance-monitor'
import { preloadResources } from '@/lib/lazy-loading'

// Optimize font loading
const inter = Inter({ 
  subsets: ['latin'],
  display: 'swap',
  preload: true,
  fallback: ['system-ui', 'arial'],
})

// Enhanced metadata for SEO and performance
export const metadata: Metadata = {
  title: {
    default: 'Web3 Chat Roulette',
    template: '%s | Web3 Chat Roulette',
  },
  description: 'A privacy-first chat roulette with crypto tipping. Connect your wallet and chat anonymously with others.',
  keywords: ['web3', 'chat', 'roulette', 'crypto', 'tipping', 'privacy', 'anonymous'],
  authors: [{ name: 'Web3 Chat Roulette Team' }],
  creator: 'Web3 Chat Roulette',
  publisher: 'Web3 Chat Roulette',
  
  // Open Graph
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: 'https://web3-chat-roulette.com',
    title: 'Web3 Chat Roulette',
    description: 'A privacy-first chat roulette with crypto tipping',
    siteName: 'Web3 Chat Roulette',
    images: [
      {
        url: '/og-image.jpg',
        width: 1200,
        height: 630,
        alt: 'Web3 Chat Roulette',
      },
    ],
  },
  
  // Twitter
  twitter: {
    card: 'summary_large_image',
    title: 'Web3 Chat Roulette',
    description: 'A privacy-first chat roulette with crypto tipping',
    creator: '@web3chatroulette',
    images: ['/twitter-image.jpg'],
  },

  // PWA
  manifest: '/manifest.json',
  
  // Icons
  icons: {
    icon: [
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
    other: [
      { rel: 'mask-icon', url: '/safari-pinned-tab.svg', color: '#000000' },
    ],
  },

  // Verification
  verification: {
    google: 'your-google-site-verification',
  },

  // Robot indexing
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}

// Viewport configuration for better mobile performance
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
}

// Loading component for Suspense boundaries
function LoadingFallback() {
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
    </div>
  )
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={inter.className}>
      <head>
        {/* Preload critical resources */}
        <link
          rel="preload"
          href="/fonts/inter-var.woff2"
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        
        {/* DNS prefetch for external resources */}
        <link rel="dns-prefetch" href="//api.web3chatroulette.com" />
        <link rel="dns-prefetch" href="//cdn.jsdelivr.net" />
        
        {/* Prefetch critical JavaScript chunks */}
        <link rel="modulepreload" href="/_next/static/chunks/webpack.js" />
        <link rel="modulepreload" href="/_next/static/chunks/main.js" />
        
        {/* Performance hints */}
        <meta httpEquiv="x-dns-prefetch-control" content="on" />
        <meta name="format-detection" content="telephone=no" />
        
        {/* Security headers */}
        <meta httpEquiv="X-Content-Type-Options" content="nosniff" />
        <meta httpEquiv="X-Frame-Options" content="DENY" />
        <meta httpEquiv="X-XSS-Protection" content="1; mode=block" />
        
        {/* PWA theme */}
        <meta name="theme-color" content="#000000" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        
        {/* Structured data for SEO */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebApplication',
              name: 'Web3 Chat Roulette',
              description: 'A privacy-first chat roulette with crypto tipping',
              url: 'https://web3-chat-roulette.com',
              applicationCategory: 'SocialNetworkingApplication',
              operatingSystem: 'Any',
              browserRequirements: 'Requires JavaScript. Requires WebRTC.',
              offers: {
                '@type': 'Offer',
                price: '0',
                priceCurrency: 'USD',
              },
            }),
          }}
        />
      </head>
      <body className="min-h-screen bg-white dark:bg-black">
        {/* Performance monitoring wrapper */}
        <PerformanceMonitor>
          <Suspense fallback={<LoadingFallback />}>
            <Providers>
              {/* Main app content */}
              <Suspense fallback={<LoadingFallback />}>
                <main id="main-content" className="relative">
                  {children}
                </main>
              </Suspense>
              
              {/* Skip to content link for accessibility */}
              <a
                href="#main-content"
                className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 bg-blue-500 text-white px-4 py-2 rounded z-50"
              >
                Skip to main content
              </a>
            </Providers>
          </Suspense>
        </PerformanceMonitor>
        
        {/* Service worker registration */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function() {
                  navigator.serviceWorker.register('/sw.js', { scope: '/' })
                    .then(function(registration) {
                      console.log('SW registered: ', registration);
                    })
                    .catch(function(registrationError) {
                      console.log('SW registration failed: ', registrationError);
                    });
                });
              }
            `,
          }}
        />
      </body>
    </html>
  )
}
