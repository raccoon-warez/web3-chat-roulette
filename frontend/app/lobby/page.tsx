'use client'

import { useState, useEffect } from 'react'
import { useAccount, useSwitchChain, useChains } from 'wagmi'
import { useRouter } from 'next/navigation'
import SafetyInterstitial from '@/components/SafetyInterstitial'

export default function Lobby() {
  const [mounted, setMounted] = useState(false)
  const { isConnected, chain } = useAccount()
  const { switchChain } = useSwitchChain()
  const chains = useChains()
  const router = useRouter()
  const [showSafetyInterstitial, setShowSafetyInterstitial] = useState(false)

  useEffect(() => {
    setMounted(true)
    // Redirect to home if not connected
    if (!isConnected) {
      router.push('/')
    }
  }, [isConnected, router])

  if (!mounted) return null

  // If not connected, don't show the lobby
  if (!isConnected) {
    return null
  }

  const handleJoinQueue = () => {
    // Show safety interstitial before joining queue
    setShowSafetyInterstitial(true)
  }
  
  const handleAcceptSafety = () => {
    setShowSafetyInterstitial(false)
    // For now, just navigate to the call page
    // In a real implementation, this would connect to the WebSocket server
    router.push('/call')
  }
  
  const handleDeclineSafety = () => {
    setShowSafetyInterstitial(false)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-4xl font-bold mb-8">Chat Lobby</h1>
        
        <div className="w-full max-w-md">
          <div className="mb-6">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="chain">
              Select Chain
            </label>
            <select
              id="chain"
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              value={chain?.id}
              onChange={(e) => switchChain({ chainId: Number(e.target.value) })}
            >
              {chains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          
          <div className="mb-6">
            <label className="block text-gray-700 text-sm font-bold mb-2">
              Safety Check
            </label>
            <div className="flex items-center">
              <input
                id="safety-check"
                type="checkbox"
                className="h-4 w-4 text-blue-600 rounded"
                required
              />
              <label htmlFor="safety-check" className="ml-2 text-gray-700">
                I agree to the community guidelines and terms of service
              </label>
            </div>
          </div>
          
          <button
            className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline w-full"
            onClick={handleJoinQueue}
          >
            Join Queue
          </button>
        </div>
      </main>
      
      {showSafetyInterstitial && (
        <SafetyInterstitial 
          onAccept={handleAcceptSafety} 
          onDecline={handleDeclineSafety} 
        />
      )}
    </div>
  )
}
