'use client'

import { useState, useEffect } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'

export default function Moderation() {
  const [mounted, setMounted] = useState(false)
  const { isConnected } = useAccount()
  const router = useRouter()
  
  // Report state
  const [reportReason, setReportReason] = useState('')
  const [reportNotes, setReportNotes] = useState('')
  const [targetAddress, setTargetAddress] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [reportStatus, setReportStatus] = useState('')
  
  // Block state
  const [blockAddress, setBlockAddress] = useState('')
  const [isBlocking, setIsBlocking] = useState(false)
  const [blockStatus, setBlockStatus] = useState('')
  
  // Blocklist state
  const [blocklist, setBlocklist] = useState<string[]>([])

  useEffect(() => {
    setMounted(true)
    // Redirect to home if not connected
    if (!isConnected) {
      router.push('/')
    }
    
    // Fetch blocklist
    fetchBlocklist()
  }, [isConnected, router])

  if (!mounted) return null

  // If not connected, don't show the moderation page
  if (!isConnected) {
    return null
  }
  
  const fetchBlocklist = async () => {
    try {
      // In a real implementation, this would fetch from the backend
      // const response = await fetch('/api/blocks')
      // const data = await response.json()
      // setBlocklist(data.blocklist)
      
      // For demo purposes, we'll use a mock blocklist
      setBlocklist(['0x1234...5678', '0xabcd...ef90'])
    } catch (error) {
      console.error('Error fetching blocklist:', error)
    }
  }
  
  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!targetAddress || !reportReason) {
      setReportStatus('Please fill in all required fields')
      return
    }
    
    try {
      setIsSubmitting(true)
      setReportStatus('Submitting report...')
      
      // In a real implementation, this would send to the backend
      // const response = await fetch('/api/reports', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ targetAddr: targetAddress, sessionId, reason: reportReason, notes: reportNotes })
      // })
      
      // For demo purposes, we'll simulate a successful submission
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      setReportStatus('Report submitted successfully')
      setReportReason('')
      setReportNotes('')
      setTargetAddress('')
      setSessionId('')
    } catch (error) {
      setReportStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsSubmitting(false)
    }
  }
  
  const handleBlockSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!blockAddress) {
      setBlockStatus('Please enter an address to block')
      return
    }
    
    try {
      setIsBlocking(true)
      setBlockStatus('Blocking user...')
      
      // In a real implementation, this would send to the backend
      // const response = await fetch('/api/blocks', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ targetAddr: blockAddress })
      // })
      
      // For demo purposes, we'll simulate a successful block
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      setBlockStatus('User blocked successfully')
      setBlockAddress('')
      
      // Refresh blocklist
      fetchBlocklist()
    } catch (error) {
      setBlockStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
    } finally {
      setIsBlocking(false)
    }
  }
  
  const handleUnblock = async (address: string) => {
    try {
      // In a real implementation, this would send to the backend
      // const response = await fetch(`/api/blocks/${address}`, {
      //   method: 'DELETE'
      // })
      
      // For demo purposes, we'll simulate a successful unblock
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // Refresh blocklist
      fetchBlocklist()
    } catch (error) {
      console.error('Error unblocking user:', error)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2">
      <main className="flex flex-col items-center justify-center w-full flex-1 px-20 text-center">
        <h1 className="text-4xl font-bold mb-8">Moderation</h1>
        
        <div className="w-full max-w-2xl grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Report Form */}
          <div className="bg-white rounded-lg shadow-md p-6 text-left">
            <h2 className="text-2xl font-bold mb-4">Report User</h2>
            <form onSubmit={handleReportSubmit}>
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="targetAddress">
                  Target Address *
                </label>
                <input
                  id="targetAddress"
                  type="text"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={targetAddress}
                  onChange={(e) => setTargetAddress(e.target.value)}
                  placeholder="0x..."
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="sessionId">
                  Session ID
                </label>
                <input
                  id="sessionId"
                  type="text"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={sessionId}
                  onChange={(e) => setSessionId(e.target.value)}
                  placeholder="Session ID (if applicable)"
                />
              </div>
              
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="reportReason">
                  Reason *
                </label>
                <select
                  id="reportReason"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                >
                  <option value="">Select a reason</option>
                  <option value="harassment">Harassment</option>
                  <option value="inappropriate_content">Inappropriate Content</option>
                  <option value="spam">Spam</option>
                  <option value="scam">Scam/Fraud</option>
                  <option value="other">Other</option>
                </select>
              </div>
              
              <div className="mb-6">
                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="reportNotes">
                  Additional Notes
                </label>
                <textarea
                  id="reportNotes"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={reportNotes}
                  onChange={(e) => setReportNotes(e.target.value)}
                  placeholder="Provide any additional details..."
                  rows={3}
                />
              </div>
              
              <button
                className={`bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline w-full ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
                type="submit"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Report'}
              </button>
              
              {reportStatus && (
                <div className="mt-4 p-3 rounded bg-gray-100 text-gray-700">
                  {reportStatus}
                </div>
              )}
            </form>
          </div>
          
          {/* Block Management */}
          <div className="bg-white rounded-lg shadow-md p-6 text-left">
            <h2 className="text-2xl font-bold mb-4">Block Management</h2>
            
            {/* Block Form */}
            <form onSubmit={handleBlockSubmit} className="mb-6">
              <div className="mb-4">
                <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="blockAddress">
                  Block Address
                </label>
                <input
                  id="blockAddress"
                  type="text"
                  className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                  value={blockAddress}
                  onChange={(e) => setBlockAddress(e.target.value)}
                  placeholder="0x..."
                />
              </div>
              
              <button
                className={`bg-gray-500 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded focus:outline-none focus:shadow-outline w-full ${isBlocking ? 'opacity-50 cursor-not-allowed' : ''}`}
                type="submit"
                disabled={isBlocking}
              >
                {isBlocking ? 'Blocking...' : 'Block User'}
              </button>
              
              {blockStatus && (
                <div className="mt-4 p-3 rounded bg-gray-100 text-gray-700">
                  {blockStatus}
                </div>
              )}
            </form>
            
            {/* Blocklist */}
            <div>
              <h3 className="text-lg font-bold mb-2">Blocked Users</h3>
              {blocklist.length > 0 ? (
                <ul className="border rounded">
                  {blocklist.map((address, index) => (
                    <li key={index} className="flex justify-between items-center p-3 border-b last:border-b-0">
                      <span className="font-mono text-sm">{address}</span>
                      <button
                        className="text-red-500 hover:text-red-700"
                        onClick={() => handleUnblock(address)}
                      >
                        Unblock
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 italic">No blocked users</p>
              )}
            </div>
          </div>
        </div>
        
        <button
          className="mt-8 text-gray-500 hover:text-gray-700"
          onClick={() => router.back()}
        >
          Back to Call
        </button>
      </main>
    </div>
  )
}
