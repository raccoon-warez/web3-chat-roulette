'use client'

import React from 'react'

interface ConnectionQualityProps {
  quality: 'excellent' | 'good' | 'poor' | 'unknown'
  connectionState: string
  iceConnectionState: RTCIceConnectionState | null
  metrics?: {
    roundTripTime: number
    packetsLost: number
    jitter: number
    bytesReceived: number
    bytesSent: number
    bandwidth?: number
    audioLevel?: number
    videoFrameRate?: number
    videoResolution?: string
  } | null
  isExpanded?: boolean
  onToggleExpanded?: () => void
}

export default function ConnectionQuality({
  quality,
  connectionState,
  iceConnectionState,
  metrics,
  isExpanded = false,
  onToggleExpanded
}: ConnectionQualityProps) {
  const getQualityColor = (quality: string) => {
    switch (quality) {
      case 'excellent':
        return 'text-green-500'
      case 'good':
        return 'text-yellow-500'
      case 'poor':
        return 'text-red-500'
      default:
        return 'text-gray-500'
    }
  }

  const getQualityIcon = (quality: string) => {
    switch (quality) {
      case 'excellent':
        return '●●●●●'
      case 'good':
        return '●●●○○'
      case 'poor':
        return '●○○○○'
      default:
        return '○○○○○'
    }
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const getBandwidthColor = (bandwidth: number) => {
    if (bandwidth > 2000) return 'text-green-500'
    if (bandwidth > 1000) return 'text-yellow-500'
    return 'text-red-500'
  }

  const getVideoQualityIcon = (frameRate?: number, resolution?: string) => {
    if (!frameRate || !resolution) return '📹'
    if (frameRate >= 30 && resolution?.includes('1080')) return '🎬'
    if (frameRate >= 24 && resolution?.includes('720')) return '📺'
    return '📱'
  }

  return (
    <div className="bg-black bg-opacity-75 text-white p-3 rounded-lg text-sm min-w-64">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <span className={getQualityColor(quality)}>
            {getQualityIcon(quality)}
          </span>
          <span className="capitalize">{quality} Connection</span>
        </div>
        {onToggleExpanded && (
          <button 
            onClick={onToggleExpanded}
            className="text-gray-400 hover:text-white text-xs"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        )}
      </div>
      
      <div className="space-y-1 text-xs">
        <div className="flex justify-between">
          <span className="text-gray-400">State:</span> 
          <span className={connectionState === 'connected' ? 'text-green-400' : 'text-yellow-400'}>
            {connectionState}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">ICE:</span> 
          <span className={iceConnectionState === 'connected' ? 'text-green-400' : 'text-yellow-400'}>
            {iceConnectionState || 'unknown'}
          </span>
        </div>
        
        {metrics && (
          <>
            <div className="flex justify-between">
              <span className="text-gray-400">RTT:</span> 
              <span className={metrics.roundTripTime > 200 ? 'text-red-400' : 'text-green-400'}>
                {metrics.roundTripTime.toFixed(0)}ms
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Lost:</span> 
              <span className={metrics.packetsLost > 2 ? 'text-red-400' : 'text-green-400'}>
                {metrics.packetsLost} packets
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Jitter:</span> 
              <span className={metrics.jitter > 50 ? 'text-red-400' : 'text-green-400'}>
                {metrics.jitter.toFixed(1)}ms
              </span>
            </div>
            
            {isExpanded && (
              <>
                {metrics.bandwidth && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Bandwidth:</span>
                    <span className={getBandwidthColor(metrics.bandwidth)}>
                      {(metrics.bandwidth / 1000).toFixed(1)} Mbps
                    </span>
                  </div>
                )}
                {metrics.videoFrameRate && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Video:</span>
                    <span className="text-blue-400">
                      {getVideoQualityIcon(metrics.videoFrameRate, metrics.videoResolution)} {metrics.videoFrameRate}fps
                    </span>
                  </div>
                )}
                {metrics.videoResolution && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Resolution:</span>
                    <span className="text-blue-400">{metrics.videoResolution}</span>
                  </div>
                )}
                {metrics.audioLevel !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-gray-400">Audio Level:</span>
                    <span className="text-purple-400">
                      {'🔊'.repeat(Math.max(1, Math.ceil(metrics.audioLevel * 5)))}
                    </span>
                  </div>
                )}
              </>
            )}
            
            <div className="flex justify-between pt-1 border-t border-gray-600">
              <span>
                <span className="text-gray-400">↓</span> {formatBytes(metrics.bytesReceived)}
              </span>
              <span>
                <span className="text-gray-400">↑</span> {formatBytes(metrics.bytesSent)}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}