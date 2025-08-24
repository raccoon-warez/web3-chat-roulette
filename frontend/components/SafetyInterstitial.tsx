'use client'

import { useState } from 'react'

interface SafetyInterstitialProps {
  onAccept: () => void
  onDecline: () => void
}

export default function SafetyInterstitial({ onAccept, onDecline }: SafetyInterstitialProps) {
  const [isChecked, setIsChecked] = useState(false)

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-8 max-w-md w-full mx-4">
        <h2 className="text-2xl font-bold mb-4 text-center">Safety First</h2>
        
        <div className="mb-6">
          <p className="mb-4">
            Please remember to follow our community guidelines:
          </p>
          <ul className="list-disc pl-5 mb-4 space-y-2">
            <li>Be respectful to all users</li>
            <li>Do not share personal information</li>
            <li>Report inappropriate behavior</li>
            <li>Use the block feature if needed</li>
          </ul>
          <p className="font-semibold">
            If you feel uncomfortable, you can end the call at any time.
          </p>
        </div>
        
        <div className="mb-6">
          <label className="flex items-center">
            <input
              type="checkbox"
              className="h-4 w-4 text-blue-600 rounded"
              checked={isChecked}
              onChange={(e) => setIsChecked(e.target.checked)}
            />
            <span className="ml-2 text-gray-700">
              I agree to the community guidelines
            </span>
          </label>
        </div>
        
        <div className="flex space-x-4">
          <button
            className="flex-1 bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded"
            onClick={onDecline}
          >
            Decline
          </button>
          <button
            className={`flex-1 bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded ${!isChecked ? 'opacity-50 cursor-not-allowed' : ''}`}
            onClick={onAccept}
            disabled={!isChecked}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  )
}
