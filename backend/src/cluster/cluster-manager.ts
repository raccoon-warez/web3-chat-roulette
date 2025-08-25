import cluster from 'cluster';
import os from 'os';
import { EventEmitter } from 'events';

interface ClusterConfig {
  workers?: number;
  autoRestart?: boolean;
  maxRestarts?: number;
  restartDelay?: number;
  gracefulShutdownTimeout?: number;
}

interface WorkerInfo {
  pid: number;
  restarts: number;
  lastRestart: Date;
  status: 'starting' | 'ready' | 'stopping' | 'dead';
}

export class ClusterManager extends EventEmitter {
  private config: Required<ClusterConfig>;
  private workers: Map<number, WorkerInfo> = new Map();
  private shuttingDown = false;

  constructor(config: ClusterConfig = {}) {
    super();
    
    this.config = {
      workers: config.workers || os.cpus().length,
      autoRestart: config.autoRestart ?? true,
      maxRestarts: config.maxRestarts || 5,
      restartDelay: config.restartDelay || 5000,
      gracefulShutdownTimeout: config.gracefulShutdownTimeout || 30000
    };

    this.setupMasterEventHandlers();
  }

  /**
   * Start the cluster
   */
  start(): void {
    if (!cluster.isPrimary) {
      throw new Error('ClusterManager can only be used in the primary process');
    }

    console.log(`🚀 Starting cluster with ${this.config.workers} workers`);
    
    // Fork workers
    for (let i = 0; i < this.config.workers; i++) {
      this.forkWorker();
    }

    // Setup graceful shutdown
    this.setupGracefulShutdown();
    
    this.emit('clusterStarted', {
      workers: this.config.workers,
      timestamp: new Date()
    });
  }

  /**
   * Fork a new worker
   */
  private forkWorker(): cluster.Worker {
    const worker = cluster.fork();
    
    this.workers.set(worker.id, {
      pid: worker.process.pid!,
      restarts: 0,
      lastRestart: new Date(),
      status: 'starting'
    });

    worker.on('message', (message) => {
      this.handleWorkerMessage(worker, message);
    });

    worker.on('online', () => {
      const workerInfo = this.workers.get(worker.id);
      if (workerInfo) {
        workerInfo.status = 'ready';
        console.log(`✅ Worker ${worker.id} (PID: ${worker.process.pid}) is online`);
      }
    });

    worker.on('exit', (code, signal) => {
      this.handleWorkerExit(worker, code, signal);
    });

    return worker;
  }

  /**
   * Handle worker messages
   */
  private handleWorkerMessage(worker: cluster.Worker, message: any): void {
    switch (message.type) {
      case 'ready':
        const workerInfo = this.workers.get(worker.id);
        if (workerInfo) {
          workerInfo.status = 'ready';
        }
        break;
      
      case 'health':
        this.emit('workerHealth', {
          workerId: worker.id,
          pid: worker.process.pid,
          health: message.data
        });
        break;
      
      case 'metrics':
        this.emit('workerMetrics', {
          workerId: worker.id,
          pid: worker.process.pid,
          metrics: message.data
        });
        break;
      
      case 'error':
        console.error(`Worker ${worker.id} error:`, message.error);
        this.emit('workerError', {
          workerId: worker.id,
          pid: worker.process.pid,
          error: message.error
        });
        break;
    }
  }

  /**
   * Handle worker exit
   */
  private handleWorkerExit(worker: cluster.Worker, code: number, signal: string): void {
    const workerInfo = this.workers.get(worker.id);
    
    if (workerInfo) {
      workerInfo.status = 'dead';
      console.log(`⚠️  Worker ${worker.id} (PID: ${workerInfo.pid}) died with code ${code} and signal ${signal}`);
    }

    this.workers.delete(worker.id);

    // Don't restart during shutdown
    if (this.shuttingDown) {
      return;
    }

    // Auto-restart if enabled
    if (this.config.autoRestart && workerInfo) {
      if (workerInfo.restarts < this.config.maxRestarts) {
        setTimeout(() => {
          console.log(`🔄 Restarting worker ${worker.id} (restart ${workerInfo.restarts + 1}/${this.config.maxRestarts})`);
          const newWorker = this.forkWorker();
          const newWorkerInfo = this.workers.get(newWorker.id);
          if (newWorkerInfo) {
            newWorkerInfo.restarts = workerInfo.restarts + 1;
          }
        }, this.config.restartDelay);
      } else {
        console.error(`❌ Worker ${worker.id} exceeded max restarts (${this.config.maxRestarts})`);
        this.emit('workerMaxRestartsExceeded', { workerId: worker.id });
      }
    }
  }

  /**
   * Setup master event handlers
   */
  private setupMasterEventHandlers(): void {
    // Handle worker disconnections
    cluster.on('disconnect', (worker) => {
      console.log(`Worker ${worker.id} disconnected`);
    });

    // Handle fork events
    cluster.on('fork', (worker) => {
      console.log(`Forking worker ${worker.id}`);
    });
  }

  /**
   * Setup graceful shutdown
   */
  private setupGracefulShutdown(): void {
    const signals: NodeJS.Signals[] = ['SIGTERM', 'SIGINT', 'SIGUSR2'];
    
    signals.forEach(signal => {
      process.on(signal, () => {
        console.log(`📡 Received ${signal}. Starting graceful cluster shutdown...`);
        this.gracefulShutdown();
      });
    });
  }

  /**
   * Graceful shutdown of all workers
   */
  async gracefulShutdown(): Promise<void> {
    if (this.shuttingDown) {
      return;
    }

    this.shuttingDown = true;
    this.emit('shuttingDown');

    console.log('🛑 Initiating graceful shutdown of all workers...');

    const shutdownPromises: Promise<void>[] = [];

    // Send shutdown signal to all workers
    for (const worker of Object.values(cluster.workers || {})) {
      if (worker && !worker.isDead()) {
        shutdownPromises.push(this.shutdownWorker(worker));
      }
    }

    try {
      // Wait for all workers to shut down
      await Promise.allSettled(shutdownPromises);
      console.log('✅ All workers shut down gracefully');
    } catch (error) {
      console.error('❌ Error during graceful shutdown:', error);
    }

    this.emit('shutdownComplete');
    process.exit(0);
  }

  /**
   * Shutdown individual worker
   */
  private shutdownWorker(worker: cluster.Worker): Promise<void> {
    return new Promise((resolve) => {
      const workerInfo = this.workers.get(worker.id);
      if (workerInfo) {
        workerInfo.status = 'stopping';
      }

      // Set timeout for forced shutdown
      const forceTimeout = setTimeout(() => {
        console.warn(`⚠️  Force killing worker ${worker.id} (timeout exceeded)`);
        worker.kill('SIGKILL');
        resolve();
      }, this.config.gracefulShutdownTimeout);

      // Listen for worker exit
      worker.once('exit', () => {
        clearTimeout(forceTimeout);
        resolve();
      });

      // Send graceful shutdown signal
      worker.send({ type: 'shutdown' });
      worker.disconnect();
    });
  }

  /**
   * Get cluster status
   */
  getStatus(): {
    totalWorkers: number;
    activeWorkers: number;
    workers: Array<{
      id: number;
      pid: number;
      status: string;
      restarts: number;
      uptime: number;
    }>;
  } {
    const workers = Object.values(cluster.workers || {})
      .filter((worker): worker is cluster.Worker => worker !== undefined)
      .map(worker => {
        const info = this.workers.get(worker.id);
        return {
          id: worker.id,
          pid: worker.process.pid || 0,
          status: info?.status || 'unknown',
          restarts: info?.restarts || 0,
          uptime: info ? Date.now() - info.lastRestart.getTime() : 0
        };
      });

    return {
      totalWorkers: this.config.workers,
      activeWorkers: workers.filter(w => w.status === 'ready').length,
      workers
    };
  }

  /**
   * Broadcast message to all workers
   */
  broadcast(message: any): void {
    for (const worker of Object.values(cluster.workers || {})) {
      if (worker && !worker.isDead()) {
        worker.send(message);
      }
    }
  }

  /**
   * Send message to specific worker
   */
  sendToWorker(workerId: number, message: any): boolean {
    const worker = cluster.workers?.[workerId];
    if (worker && !worker.isDead()) {
      worker.send(message);
      return true;
    }
    return false;
  }

  /**
   * Scale cluster (add/remove workers)
   */
  scale(targetWorkers: number): void {
    const currentWorkers = Object.keys(cluster.workers || {}).length;
    
    if (targetWorkers > currentWorkers) {
      // Scale up
      const workersToAdd = targetWorkers - currentWorkers;
      console.log(`📈 Scaling up: adding ${workersToAdd} workers`);
      
      for (let i = 0; i < workersToAdd; i++) {
        this.forkWorker();
      }
    } else if (targetWorkers < currentWorkers) {
      // Scale down
      const workersToRemove = currentWorkers - targetWorkers;
      console.log(`📉 Scaling down: removing ${workersToRemove} workers`);
      
      let removed = 0;
      for (const worker of Object.values(cluster.workers || {})) {
        if (worker && !worker.isDead() && removed < workersToRemove) {
          worker.kill('SIGTERM');
          removed++;
        }
      }
    }
    
    this.config.workers = targetWorkers;
    this.emit('scaled', { targetWorkers, currentWorkers });
  }
}

/**
 * Worker-side cluster utilities
 */
export class WorkerUtils {
  private healthCheckInterval?: NodeJS.Timeout;
  private metricsInterval?: NodeJS.Timeout;

  constructor() {
    this.setupWorkerHandlers();
  }

  /**
   * Setup worker message handlers
   */
  private setupWorkerHandlers(): void {
    if (cluster.isWorker) {
      // Handle messages from master
      process.on('message', (message) => {
        if (message.type === 'shutdown') {
          this.gracefulShutdown();
        }
      });

      // Notify master when ready
      process.nextTick(() => {
        this.sendToMaster({ type: 'ready' });
      });
    }
  }

  /**
   * Send message to master
   */
  sendToMaster(message: any): void {
    if (cluster.isWorker && process.send) {
      process.send(message);
    }
  }

  /**
   * Start health reporting
   */
  startHealthReporting(interval: number = 30000): void {
    this.healthCheckInterval = setInterval(() => {
      const health = {
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      };

      this.sendToMaster({ type: 'health', data: health });
    }, interval);
  }

  /**
   * Start metrics reporting
   */
  startMetricsReporting(interval: number = 60000): void {
    this.metricsInterval = setInterval(() => {
      const metrics = {
        workerId: cluster.worker?.id,
        pid: process.pid,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
      };

      this.sendToMaster({ type: 'metrics', data: metrics });
    }, interval);
  }

  /**
   * Report error to master
   */
  reportError(error: Error): void {
    this.sendToMaster({ 
      type: 'error', 
      error: {
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Graceful worker shutdown
   */
  private async gracefulShutdown(): Promise<void> {
    console.log(`Worker ${cluster.worker?.id} starting graceful shutdown...`);

    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    try {
      // Close server gracefully (implementation depends on your server setup)
      console.log(`Worker ${cluster.worker?.id} shutdown complete`);
      process.exit(0);
    } catch (error) {
      console.error(`Worker ${cluster.worker?.id} shutdown error:`, error);
      process.exit(1);
    }
  }

  /**
   * Stop health and metrics reporting
   */
  stop(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
  }
}