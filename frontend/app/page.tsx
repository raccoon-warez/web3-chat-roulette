'use client'

import { useState, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { InjectedConnector } from 'wagmi/connectors/injected'

export default function Home() {
  const [mounted, setMounted] = useState(false)
  const { isConnected, address } = useAccount()
  const { connect } = useConnect({
    connector: new InjectedConnector(),
  })
  const { disconnect } = useDisconnect()

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

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
            <button
              className="bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
              onClick={() => connect()}
            >
              Connect Wallet
            </button>
          )}
        </div>
      </main>
    </div>
  )
}
