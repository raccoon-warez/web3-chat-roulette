'use client'

import { ReactNode, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { config } from '@/lib/wagmi'

// Advanced caching configuration
const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      // Aggressive caching for better performance
      staleTime: 1000 * 60 * 15, // 15 minutes
      gcTime: 1000 * 60 * 60, // 1 hour
      retry: (failureCount, error: any) => {
        // Don't retry on 4xx errors except 429
        if (error?.status >= 400 && error?.status < 500 && error?.status !== 429) {
          return false
        }
        return failureCount < 3
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      // Enable background refetching
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      refetchOnMount: true,
      // Network mode for offline support
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: (failureCount, error: any) => {
        // Don't retry mutations on client errors
        if (error?.status >= 400 && error?.status < 500) {
          return false
        }
        return failureCount < 2
      },
      networkMode: 'offlineFirst',
    },
  },
})

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <WagmiProvider config={config} reconnectOnMount={true}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
