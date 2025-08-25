'use client'

import { memo } from 'react'
import { createLazyRoute } from '@/lib/lazy-loading'

// Lazy load the call page with WebRTC components
const LazyCall = createLazyRoute(
  () => import('../../app/call/page'),
  'Connecting to call...'
)

export default memo(LazyCall)