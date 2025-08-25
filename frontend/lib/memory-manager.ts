'use client'

import { useEffect, useRef, useCallback, useState } from 'react'

// Memory monitoring and cleanup utilities
export class MemoryManager {
  private cleanupTasks = new Set<() => void>()
  private intervalIds = new Set<NodeJS.Timeout>()
  private timeoutIds = new Set<NodeJS.Timeout>()
  private eventListeners = new Map<EventTarget, Map<string, EventListener>>()
  private observers = new Set<IntersectionObserver | MutationObserver | ResizeObserver>()
  private abortControllers = new Set<AbortController>()

  // Register cleanup task
  registerCleanup(cleanup: () => void): void {
    this.cleanupTasks.add(cleanup)
  }

  // Register interval with automatic cleanup
  setManagedInterval(callback: () => void, delay: number): NodeJS.Timeout {
    const id = setInterval(callback, delay)
    this.intervalIds.add(id)
    return id
  }

  // Register timeout with automatic cleanup
  setManagedTimeout(callback: () => void, delay: number): NodeJS.Timeout {
    const id = setTimeout(() => {
      callback()
      this.timeoutIds.delete(id)
    }, delay)
    this.timeoutIds.add(id)
    return id
  }

  // Add event listener with automatic cleanup
  addManagedEventListener(
    target: EventTarget,
    type: string,
    listener: EventListener,
    options?: AddEventListenerOptions
  ): void {
    target.addEventListener(type, listener, options)
    
    if (!this.eventListeners.has(target)) {
      this.eventListeners.set(target, new Map())
    }
    this.eventListeners.get(target)!.set(type, listener)
  }

  // Create managed abort controller
  createAbortController(): AbortController {
    const controller = new AbortController()
    this.abortControllers.add(controller)
    return controller
  }

  // Register observer with automatic cleanup
  registerObserver(observer: IntersectionObserver | MutationObserver | ResizeObserver): void {
    this.observers.add(observer)
  }

  // Clean up all managed resources
  cleanup(): void {
    // Clear intervals
    this.intervalIds.forEach(id => clearInterval(id))
    this.intervalIds.clear()

    // Clear timeouts
    this.timeoutIds.forEach(id => clearTimeout(id))
    this.timeoutIds.clear()

    // Remove event listeners
    this.eventListeners.forEach((listeners, target) => {
      listeners.forEach((listener, type) => {
        target.removeEventListener(type, listener)
      })
    })
    this.eventListeners.clear()

    // Disconnect observers
    this.observers.forEach(observer => observer.disconnect())
    this.observers.clear()

    // Abort controllers
    this.abortControllers.forEach(controller => controller.abort())
    this.abortControllers.clear()

    // Run custom cleanup tasks
    this.cleanupTasks.forEach(cleanup => {
      try {
        cleanup()
      } catch (error) {
        console.warn('Cleanup task failed:', error)
      }
    })
    this.cleanupTasks.clear()
  }

  // Get memory usage statistics
  getMemoryStats(): {
    managedIntervals: number
    managedTimeouts: number
    managedListeners: number
    managedObservers: number
    managedControllers: number
    cleanupTasks: number
  } {
    let totalListeners = 0
    this.eventListeners.forEach(listeners => {
      totalListeners += listeners.size
    })

    return {
      managedIntervals: this.intervalIds.size,
      managedTimeouts: this.timeoutIds.size,
      managedListeners: totalListeners,
      managedObservers: this.observers.size,
      managedControllers: this.abortControllers.size,
      cleanupTasks: this.cleanupTasks.size,
    }
  }
}

// React hook for automatic memory management
export function useMemoryManager(): MemoryManager {
  const managerRef = useRef<MemoryManager>()

  if (!managerRef.current) {
    managerRef.current = new MemoryManager()
  }

  useEffect(() => {
    const manager = managerRef.current!
    return () => {
      manager.cleanup()
    }
  }, [])

  return managerRef.current
}

// Hook for managed intervals
export function useManagedInterval(callback: () => void, delay: number | null): void {
  const memoryManager = useMemoryManager()
  const savedCallback = useRef<() => void>()

  useEffect(() => {
    savedCallback.current = callback
  })

  useEffect(() => {
    if (delay === null) return

    const tick = () => savedCallback.current?.()
    const id = memoryManager.setManagedInterval(tick, delay)

    return () => clearInterval(id)
  }, [delay, memoryManager])
}

// Hook for managed timeouts
export function useManagedTimeout(callback: () => void, delay: number): void {
  const memoryManager = useMemoryManager()
  const savedCallback = useRef<() => void>()

  useEffect(() => {
    savedCallback.current = callback
  })

  useEffect(() => {
    const tick = () => savedCallback.current?.()
    memoryManager.setManagedTimeout(tick, delay)
  }, [delay, memoryManager])
}

// Hook for managed event listeners
export function useManagedEventListener<T extends Event>(
  target: EventTarget | null,
  type: string,
  listener: (event: T) => void,
  options?: AddEventListenerOptions
): void {
  const memoryManager = useMemoryManager()
  const listenerRef = useRef<(event: T) => void>()

  useEffect(() => {
    listenerRef.current = listener
  })

  useEffect(() => {
    if (!target) return

    const eventListener = (event: Event) => listenerRef.current?.(event as T)
    memoryManager.addManagedEventListener(target, type, eventListener, options)
  }, [target, type, options, memoryManager])
}

// Hook for managed observers
export function useManagedIntersectionObserver(
  callback: IntersectionObserverCallback,
  options?: IntersectionObserverInit
): {
  observer: IntersectionObserver | null
  observe: (element: Element) => void
  unobserve: (element: Element) => void
} {
  const memoryManager = useMemoryManager()
  const observerRef = useRef<IntersectionObserver | null>(null)
  const callbackRef = useRef<IntersectionObserverCallback>()

  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    if (!('IntersectionObserver' in window)) return

    const observer = new IntersectionObserver(
      (entries, obs) => callbackRef.current?.(entries, obs),
      options
    )

    observerRef.current = observer
    memoryManager.registerObserver(observer)

    return () => {
      observer.disconnect()
    }
  }, [options, memoryManager])

  const observe = useCallback((element: Element) => {
    observerRef.current?.observe(element)
  }, [])

  const unobserve = useCallback((element: Element) => {
    observerRef.current?.unobserve(element)
  }, [])

  return {
    observer: observerRef.current,
    observe,
    unobserve,
  }
}

// Hook for managed fetch requests
export function useManagedFetch(): {
  fetch: (url: string, options?: RequestInit) => Promise<Response>
  abortAll: () => void
} {
  const memoryManager = useMemoryManager()

  const managedFetch = useCallback(
    async (url: string, options?: RequestInit): Promise<Response> => {
      const controller = memoryManager.createAbortController()
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      return response
    },
    [memoryManager]
  )

  const abortAll = useCallback(() => {
    memoryManager.cleanup()
  }, [memoryManager])

  return { fetch: managedFetch, abortAll }
}

// WebRTC cleanup utilities
export class WebRTCMemoryManager {
  private peerConnections = new Set<RTCPeerConnection>()
  private mediaStreams = new Set<MediaStream>()
  private datachannels = new Set<RTCDataChannel>()

  // Register peer connection for cleanup
  registerPeerConnection(pc: RTCPeerConnection): void {
    this.peerConnections.add(pc)

    // Auto-cleanup when connection closes
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
        this.cleanupPeerConnection(pc)
      }
    })
  }

  // Register media stream for cleanup
  registerMediaStream(stream: MediaStream): void {
    this.mediaStreams.add(stream)
  }

  // Register data channel for cleanup
  registerDataChannel(channel: RTCDataChannel): void {
    this.datachannels.add(channel)

    // Auto-cleanup when channel closes
    channel.addEventListener('close', () => {
      this.datachannels.delete(channel)
    })
  }

  // Clean up specific peer connection
  cleanupPeerConnection(pc: RTCPeerConnection): void {
    try {
      if (pc.connectionState !== 'closed') {
        pc.close()
      }
      this.peerConnections.delete(pc)
    } catch (error) {
      console.warn('Error cleaning up peer connection:', error)
    }
  }

  // Clean up specific media stream
  cleanupMediaStream(stream: MediaStream): void {
    try {
      stream.getTracks().forEach(track => {
        track.stop()
      })
      this.mediaStreams.delete(stream)
    } catch (error) {
      console.warn('Error cleaning up media stream:', error)
    }
  }

  // Clean up all WebRTC resources
  cleanup(): void {
    // Close all peer connections
    this.peerConnections.forEach(pc => {
      this.cleanupPeerConnection(pc)
    })

    // Stop all media streams
    this.mediaStreams.forEach(stream => {
      this.cleanupMediaStream(stream)
    })

    // Close all data channels
    this.datachannels.forEach(channel => {
      try {
        if (channel.readyState !== 'closed') {
          channel.close()
        }
      } catch (error) {
        console.warn('Error closing data channel:', error)
      }
    })

    this.peerConnections.clear()
    this.mediaStreams.clear()
    this.datachannels.clear()
  }

  // Get WebRTC memory statistics
  getStats(): {
    peerConnections: number
    mediaStreams: number
    dataChannels: number
  } {
    return {
      peerConnections: this.peerConnections.size,
      mediaStreams: this.mediaStreams.size,
      dataChannels: this.datachannels.size,
    }
  }
}

// Hook for WebRTC memory management
export function useWebRTCMemoryManager(): WebRTCMemoryManager {
  const managerRef = useRef<WebRTCMemoryManager>()

  if (!managerRef.current) {
    managerRef.current = new WebRTCMemoryManager()
  }

  useEffect(() => {
    const manager = managerRef.current!
    return () => {
      manager.cleanup()
    }
  }, [])

  return managerRef.current
}

// Memory leak detection utilities
export class MemoryLeakDetector {
  private initialMemory: number = 0
  private samples: number[] = []
  private interval: NodeJS.Timeout | null = null

  startMonitoring(): void {
    if (!('performance' in window) || !('memory' in (performance as any))) {
      console.warn('Memory monitoring not supported in this browser')
      return
    }

    const perf = performance as any
    this.initialMemory = perf.memory.usedJSHeapSize

    this.interval = setInterval(() => {
      const currentMemory = perf.memory.usedJSHeapSize
      this.samples.push(currentMemory)

      // Keep only last 50 samples
      if (this.samples.length > 50) {
        this.samples.shift()
      }

      // Check for memory leaks
      this.detectLeak()
    }, 10000) // Check every 10 seconds
  }

  private detectLeak(): void {
    if (this.samples.length < 10) return

    // Calculate trend
    const recentSamples = this.samples.slice(-10)
    const trend = recentSamples[recentSamples.length - 1] - recentSamples[0]
    const increase = trend / recentSamples[0]

    // Alert if memory increased by more than 50% over 10 samples
    if (increase > 0.5) {
      console.warn('Potential memory leak detected:', {
        initialMemory: this.formatBytes(this.initialMemory),
        currentMemory: this.formatBytes(recentSamples[recentSamples.length - 1]),
        trend: this.formatBytes(trend),
        increasePercentage: `${(increase * 100).toFixed(2)}%`,
      })
    }
  }

  stopMonitoring(): void {
    if (this.interval) {
      clearInterval(this.interval)
      this.interval = null
    }
  }

  getMemoryStats(): {
    initial: string
    current: string
    peak: string
    samples: number
  } | null {
    if (!('performance' in window) || !('memory' in (performance as any))) {
      return null
    }

    const perf = performance as any
    const current = perf.memory.usedJSHeapSize
    const peak = Math.max(...this.samples, current)

    return {
      initial: this.formatBytes(this.initialMemory),
      current: this.formatBytes(current),
      peak: this.formatBytes(peak),
      samples: this.samples.length,
    }
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB']
    let size = bytes
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    return `${size.toFixed(2)} ${units[unitIndex]}`
  }
}

// Hook for memory leak detection
export function useMemoryLeakDetector(): {
  detector: MemoryLeakDetector
  stats: ReturnType<MemoryLeakDetector['getMemoryStats']>
} {
  const detectorRef = useRef<MemoryLeakDetector>()
  const [stats, setStats] = useState<ReturnType<MemoryLeakDetector['getMemoryStats']>>(null)

  if (!detectorRef.current) {
    detectorRef.current = new MemoryLeakDetector()
  }

  useEffect(() => {
    const detector = detectorRef.current!
    
    // Start monitoring in development
    if (process.env.NODE_ENV === 'development') {
      detector.startMonitoring()

      // Update stats every 30 seconds
      const statsInterval = setInterval(() => {
        setStats(detector.getMemoryStats())
      }, 30000)

      return () => {
        detector.stopMonitoring()
        clearInterval(statsInterval)
      }
    }
  }, [])

  return {
    detector: detectorRef.current,
    stats,
  }
}

// Global memory managers
export const globalMemoryManager = new MemoryManager()
export const globalWebRTCManager = new WebRTCMemoryManager()
export const globalMemoryDetector = new MemoryLeakDetector()

// Advanced garbage collection optimization
export class GCOptimizer {
  private gcScheduler: number | null = null
  private memoryPressureThreshold = 0.8 // 80% of available memory
  private lastGCTime = 0

  // Monitor memory pressure and schedule GC
  startOptimization(): void {
    if (!this.isMemoryAPIAvailable()) {
      console.warn('Memory API not available for GC optimization')
      return
    }

    this.gcScheduler = window.setInterval(() => {
      this.checkMemoryPressure()
    }, 30000) // Check every 30 seconds
  }

  private isMemoryAPIAvailable(): boolean {
    return 'performance' in window && 
           'memory' in (performance as any) &&
           'gc' in window
  }

  private checkMemoryPressure(): void {
    if (!this.isMemoryAPIAvailable()) return

    const perf = performance as any
    const memoryInfo = perf.memory
    
    const memoryUsageRatio = memoryInfo.usedJSHeapSize / memoryInfo.jsHeapSizeLimit
    const timeSinceLastGC = Date.now() - this.lastGCTime

    // Trigger GC if memory usage is high and enough time has passed
    if (memoryUsageRatio > this.memoryPressureThreshold && timeSinceLastGC > 60000) {
      this.requestGarbageCollection()
    }
  }

  private requestGarbageCollection(): void {
    try {
      // Request garbage collection if available
      if ('gc' in window && typeof (window as any).gc === 'function') {
        (window as any).gc()
        this.lastGCTime = Date.now()
        console.debug('Garbage collection requested due to memory pressure')
      }
    } catch (error) {
      console.debug('Failed to request garbage collection:', error)
    }
  }

  // Manual GC trigger for critical moments
  forceGarbageCollection(): void {
    const now = Date.now()
    if (now - this.lastGCTime > 5000) { // Minimum 5 seconds between forced GC
      this.requestGarbageCollection()
    }
  }

  stopOptimization(): void {
    if (this.gcScheduler) {
      window.clearInterval(this.gcScheduler)
      this.gcScheduler = null
    }
  }
}

// Component lifecycle memory manager
export class ComponentMemoryManager extends MemoryManager {
  private componentRegistry = new Map<string, Set<() => void>>()
  private componentMemoryUsage = new Map<string, number>()

  // Register component with memory tracking
  registerComponent(componentId: string): () => void {
    if (!this.componentRegistry.has(componentId)) {
      this.componentRegistry.set(componentId, new Set())
    }

    // Track initial memory usage
    if (this.isMemoryAPIAvailable()) {
      const memInfo = (performance as any).memory
      this.componentMemoryUsage.set(componentId, memInfo.usedJSHeapSize)
    }

    // Return cleanup function
    return () => this.cleanupComponent(componentId)
  }

  // Add cleanup task for specific component
  addComponentCleanup(componentId: string, cleanup: () => void): void {
    const cleanups = this.componentRegistry.get(componentId)
    if (cleanups) {
      cleanups.add(cleanup)
      this.registerCleanup(cleanup)
    }
  }

  // Cleanup specific component
  cleanupComponent(componentId: string): void {
    const cleanups = this.componentRegistry.get(componentId)
    if (cleanups) {
      cleanups.forEach(cleanup => {
        try {
          cleanup()
        } catch (error) {
          console.warn(`Cleanup failed for component ${componentId}:`, error)
        }
      })
      cleanups.clear()
      this.componentRegistry.delete(componentId)
    }

    // Log memory change
    if (this.isMemoryAPIAvailable()) {
      const initialMemory = this.componentMemoryUsage.get(componentId)
      const currentMemory = (performance as any).memory.usedJSHeapSize
      
      if (initialMemory) {
        const memoryDiff = currentMemory - initialMemory
        console.debug(`Component ${componentId} memory impact: ${this.formatBytes(memoryDiff)}`)
        this.componentMemoryUsage.delete(componentId)
      }
    }
  }

  private isMemoryAPIAvailable(): boolean {
    return 'performance' in window && 'memory' in (performance as any)
  }

  private formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB']
    let size = Math.abs(bytes)
    let unitIndex = 0

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024
      unitIndex++
    }

    const sign = bytes < 0 ? '-' : '+'
    return `${sign}${size.toFixed(2)} ${units[unitIndex]}`
  }

  // Get component memory statistics
  getComponentStats(): {
    activeComponents: number
    totalCleanupTasks: number
    componentList: string[]
  } {
    const totalCleanupTasks = Array.from(this.componentRegistry.values())
      .reduce((total, cleanups) => total + cleanups.size, 0)

    return {
      activeComponents: this.componentRegistry.size,
      totalCleanupTasks,
      componentList: Array.from(this.componentRegistry.keys())
    }
  }
}

// Memory-efficient state management
export class MemoryEfficientStateManager {
  private state = new Map<string, any>()
  private subscriptions = new Map<string, Set<(value: any) => void>>()
  private stateHistory = new Map<string, any[]>()
  private maxHistorySize = 10

  // Set state with memory optimization
  setState<T>(key: string, value: T, keepHistory: boolean = false): void {
    const oldValue = this.state.get(key)
    
    // Only update if value actually changed (shallow comparison)
    if (oldValue !== value) {
      this.state.set(key, value)
      
      // Manage history
      if (keepHistory) {
        this.addToHistory(key, oldValue)
      }
      
      // Notify subscribers
      this.notifySubscribers(key, value)
    }
  }

  private addToHistory(key: string, value: any): void {
    if (!this.stateHistory.has(key)) {
      this.stateHistory.set(key, [])
    }
    
    const history = this.stateHistory.get(key)!
    history.push(value)
    
    // Limit history size to prevent memory leaks
    if (history.length > this.maxHistorySize) {
      history.shift()
    }
  }

  // Get state value
  getState<T>(key: string): T | undefined {
    return this.state.get(key)
  }

  // Subscribe to state changes
  subscribe(key: string, callback: (value: any) => void): () => void {
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, new Set())
    }
    
    this.subscriptions.get(key)!.add(callback)
    
    // Return unsubscribe function
    return () => {
      const subs = this.subscriptions.get(key)
      if (subs) {
        subs.delete(callback)
        if (subs.size === 0) {
          this.subscriptions.delete(key)
        }
      }
    }
  }

  private notifySubscribers(key: string, value: any): void {
    const subscribers = this.subscriptions.get(key)
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(value)
        } catch (error) {
          console.warn(`Subscription callback failed for key ${key}:`, error)
        }
      })
    }
  }

  // Clear unused state entries
  cleanup(): void {
    // Remove state keys with no subscribers
    const keysToRemove: string[] = []
    
    this.state.forEach((_, key) => {
      const hasSubscribers = this.subscriptions.has(key) && 
                           this.subscriptions.get(key)!.size > 0
      
      if (!hasSubscribers) {
        keysToRemove.push(key)
      }
    })
    
    keysToRemove.forEach(key => {
      this.state.delete(key)
      this.stateHistory.delete(key)
    })
    
    console.debug(`Cleaned up ${keysToRemove.length} unused state entries`)
  }

  // Get memory statistics
  getStats(): {
    stateEntries: number
    subscriptionGroups: number
    totalSubscribers: number
    historyEntries: number
  } {
    let totalSubscribers = 0
    let historyEntries = 0
    
    this.subscriptions.forEach(subs => {
      totalSubscribers += subs.size
    })
    
    this.stateHistory.forEach(history => {
      historyEntries += history.length
    })
    
    return {
      stateEntries: this.state.size,
      subscriptionGroups: this.subscriptions.size,
      totalSubscribers,
      historyEntries
    }
  }
}

// React hook for component memory tracking
export function useComponentMemoryTracking(componentName: string): {
  memoryManager: ComponentMemoryManager
  addCleanup: (cleanup: () => void) => void
  getStats: () => ReturnType<ComponentMemoryManager['getComponentStats']>
} {
  const managerRef = useRef<ComponentMemoryManager>()
  const componentIdRef = useRef<string>()

  if (!managerRef.current) {
    managerRef.current = new ComponentMemoryManager()
  }

  if (!componentIdRef.current) {
    componentIdRef.current = `${componentName}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  useEffect(() => {
    const cleanup = managerRef.current!.registerComponent(componentIdRef.current!)
    return cleanup
  }, [])

  const addCleanup = useCallback((cleanup: () => void) => {
    managerRef.current!.addComponentCleanup(componentIdRef.current!, cleanup)
  }, [])

  const getStats = useCallback(() => {
    return managerRef.current!.getComponentStats()
  }, [])

  return {
    memoryManager: managerRef.current,
    addCleanup,
    getStats
  }
}

// Global memory optimization instances
export const gcOptimizer = new GCOptimizer()
export const componentMemoryManager = new ComponentMemoryManager()
export const memoryEfficientStateManager = new MemoryEfficientStateManager()

// Initialize global memory monitoring and optimization
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  globalMemoryDetector.startMonitoring()
  gcOptimizer.startOptimization()
  
  // Log comprehensive memory stats every 60 seconds in development
  setInterval(() => {
    const stats = globalMemoryDetector.getMemoryStats()
    const memoryStats = globalMemoryManager.getMemoryStats()
    const webrtcStats = globalWebRTCManager.getStats()
    const componentStats = componentMemoryManager.getComponentStats()
    const stateStats = memoryEfficientStateManager.getStats()
    
    console.group('🧠 Memory Statistics')
    console.log('Browser Memory:', stats)
    console.log('Managed Resources:', memoryStats)
    console.log('WebRTC Resources:', webrtcStats)
    console.log('Component Tracking:', componentStats)
    console.log('State Management:', stateStats)
    console.groupEnd()
  }, 60000)

  // Cleanup state manager periodically
  setInterval(() => {
    memoryEfficientStateManager.cleanup()
  }, 300000) // Every 5 minutes

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    globalMemoryManager.cleanup()
    globalWebRTCManager.cleanup()
    globalMemoryDetector.stopMonitoring()
    gcOptimizer.stopOptimization()
    componentMemoryManager.cleanup()
  })
}