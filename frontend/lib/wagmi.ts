import { createConfig, configureChains, mainnet } from 'wagmi'
import { publicProvider } from 'wagmi/providers/public'
import { InjectedConnector } from 'wagmi/connectors/injected'
import { MetaMaskConnector } from 'wagmi/connectors/metaMask'

// Configure chains & providers
const { chains, publicClient, webSocketPublicClient } = configureChains(
  [
    mainnet,
    // Add other chains as needed
    // polygon,
    // base,
  ],
  [
    publicProvider(),
  ],
)

// Set up wagmi config
export const config = createConfig({
  autoConnect: true,
  connectors: [
    new MetaMaskConnector({ chains }),
    new InjectedConnector({
      chains,
      options: {
        name: (detectedName) =>
          `Injected (${typeof detectedName === 'string' ? detectedName : detectedName.join(', ')})`,
      },
    }),
  ],
  publicClient,
  webSocketPublicClient,
})
