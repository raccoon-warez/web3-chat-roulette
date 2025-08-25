'use client'

import { useState, useEffect, useRef } from 'react'
import { useAccount } from 'wagmi'
import { useRouter } from 'next/navigation'
import { useWebRTC } from '../../hooks/useWebRTC'
import ConnectionQuality from '../../components/ConnectionQuality'
import AdvancedControls from '../../components/AdvancedControls'
import RecordingConsentDialog from '../../components/RecordingConsentDialog'
import MultiParticipantGrid from '../../components/MultiParticipantGrid'

export default function Call() {
  const [mounted, setMounted] = useState(false)
  const { isConnected, address } = useAccount()
  const router = useRouter()
  
  // Video refs
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const screenShareRef = useRef<HTMLVideoElement>(null)
  
  // WebRTC hook with advanced features enabled
  const webrtc = useWebRTC({
    userId: address || 'anonymous',
    autoReconnect: true,
    maxReconnectAttempts: 3,
    heartbeatInterval: 30000,
    qualityMonitoring: true,
    enableScreenShare: true,
    enableRecording: true,
    enableBackgroundBlur: true,
    enableNoiseSuppression: true,
    maxParticipants: 4
  })

  // UI state
  const [showQualityInfo, setShowQualityInfo] = useState(false)
  const [showAdvancedControls, setShowAdvancedControls] = useState(false)
  const [connectionQuality, setConnectionQuality] = useState<'low' | 'medium' | 'high'>('medium')
  const [showRecordingConsent, setShowRecordingConsent] = useState(false)
  const [recordingRequester, setRecordingRequester] = useState('')
  const [consentCountdown, setConsentCountdown] = useState(30)

  // Update video elements when streams change
  useEffect(() => {
    if (localVideoRef.current && webrtc.localStream) {
      localVideoRef.current.srcObject = webrtc.localStream
    }
  }, [webrtc.localStream])

  useEffect(() => {
    if (remoteVideoRef.current && webrtc.remoteStream) {
      remoteVideoRef.current.srcObject = webrtc.remoteStream
    }
  }, [webrtc.remoteStream])

  useEffect(() => {
    if (screenShareRef.current && webrtc.screenShareStream) {
      screenShareRef.current.srcObject = webrtc.screenShareStream
    }
  }, [webrtc.screenShareStream])

  // Handle recording consent requests
  useEffect(() => {
    // This would be triggered by the WebRTC hook when a consent request is received
    // For demo purposes, we'll show it based on a state change
  }, [])

  // Countdown for recording consent
  useEffect(() => {
    let interval: NodeJS.Timeout
    if (showRecordingConsent && consentCountdown > 0) {
      interval = setInterval(() => {
        setConsentCountdown(prev => {
          if (prev <= 1) {
            setShowRecordingConsent(false)
            setRecordingRequester('')
            return 30
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(interval)
  }, [showRecordingConsent, consentCountdown])

  useEffect(() => {
    setMounted(true)
    // Redirect to home if not connected
    if (!isConnected) {
      router.push('/')
      return
    }
    
    // Auto-join queue for demonstration (in real app, user would select chain)
    const chainId = 1 // Ethereum mainnet
    webrtc.joinQueue(chainId, {
      connectionQuality,
      requireVideo: !webrtc.isAudioOnly,
      maxWaitTime: 120000,
      audioOnly: webrtc.isAudioOnly,
      allowRecording: true,
      allowScreenSharing: true,
      backgroundBlur: webrtc.backgroundBlur,
      noiseSuppression: webrtc.noiseSuppression,
      maxParticipants: webrtc.maxParticipants
    })
    
  }, [isConnected, router, webrtc.joinQueue, connectionQuality])

  const getConnectionStatusText = () => {
    switch (webrtc.connectionState) {
      case 'idle':
        return 'Joining queue...'
      case 'connecting':
        return 'Found match - Connecting...'
      case 'connected':
        return `Connected to ${webrtc.peerId}`
      case 'reconnecting':
        return 'Connection issues - Reconnecting...'
      case 'disconnected':
        return 'Call ended'
      case 'failed':
        return 'Connection failed'
      default:
        return 'Unknown status'
    }
  }

  const handleQualityChange = (quality: 'low' | 'medium' | 'high') => {
    setConnectionQuality(quality)
    // In production, this would renegotiate the media with new constraints
    console.log(`Changing quality to: ${quality}`)
  }

  const handleEndCall = () => {
    webrtc.endSession()
    router.push('/lobby')
  }

  const handleRecordingConsentRequest = (requesterId: string) => {
    setRecordingRequester(requesterId)
    setShowRecordingConsent(true)
    setConsentCountdown(30)
  }

  const handleAcceptRecording = () => {
    webrtc.respondToRecordingRequest(true, recordingRequester)
    setShowRecordingConsent(false)
    setRecordingRequester('')
  }

  const handleDeclineRecording = () => {
    webrtc.respondToRecordingRequest(false, recordingRequester)
    setShowRecordingConsent(false)
    setRecordingRequester('')
  }

  const handleParticipantClick = (userId: string) => {
    console.log('Participant clicked:', userId)
    // Could implement features like spotlight, volume control for specific user, etc.
  }

  // Prepare participants data for the grid
  const participants = [
    {
      userId: address || 'you',
      stream: webrtc.localStream,
      isLocal: true,
      isMuted: webrtc.isAudioMuted,
      isVideoDisabled: webrtc.isVideoDisabled || webrtc.isAudioOnly,
      displayName: 'You'
    },
    ...(webrtc.peerId && webrtc.remoteStream ? [{
      userId: webrtc.peerId,
      stream: webrtc.remoteStream,
      isLocal: false,
      isMuted: false, // We don't know peer's mute state
      isVideoDisabled: webrtc.isAudioOnly,
      displayName: 'Stranger'
    }] : []),
    ...Array.from(webrtc.participants.entries()).map(([userId, stream]) => ({
      userId,
      stream,
      isLocal: false,
      isMuted: false,
      isVideoDisabled: false,
      displayName: `User ${userId.slice(-4)}`
    }))
  ]

  if (!mounted) return null

  // If not connected, don't show the call page
  if (!isConnected) {
    return null
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2 bg-gray-900">
      <div className="w-full max-w-7xl px-4">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-bold text-white">Web3 Chat Roulette</h1>
          <div className="flex items-center space-x-4">
            <div className="text-white">{getConnectionStatusText()}</div>
            {webrtc.error && (
              <div className="text-red-400 text-sm">Error: {webrtc.error}</div>
            )}
            <button
              onClick={() => setShowQualityInfo(!showQualityInfo)}
              className="text-blue-400 hover:text-blue-300 text-sm"
            >
              Connection Info
            </button>
            <button
              onClick={() => setShowAdvancedControls(!showAdvancedControls)}
              className="text-purple-400 hover:text-purple-300 text-sm"
            >
              {showAdvancedControls ? 'Hide Advanced' : 'Show Advanced'}
            </button>
          </div>
        </div>

        {/* Screen Share Display */}
        {webrtc.screenShareStream && (
          <div className="mb-6">
            <div className="relative bg-black rounded-lg overflow-hidden">
              <video
                ref={screenShareRef}
                autoPlay
                playsInline
                muted={webrtc.isScreenSharing}
                className="w-full h-64 md:h-96 object-contain"
              />
              <div className="absolute bottom-2 left-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded">
                🖥️ {webrtc.isScreenSharing ? 'Your Screen' : 'Peer\'s Screen'}
              </div>
              <div className="absolute top-2 right-2">
                <button
                  onClick={() => webrtc.isScreenSharing ? webrtc.stopScreenShare() : null}
                  className={`px-2 py-1 rounded text-white text-xs ${
                    webrtc.isScreenSharing ? 'bg-red-600 hover:bg-red-700' : 'bg-gray-600'
                  }`}
                  disabled={!webrtc.isScreenSharing}
                >
                  {webrtc.isScreenSharing ? 'Stop Sharing' : 'Screen Share Active'}
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Multi-participant Video Grid */}
        <MultiParticipantGrid
          participants={participants}
          screenShareStream={webrtc.screenShareStream}
          screenShareUserId={webrtc.isScreenSharing ? (address || 'you') : (webrtc.isPeerScreenSharing ? webrtc.peerId || 'peer' : undefined)}
          maxParticipants={webrtc.maxParticipants}
          onParticipantClick={handleParticipantClick}
          className="mb-6"
        />

        {/* Connection Quality Info */}
        {showQualityInfo && (
          <div className="mb-6 flex justify-center">
            <ConnectionQuality
              quality={webrtc.connectionQuality}
              connectionState={webrtc.connectionState}
              iceConnectionState={webrtc.iceConnectionState}
              metrics={webrtc.metrics}
              isExpanded={true}
              onToggleExpanded={() => {}}
            />
          </div>
        )}

        {webrtc.connectionState === 'reconnecting' && (
          <div className="mb-6 flex justify-center">
            <div className="bg-yellow-600 bg-opacity-20 border border-yellow-600 rounded-lg p-4 text-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-yellow-400 mx-auto mb-2"></div>
              <div className="text-yellow-200">Reconnecting...</div>
            </div>
          </div>
        )}
        
        {/* Basic Controls */}
        <div className="flex justify-center space-x-3 mb-4">
          <button
            className={`p-3 rounded-full ${webrtc.isAudioMuted ? 'bg-red-500' : 'bg-gray-700'} text-white hover:bg-opacity-80 transition-colors`}
            onClick={webrtc.toggleAudio}
            disabled={webrtc.connectionState !== 'connected'}
          >
            {webrtc.isAudioMuted ? '🔇 Unmute' : '🎤 Mute'}
          </button>
          
          <button
            className={`p-3 rounded-full ${webrtc.isVideoDisabled ? 'bg-red-500' : 'bg-gray-700'} text-white hover:bg-opacity-80 transition-colors`}
            onClick={webrtc.toggleVideo}
            disabled={webrtc.connectionState !== 'connected' || webrtc.isAudioOnly}
          >
            {webrtc.isVideoDisabled ? '📹 Start Video' : '📹 Stop Video'}
          </button>
          
          {webrtc.connectionState === 'failed' && (
            <button
              className="p-3 rounded-full bg-orange-500 text-white hover:bg-orange-600 transition-colors"
              onClick={webrtc.restartIce}
            >
              🔄 Reconnect
            </button>
          )}
          
          <button
            className="p-3 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors"
            onClick={handleEndCall}
          >
            📞 End Call
          </button>
          
          {webrtc.connectionState === 'connected' && (
            <>
              <button
                className="p-3 rounded-full bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                onClick={() => router.push('/tip')}
              >
                💰 Send Tip
              </button>
              
              <button
                className="p-3 rounded-full bg-yellow-500 text-white hover:bg-yellow-600 transition-colors"
                onClick={() => router.push('/moderation')}
              >
                🚨 Report/Block
              </button>
            </>
          )}
        </div>

        {/* Advanced Controls */}
        {showAdvancedControls && (
          <div className="mb-6">
            <AdvancedControls
              isScreenSharing={webrtc.isScreenSharing}
              isPeerScreenSharing={webrtc.isPeerScreenSharing}
              onStartScreenShare={webrtc.startScreenShare}
              onStopScreenShare={webrtc.stopScreenShare}
              isRecording={webrtc.isRecording}
              hasRecordingConsent={webrtc.hasRecordingConsent}
              onRequestRecording={webrtc.requestRecording}
              onStartRecording={webrtc.startRecording}
              onStopRecording={webrtc.stopRecording}
              isAudioOnly={webrtc.isAudioOnly}
              onToggleAudioOnly={webrtc.toggleAudioOnlyMode}
              backgroundBlur={webrtc.backgroundBlur}
              onToggleBackgroundBlur={webrtc.toggleBackgroundBlur}
              virtualBackground={webrtc.virtualBackground}
              onSetVirtualBackground={webrtc.setVirtualBackground}
              noiseSuppression={webrtc.noiseSuppression}
              onToggleNoiseSuppression={webrtc.toggleNoiseSuppression}
              volume={webrtc.volume}
              onSetVolume={webrtc.setVolume}
              connectionState={webrtc.connectionState}
              connectionQuality={webrtc.connectionQuality}
              participantCount={participants.length}
              maxParticipants={webrtc.maxParticipants}
            />
          </div>
        )}

        {/* Quality Settings */}
        <div className="flex justify-center">
          <div className="bg-gray-800 rounded-lg p-4">
            <div className="text-white text-sm mb-2">Connection Quality:</div>
            <div className="flex space-x-2">
              {(['low', 'medium', 'high'] as const).map((quality) => (
                <button
                  key={quality}
                  className={`px-3 py-1 text-xs rounded ${
                    connectionQuality === quality
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-600 text-gray-300 hover:bg-gray-500'
                  } transition-colors`}
                  onClick={() => handleQualityChange(quality)}
                >
                  {quality.charAt(0).toUpperCase() + quality.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Recording Consent Dialog */}
      <RecordingConsentDialog
        isOpen={showRecordingConsent}
        requesterName={recordingRequester}
        onAccept={handleAcceptRecording}
        onDecline={handleDeclineRecording}
        countdown={consentCountdown}
      />
    </div>
  )
}
