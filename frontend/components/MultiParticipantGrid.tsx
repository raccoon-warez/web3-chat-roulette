'use client'

import React, { useRef, useEffect } from 'react'

interface Participant {
  userId: string
  stream: MediaStream | null
  isLocal?: boolean
  isMuted?: boolean
  isVideoDisabled?: boolean
  isScreenSharing?: boolean
  displayName?: string
}

interface MultiParticipantGridProps {
  participants: Participant[]
  screenShareStream?: MediaStream | null
  screenShareUserId?: string
  maxParticipants?: number
  onParticipantClick?: (userId: string) => void
  className?: string
}

export default function MultiParticipantGrid({
  participants,
  screenShareStream,
  screenShareUserId,
  maxParticipants = 4,
  onParticipantClick,
  className = ''
}: MultiParticipantGridProps) {
  const videoRefs = useRef<Map<string, HTMLVideoElement>>(new Map())
  const screenShareRef = useRef<HTMLVideoElement>(null)

  // Update video sources when streams change
  useEffect(() => {
    participants.forEach(participant => {
      const videoElement = videoRefs.current.get(participant.userId)
      if (videoElement && participant.stream) {
        videoElement.srcObject = participant.stream
      }
    })
  }, [participants])

  // Update screen share video
  useEffect(() => {
    if (screenShareRef.current && screenShareStream) {
      screenShareRef.current.srcObject = screenShareStream
    }
  }, [screenShareStream])

  const getGridColumns = (count: number) => {
    if (count === 1) return 'grid-cols-1'
    if (count === 2) return 'grid-cols-1 md:grid-cols-2'
    if (count <= 4) return 'grid-cols-2'
    if (count <= 6) return 'grid-cols-2 md:grid-cols-3'
    return 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'
  }

  const getVideoHeight = (count: number, hasScreenShare: boolean) => {
    if (hasScreenShare) return 'h-24 md:h-32'
    if (count === 1) return 'h-96'
    if (count === 2) return 'h-64 md:h-80'
    if (count <= 4) return 'h-48 md:h-64'
    return 'h-32 md:h-48'
  }

  const visibleParticipants = participants.slice(0, maxParticipants)
  const hasScreenShare = !!screenShareStream
  const videoHeight = getVideoHeight(visibleParticipants.length, hasScreenShare)

  return (
    <div className={`w-full ${className}`}>
      {/* Screen Share - Takes priority when active */}
      {hasScreenShare && (
        <div className="mb-4">
          <div className="relative bg-black rounded-lg overflow-hidden">
            <video
              ref={screenShareRef}
              autoPlay
              playsInline
              muted={screenShareUserId === participants.find(p => p.isLocal)?.userId}
              className="w-full h-64 md:h-96 object-contain"
            />
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-75 text-white px-2 py-1 rounded text-sm">
              🖥️ {screenShareUserId === participants.find(p => p.isLocal)?.userId ? 'Your Screen' : `${screenShareUserId || 'Screen'} is sharing`}
            </div>
          </div>
        </div>
      )}

      {/* Participant Videos Grid */}
      <div className={`grid ${getGridColumns(visibleParticipants.length)} gap-2 md:gap-4`}>
        {visibleParticipants.map((participant) => (
          <ParticipantVideo
            key={participant.userId}
            participant={participant}
            videoHeight={videoHeight}
            onClick={() => onParticipantClick?.(participant.userId)}
            ref={(el) => {
              if (el) {
                videoRefs.current.set(participant.userId, el)
              } else {
                videoRefs.current.delete(participant.userId)
              }
            }}
          />
        ))}
        
        {/* Empty slots for remaining participants */}
        {Array.from({ length: Math.max(0, maxParticipants - visibleParticipants.length) }).map((_, index) => (
          <div 
            key={`empty-${index}`}
            className={`${videoHeight} bg-gray-800 rounded-lg flex items-center justify-center border-2 border-dashed border-gray-600`}
          >
            <div className="text-center text-gray-500">
              <div className="text-2xl mb-2">👤</div>
              <div className="text-sm">Waiting for participant</div>
            </div>
          </div>
        ))}
      </div>

      {/* Overflow indicator */}
      {participants.length > maxParticipants && (
        <div className="mt-4 text-center">
          <div className="inline-flex items-center space-x-2 bg-gray-800 rounded-full px-4 py-2 text-sm text-gray-300">
            <span>+{participants.length - maxParticipants} more participants</span>
            <button className="text-blue-400 hover:text-blue-300">
              View All
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface ParticipantVideoProps {
  participant: Participant
  videoHeight: string
  onClick?: () => void
}

const ParticipantVideo = React.forwardRef<HTMLVideoElement, ParticipantVideoProps>(
  ({ participant, videoHeight, onClick }, ref) => {
    const { userId, stream, isLocal, isMuted, isVideoDisabled, displayName } = participant

    return (
      <div 
        className={`relative bg-black rounded-lg overflow-hidden cursor-pointer hover:ring-2 hover:ring-blue-500 transition-all ${videoHeight}`}
        onClick={onClick}
      >
        {stream && !isVideoDisabled ? (
          <video
            ref={ref}
            autoPlay
            muted={isLocal}
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gray-900">
            <div className="text-center">
              <div className="text-4xl mb-2">👤</div>
              <div className="text-sm text-gray-300">
                {isVideoDisabled ? 'Video Off' : 'No Video'}
              </div>
            </div>
          </div>
        )}

        {/* Participant Info Overlay */}
        <div className="absolute bottom-2 left-2 right-2 flex justify-between items-end">
          <div className="bg-black bg-opacity-75 text-white px-2 py-1 rounded text-sm max-w-32 truncate">
            {displayName || (isLocal ? 'You' : userId)}
          </div>
          
          <div className="flex space-x-1">
            {isMuted && (
              <div className="bg-red-600 bg-opacity-90 text-white p-1 rounded">
                🔇
              </div>
            )}
            {isVideoDisabled && (
              <div className="bg-gray-600 bg-opacity-90 text-white p-1 rounded">
                📹
              </div>
            )}
            {isLocal && (
              <div className="bg-blue-600 bg-opacity-90 text-white p-1 rounded text-xs">
                YOU
              </div>
            )}
          </div>
        </div>

        {/* Connection Quality Indicator */}
        <div className="absolute top-2 right-2">
          <div className="w-2 h-2 bg-green-500 rounded-full"></div>
        </div>
      </div>
    )
  }
)

ParticipantVideo.displayName = 'ParticipantVideo'