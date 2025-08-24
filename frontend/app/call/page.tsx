'use client'

import { useState, useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import SimplePeer from 'simple-peer'

export default function Call() {
  const [mounted, setMounted] = useState(false)
  const { isConnected } = useAccount()
  const router = useRouter()
  
  // Video refs
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  
  // WebRTC state
  const peerRef = useRef<SimplePeer.Instance | null>(null)
  const [callStatus, setCallStatus] = useState('Initializing...')
  const [isMuted, setIsMuted] = useState(false)
  const [isVideoOff, setIsVideoOff] = useState(false)

  useEffect(() => {
    setMounted(true)
    // Redirect to home if not connected
    if (!isConnected) {
      router.push('/')
      return
    }
    
    // Initialize WebRTC
    initWebRTC()
    
    // Cleanup on unmount
    return () => {
      if (peerRef.current) {
        peerRef.current.destroy()
      }
    }
  }, [isConnected, router])

  const initWebRTC = async () => {
    try {
      // Get user media
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      })
      
      // Set local video stream
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }
      
      // Initialize SimplePeer
      peerRef.current = new SimplePeer({
        initiator: true, // For demo purposes, we'll be the initiator
        trickle: false,
        stream: stream
      })
      
      // Set up event listeners
      peerRef.current.on('signal', (data) => {
        // In a real app, you would send this signal data to the signaling server
        console.log('SIGNAL', JSON.stringify(data))
        setCallStatus('Connecting...')
      })
      
      peerRef.current.on('connect', () => {
        setCallStatus('Connected')
      })
      
      peerRef.current.on('stream', (stream) => {
        // Set remote video stream
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream
        }
      })
      
      peerRef.current.on('close', () => {
        setCallStatus('Call ended')
        router.push('/lobby')
      })
      
      peerRef.current.on('error', (err) => {
        console.error('WebRTC error:', err)
        setCallStatus('Connection error')
      })
      
    } catch (err) {
      console.error('Error accessing media devices:', err)
      setCallStatus('Camera/mic access denied')
    }
  }
  
  const toggleMute = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      const stream = localVideoRef.current.srcObject as MediaStream
      stream.getAudioTracks().forEach(track => {
        track.enabled = !isMuted
      })
      setIsMuted(!isMuted)
    }
  }
  
  const toggleVideo = () => {
    if (localVideoRef.current && localVideoRef.current.srcObject) {
      const stream = localVideoRef.current.srcObject as MediaStream
      stream.getVideoTracks().forEach(track => {
        track.enabled = !isVideoOff
      })
      setIsVideoOff(!isVideoOff)
    }
  }
  
  const endCall = () => {
    if (peerRef.current) {
      peerRef.current.destroy()
    }
    router.push('/lobby')
  }

  if (!mounted) return null

  // If not connected, don't show the call page
  if (!isConnected) {
    return null
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2 bg-gray-900">
      <div className="w-full max-w-6xl">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-white">Web3 Chat Roulette</h1>
          <div className="text-white">{callStatus}</div>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Local video */}
          <div className="relative">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              className="w-full h-96 bg-black rounded-lg"
            />
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
              You
            </div>
          </div>
          
          {/* Remote video */}
          <div className="relative">
            <video
              ref={remoteVideoRef}
              autoPlay
              className="w-full h-96 bg-black rounded-lg"
            />
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 rounded">
              Stranger
            </div>
          </div>
        </div>
        
        {/* Controls */}
        <div className="flex justify-center space-x-4 mt-6">
          <button
            className={`p-3 rounded-full ${isMuted ? 'bg-red-500' : 'bg-gray-700'} text-white`}
            onClick={toggleMute}
          >
            {isMuted ? 'Unmute' : 'Mute'}
          </button>
          
          <button
            className={`p-3 rounded-full ${isVideoOff ? 'bg-red-500' : 'bg-gray-700'} text-white`}
            onClick={toggleVideo}
          >
            {isVideoOff ? 'Start Video' : 'Stop Video'}
          </button>
          
          <button
            className="p-3 rounded-full bg-red-500 text-white"
            onClick={endCall}
          >
            End Call
          </button>
          
          <button
            className="p-3 rounded-full bg-blue-500 text-white"
            onClick={() => router.push('/tip')}
          >
            Send Tip
          </button>
          
          <button
            className="p-3 rounded-full bg-yellow-500 text-white"
            onClick={() => router.push('/moderation')}
          >
            Report/Block
          </button>
        </div>
      </div>
    </div>
  )
}
