'use client'

import { useState, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect, useConnectors, useReconnect } from 'wagmi'

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const { isConnected, address, isReconnecting } = useAccount()
  const { connect, isPending: isConnecting } = useConnect()
  const { disconnect } = useDisconnect()
  const { reconnect } = useReconnect()
  const connectors = useConnectors()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  if (isReconnecting) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen py-2">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        <p className="mt-4 text-gray-600">Reconnecting to wallet...</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-6xl font-bold">
          Web3 Chat Roulette
        </h1>

        <p className="mt-3 text-2xl">
          Connect your wallet to start chatting anonymously
        </p>

        <div className="mt-10">
          {isConnected ? (
            <div className="flex flex-col items-center">
              <p className="text-xl mb-4">Connected as: {address?.slice(0, 6)}...{address?.slice(-4)}</p>
              <button
                className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
                onClick={() => disconnect()}
              >
                Disconnect Wallet
              </button>
              <button
                className="mt-4 bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                onClick={() => window.location.href = '/lobby'}
              >
                Enter Chat Lobby
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  className={`bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded block w-full ${
                    isConnecting || !connector.ready ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                  onClick={() => connect({ connector })}
                  disabled={isConnecting || !connector.ready}
                >
                  {isConnecting ? 'Connecting...' : `Connect ${connector.name}`}
                </button>
              ))}
              <button
                className="bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded block w-full mt-2"
                onClick={() => reconnect()}
              >
                Reconnect
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
