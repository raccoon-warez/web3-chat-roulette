import { http, createConfig } from 'wagmi'
import { mainnet, polygon, base } from 'wagmi/chains'
import { injected, metaMask, walletConnect } from 'wagmi/connectors'

// Set up wagmi config with v2 format
export const config = createConfig({
  chains: [mainnet, polygon, base],
  connectors: [
    metaMask(),
    injected(),
    walletConnect({
      projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'your-project-id',
    }),
  ],
  transports: {
    [mainnet.id]: http(undefined, {
      retryCount: 3,
      retryDelay: 1000,
    }),
    [polygon.id]: http(undefined, {
      retryCount: 3,
      retryDelay: 1000,
    }),
    [base.id]: http(undefined, {
      retryCount: 3,
      retryDelay: 1000,
    }),
  },
  ssr: true,
})
