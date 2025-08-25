'use client'

import { memo } from 'react'
import { createLazyRoute } from '@/lib/lazy-loading'

// Lazy load the lobby page with preloading
const LazyLobby = createLazyRoute(
  () => import('../../app/lobby/page'),
  'Entering chat lobby...'
)

export default memo(LazyLobby)