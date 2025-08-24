'use client'

import { ReactNode } from 'react'
import { config } from '@/lib/wagmi'
import { WagmiConfig } from 'wagmi'

export function Providers({ children }: { children: ReactNode }) {
  return <WagmiConfig config={config}>{children}</WagmiConfig>
}
