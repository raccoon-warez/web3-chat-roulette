'use client'

import { useState, useEffect } from 'react'
import { useAccount, useBalance, useSendTransaction } from 'wagmi'
import { parseEther } from 'viem'
import { useRouter } from 'next/navigation'

export default function Tip() {
  const [mounted, setMounted] = useState(false)
  const { isConnected, address } = useAccount()
  const router = useRouter()
  
  // Tip state
  const [tipAmount, setTipAmount] = useState('')
  const [tipToken, setTipToken] = useState('eth')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [txStatus, setTxStatus] = useState('')
  
  // Get user balance
  const { data: balance } = useBalance({
    address: address,
  })
  
  // Send transaction
  const { sendTransaction } = useSendTransaction({
    mutation: {
      onSuccess: (data) => {
        setTxStatus(`Success! Transaction hash: ${data}`)
        setIsSending(false)
      },
      onError: (error) => {
        setTxStatus(`Error: ${error.message}`)
        setIsSending(false)
      }
    }
  })
  
  useEffect(() => {
    setMounted(true)
    // Redirect to home if not connected
    if (!isConnected) {
      router.push('/')
    }
  }, [isConnected, router])

  if (!mounted) return null

  // If not connected, don't show the tip page
  if (!isConnected) {
    return null
  }
  
  const handleSendTip = () => {
    if (!recipientAddress || !tipAmount) {
      setTxStatus('Please enter a recipient address and tip amount')
      return
    }
    
    try {
      setIsSending(true)
      setTxStatus('Sending transaction...')
      sendTransaction({
        to: recipientAddress as `0x${string}`,
        value: parseEther(tipAmount),
      })
    } catch (error) {
      setTxStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
      setIsSending(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-4xl font-bold mb-8">Send a Tip</h1>
        
        <div className="w-full max-w-md bg-white rounded-lg shadow-md p-6">
          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="recipient">
              Recipient Address
            </label>
            <input
              id="recipient"
              type="text"
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              value={recipientAddress}
              onChange={(e) => setRecipientAddress(e.target.value)}
              placeholder="0x..."
            />
          </div>
          
          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="token">
              Token
            </label>
            <select
              id="token"
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              value={tipToken}
              onChange={(e) => setTipToken(e.target.value)}
            >
              <option value="eth">ETH</option>
              <option value="usdc">USDC</option>
              <option value="dai">DAI</option>
            </select>
          </div>
          
          <div className="mb-6">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="amount">
              Amount
            </label>
            <input
              id="amount"
              type="number"
              className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
              value={tipAmount}
              onChange={(e) => setTipAmount(e.target.value)}
              placeholder="0.01"
              step="0.0001"
            />
            <div className="text-xs text-gray-500 mt-1">
              Balance: {balance?.formatted} {balance?.symbol}
            </div>
          </div>
          
          <button
            className={`bg-blue-500 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline w-full ${isSending ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={handleSendTip}
            disabled={isSending}
          >
            {isSending ? 'Sending...' : 'Send Tip'}
          </button>
          
          {txStatus && (
            <div className="mt-4 p-3 rounded bg-gray-100 text-gray-700">
              {txStatus}
            </div>
          )}
          
          <button
            className="mt-4 text-gray-500 hover:text-gray-700"
            onClick={() => router.back()}
          >
            Back to Call
          </button>
        </div>
      </main>
    </div>
  )
}
