'use client'

import React, { useState } from 'react'

interface AdvancedControlsProps {
  // Screen sharing
  isScreenSharing: boolean
  isPeerScreenSharing: boolean
  onStartScreenShare: (type?: 'screen' | 'window' | 'tab') => void
  onStopScreenShare: () => void
  
  // Recording
  isRecording: boolean
  hasRecordingConsent: boolean
  onRequestRecording: () => void
  onStartRecording: () => void
  onStopRecording: () => void
  
  // Audio/Video enhancements
  isAudioOnly: boolean
  onToggleAudioOnly: () => void
  backgroundBlur: boolean
  onToggleBackgroundBlur: () => void
  virtualBackground: string | null
  onSetVirtualBackground: (url: string | null) => void
  noiseSuppression: boolean
  onToggleNoiseSuppression: () => void
  volume: number
  onSetVolume: (volume: number) => void
  
  // Connection state
  connectionState: string
  connectionQuality: 'excellent' | 'good' | 'poor' | 'unknown'
  
  // Participants
  participantCount: number
  maxParticipants: number
}

export default function AdvancedControls({
  isScreenSharing,
  isPeerScreenSharing,
  onStartScreenShare,
  onStopScreenShare,
  isRecording,
  hasRecordingConsent,
  onRequestRecording,
  onStartRecording,
  onStopRecording,
  isAudioOnly,
  onToggleAudioOnly,
  backgroundBlur,
  onToggleBackgroundBlur,
  virtualBackground,
  onSetVirtualBackground,
  noiseSuppression,
  onToggleNoiseSuppression,
  volume,
  onSetVolume,
  connectionState,
  connectionQuality,
  participantCount,
  maxParticipants
}: AdvancedControlsProps) {
  const [showScreenShareOptions, setShowScreenShareOptions] = useState(false)
  const [showBackgroundOptions, setShowBackgroundOptions] = useState(false)
  const [selectedBackground, setSelectedBackground] = useState<string | null>(null)
  
  const virtualBackgrounds = [
    { name: 'None', url: null },
    { name: 'Blur', url: 'blur' },
    { name: 'Office', url: '/backgrounds/office.jpg' },
    { name: 'Nature', url: '/backgrounds/nature.jpg' },
    { name: 'Abstract', url: '/backgrounds/abstract.jpg' }
  ]
  
  const isConnected = connectionState === 'connected'
  
  const handleScreenShareClick = () => {
    if (isScreenSharing) {
      onStopScreenShare()
    } else {
      setShowScreenShareOptions(!showScreenShareOptions)
    }
  }
  
  const handleScreenShareOption = (type: 'screen' | 'window' | 'tab') => {
    onStartScreenShare(type)
    setShowScreenShareOptions(false)
  }
  
  const handleRecordingClick = () => {
    if (isRecording) {
      onStopRecording()
    } else if (hasRecordingConsent) {
      onStartRecording()
    } else {
      onRequestRecording()
    }
  }
  
  const handleBackgroundSelect = (backgroundUrl: string | null) => {
    if (backgroundUrl === 'blur') {
      onToggleBackgroundBlur()
    } else {
      onSetVirtualBackground(backgroundUrl)
    }
    setSelectedBackground(backgroundUrl)
    setShowBackgroundOptions(false)
  }

  const getConnectionIcon = () => {
    switch (connectionQuality) {
      case 'excellent': return '🟢'
      case 'good': return '🟡'
      case 'poor': return '🔴'
      default: return '⚪'
    }
  }

  return (
    <div className="space-y-4">
      {/* Primary Controls Row */}
      <div className="flex justify-center space-x-3">
        {/* Screen Share */}
        <div className="relative">
          <button
            className={`p-3 rounded-full ${
              isScreenSharing ? 'bg-blue-500' : 'bg-gray-700'
            } text-white hover:bg-opacity-80 transition-colors disabled:opacity-50`}
            onClick={handleScreenShareClick}
            disabled={!isConnected}
            title={isScreenSharing ? 'Stop Screen Share' : 'Start Screen Share'}
          >
            🖥️ {isScreenSharing ? 'Stop Share' : 'Share Screen'}
          </button>
          
          {showScreenShareOptions && (
            <div className="absolute top-full mt-2 bg-gray-800 rounded-lg shadow-lg p-2 z-10">
              <button 
                onClick={() => handleScreenShareOption('screen')}
                className="block w-full text-left px-3 py-2 text-white hover:bg-gray-700 rounded"
              >
                🖥️ Entire Screen
              </button>
              <button 
                onClick={() => handleScreenShareOption('window')}
                className="block w-full text-left px-3 py-2 text-white hover:bg-gray-700 rounded"
              >
                🪟 Application Window
              </button>
              <button 
                onClick={() => handleScreenShareOption('tab')}
                className="block w-full text-left px-3 py-2 text-white hover:bg-gray-700 rounded"
              >
                🗂️ Browser Tab
              </button>
            </div>
          )}
        </div>

        {/* Recording */}
        <button
          className={`p-3 rounded-full ${
            isRecording ? 'bg-red-500 animate-pulse' : 
            hasRecordingConsent ? 'bg-red-600' : 'bg-gray-700'
          } text-white hover:bg-opacity-80 transition-colors disabled:opacity-50`}
          onClick={handleRecordingClick}
          disabled={!isConnected}
          title={
            isRecording ? 'Stop Recording' : 
            hasRecordingConsent ? 'Start Recording' : 'Request Recording Permission'
          }
        >
          🎬 {
            isRecording ? 'Recording...' :
            hasRecordingConsent ? 'Record' : 'Request Record'
          }
        </button>

        {/* Audio Only Mode */}
        <button
          className={`p-3 rounded-full ${
            isAudioOnly ? 'bg-purple-500' : 'bg-gray-700'
          } text-white hover:bg-opacity-80 transition-colors disabled:opacity-50`}
          onClick={onToggleAudioOnly}
          disabled={!isConnected}
          title={isAudioOnly ? 'Enable Video' : 'Audio Only Mode'}
        >
          🎧 {isAudioOnly ? 'Audio Only' : 'Enable Audio Only'}
        </button>
      </div>

      {/* Secondary Controls Row */}
      <div className="flex justify-center space-x-3">
        {/* Background Effects */}
        <div className="relative">
          <button
            className={`p-3 rounded-full ${
              backgroundBlur || virtualBackground ? 'bg-green-500' : 'bg-gray-700'
            } text-white hover:bg-opacity-80 transition-colors disabled:opacity-50`}
            onClick={() => setShowBackgroundOptions(!showBackgroundOptions)}
            disabled={!isConnected || isAudioOnly}
            title="Background Effects"
          >
            🌟 Background
          </button>
          
          {showBackgroundOptions && (
            <div className="absolute top-full mt-2 bg-gray-800 rounded-lg shadow-lg p-2 z-10 min-w-32">
              {virtualBackgrounds.map((bg) => (
                <button 
                  key={bg.name}
                  onClick={() => handleBackgroundSelect(bg.url)}
                  className={`block w-full text-left px-3 py-2 text-white hover:bg-gray-700 rounded ${
                    selectedBackground === bg.url ? 'bg-blue-600' : ''
                  }`}
                >
                  {bg.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Noise Suppression */}
        <button
          className={`p-3 rounded-full ${
            noiseSuppression ? 'bg-blue-500' : 'bg-gray-700'
          } text-white hover:bg-opacity-80 transition-colors disabled:opacity-50`}
          onClick={onToggleNoiseSuppression}
          disabled={!isConnected}
          title={noiseSuppression ? 'Disable Noise Suppression' : 'Enable Noise Suppression'}
        >
          🔇 {noiseSuppression ? 'Noise Cancel On' : 'Noise Cancel Off'}
        </button>
      </div>

      {/* Status Indicators */}
      <div className="flex justify-center space-x-6 text-sm">
        {/* Connection Quality */}
        <div className="flex items-center space-x-2">
          <span>{getConnectionIcon()}</span>
          <span className="text-gray-300 capitalize">{connectionQuality} Quality</span>
        </div>

        {/* Participants */}
        <div className="flex items-center space-x-2">
          <span>👥</span>
          <span className="text-gray-300">{participantCount}/{maxParticipants}</span>
        </div>

        {/* Screen Share Status */}
        {(isScreenSharing || isPeerScreenSharing) && (
          <div className="flex items-center space-x-2">
            <span>🖥️</span>
            <span className="text-blue-400">
              {isScreenSharing ? 'You\'re sharing' : 'Peer is sharing'}
            </span>
          </div>
        )}

        {/* Recording Status */}
        {isRecording && (
          <div className="flex items-center space-x-2">
            <span className="animate-pulse">🔴</span>
            <span className="text-red-400">Recording</span>
          </div>
        )}
      </div>

      {/* Volume Control */}
      {isConnected && (
        <div className="flex justify-center items-center space-x-3">
          <span className="text-gray-400 text-sm">🔊</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={volume}
            onChange={(e) => onSetVolume(parseFloat(e.target.value))}
            className="w-32 h-2 bg-gray-700 rounded-lg appearance-none slider"
          />
          <span className="text-gray-400 text-sm">{Math.round(volume * 100)}%</span>
        </div>
      )}

      {/* Responsive design for mobile */}
      <style jsx>{`
        .slider::-webkit-slider-thumb {
          appearance: none;
          width: 16px;
          height: 16px;
          background: #3b82f6;
          border-radius: 50%;
          cursor: pointer;
        }
        .slider::-moz-range-thumb {
          width: 16px;
          height: 16px;
          background: #3b82f6;
          border-radius: 50%;
          cursor: pointer;
          border: none;
        }
        @media (max-width: 768px) {
          .space-x-3 > * + * {
            margin-left: 0.5rem;
          }
          .space-x-6 > * + * {
            margin-left: 1rem;
          }
        }
      `}</style>
    </div>
  )
}