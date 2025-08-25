'use client'

import { memo } from 'react'
import { createLazyRoute } from '@/lib/lazy-loading'

// Lazy load the connection quality component only when needed
const LazyConnectionQuality = createLazyRoute(
  () => import('../ConnectionQuality'),
  'Loading connection quality...'
)

// Memoized wrapper to prevent unnecessary re-renders
export default memo(LazyConnectionQuality)