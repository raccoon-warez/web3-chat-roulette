'use client'

import React from 'react'

interface RecordingConsentDialogProps {
  isOpen: boolean
  requesterName: string
  onAccept: () => void
  onDecline: () => void
  countdown?: number
}

export default function RecordingConsentDialog({
  isOpen,
  requesterName,
  onAccept,
  onDecline,
  countdown = 30
}: RecordingConsentDialogProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-gray-900 rounded-lg p-6 max-w-md w-full mx-4 border border-gray-700">
        <div className="flex items-center space-x-3 mb-4">
          <div className="w-12 h-12 bg-red-600 rounded-full flex items-center justify-center">
            🎬
          </div>
          <div>
            <h3 className="text-xl font-semibold text-white">Recording Request</h3>
            <p className="text-gray-400 text-sm">
              {countdown > 0 && `Auto-decline in ${countdown}s`}
            </p>
          </div>
        </div>

        <div className="mb-6">
          <p className="text-white mb-2">
            <strong>{requesterName || 'Your peer'}</strong> would like to record this call.
          </p>
          <p className="text-gray-400 text-sm">
            The recording will include both video and audio. You can stop the recording at any time.
          </p>
        </div>

        <div className="bg-gray-800 rounded-lg p-3 mb-6">
          <h4 className="text-white text-sm font-medium mb-2">Recording includes:</h4>
          <ul className="text-gray-300 text-sm space-y-1">
            <li>• Your video and audio</li>
            <li>• Peer's video and audio</li>
            <li>• Screen sharing content (if any)</li>
            <li>• Chat messages (if any)</li>
          </ul>
        </div>

        <div className="bg-yellow-900 bg-opacity-50 rounded-lg p-3 mb-6 border border-yellow-600">
          <div className="flex items-start space-x-2">
            <span className="text-yellow-400 text-sm">⚠️</span>
            <div>
              <p className="text-yellow-200 text-sm font-medium">Privacy Notice</p>
              <p className="text-yellow-300 text-xs">
                By consenting, you agree that this call may be recorded and saved. 
                Please be mindful of sharing sensitive information.
              </p>
            </div>
          </div>
        </div>

        <div className="flex space-x-3">
          <button
            onClick={onDecline}
            className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors font-medium"
          >
            Decline
          </button>
          <button
            onClick={onAccept}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-500 transition-colors font-medium"
          >
            Accept & Record
          </button>
        </div>

        <p className="text-gray-500 text-xs text-center mt-3">
          You can stop recording at any time during the call
        </p>
      </div>
    </div>
  )
}