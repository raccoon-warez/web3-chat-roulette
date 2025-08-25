'use client'

import { memo } from 'react'
import { createLazyRoute } from '@/lib/lazy-loading'

// Lazy load the safety interstitial component
const LazySafetyInterstitial = createLazyRoute(
  () => import('../SafetyInterstitial'),
  'Loading safety information...'
)

export default memo(LazySafetyInterstitial)