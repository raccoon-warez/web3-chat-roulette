import { EventEmitter } from 'events';
import { HealthMonitor } from './health-monitor';
import { LoadBalancer } from './load-balancer';
import { ClusterManager } from '../cluster/cluster-manager';

interface ScalingMetrics {
  cpu: number;
  memory: number;
  responseTime: number;
  errorRate: number;
  activeConnections: number;
  requestsPerSecond: number;
  queueLength: number;
}

interface ScalingRule {
  name: string;
  metric: keyof ScalingMetrics;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  threshold: number;
  action: 'scale-up' | 'scale-down';
  cooldownPeriod: number; // milliseconds
  minInstances: number;
  maxInstances: number;
  scaleAmount: number; // number of instances to add/remove
  priority: number; // higher priority rules are evaluated first
}

interface ScalingConfig {
  enabled: boolean;
  evaluationInterval: number; // milliseconds
  rules: ScalingRule[];
  constraints: {
    minInstances: number;
    maxInstances: number;
    maxScaleUpPerInterval: number;
    maxScaleDownPerInterval: number;
  };
  stabilization: {
    scaleUpStabilizationWindow: number;
    scaleDownStabilizationWindow: number;
  };
}

interface ScalingEvent {
  timestamp: Date;
  action: 'scale-up' | 'scale-down';
  trigger: string;
  currentInstances: number;
  targetInstances: number;
  metrics: ScalingMetrics;
}

export class AutoScaler extends EventEmitter {
  private config: ScalingConfig;
  private healthMonitor: HealthMonitor;
  private loadBalancer?: LoadBalancer;
  private clusterManager?: ClusterManager;
  private evaluationInterval?: NodeJS.Timeout;
  private lastScalingActions: Map<string, Date> = new Map();
  private scalingHistory: ScalingEvent[] = [];
  private currentInstances = 1;
  private enabled = false;

  constructor(
    healthMonitor: HealthMonitor,
    config: Partial<ScalingConfig> = {}
  ) {
    super();

    this.healthMonitor = healthMonitor;
    this.config = {
      enabled: true,
      evaluationInterval: 60000, // 1 minute
      rules: [],
      constraints: {
        minInstances: 1,
        maxInstances: 10,
        maxScaleUpPerInterval: 2,
        maxScaleDownPerInterval: 1
      },
      stabilization: {
        scaleUpStabilizationWindow: 300000, // 5 minutes
        scaleDownStabilizationWindow: 600000 // 10 minutes
      },
      ...config
    };

    this.setupDefaultRules();
  }

  /**
   * Setup default scaling rules
   */
  private setupDefaultRules(): void {
    if (this.config.rules.length === 0) {
      this.config.rules = [
        // Scale up rules (higher priority)
        {
          name: 'high-cpu-scale-up',
          metric: 'cpu',
          operator: 'gte',
          threshold: 80,
          action: 'scale-up',
          cooldownPeriod: 300000, // 5 minutes
          minInstances: 1,
          maxInstances: 10,
          scaleAmount: 2,
          priority: 100
        },
        {
          name: 'high-memory-scale-up',
          metric: 'memory',
          operator: 'gte',
          threshold: 85,
          action: 'scale-up',
          cooldownPeriod: 300000,
          minInstances: 1,
          maxInstances: 10,
          scaleAmount: 1,
          priority: 95
        },
        {
          name: 'high-response-time-scale-up',
          metric: 'responseTime',
          operator: 'gte',
          threshold: 2000, // 2 seconds
          action: 'scale-up',
          cooldownPeriod: 180000, // 3 minutes
          minInstances: 1,
          maxInstances: 10,
          scaleAmount: 2,
          priority: 90
        },
        {
          name: 'high-error-rate-scale-up',
          metric: 'errorRate',
          operator: 'gte',
          threshold: 5, // 5%
          action: 'scale-up',
          cooldownPeriod: 120000, // 2 minutes
          minInstances: 1,
          maxInstances: 10,
          scaleAmount: 1,
          priority: 85
        },
        {
          name: 'high-connections-scale-up',
          metric: 'activeConnections',
          operator: 'gte',
          threshold: 1000,
          action: 'scale-up',
          cooldownPeriod: 240000, // 4 minutes
          minInstances: 1,
          maxInstances: 10,
          scaleAmount: 2,
          priority: 80
        },

        // Scale down rules (lower priority)
        {
          name: 'low-cpu-scale-down',
          metric: 'cpu',
          operator: 'lt',
          threshold: 20,
          action: 'scale-down',
          cooldownPeriod: 600000, // 10 minutes
          minInstances: 1,
          maxInstances: 10,
          scaleAmount: 1,
          priority: 20
        },
        {
          name: 'low-memory-scale-down',
          metric: 'memory',
          operator: 'lt',
          threshold: 30,
          action: 'scale-down',
          cooldownPeriod: 600000,
          minInstances: 1,
          maxInstances: 10,
          scaleAmount: 1,
          priority: 15
        },
        {
          name: 'low-response-time-scale-down',
          metric: 'responseTime',
          operator: 'lt',
          threshold: 200, // 200ms
          action: 'scale-down',
          cooldownPeriod: 900000, // 15 minutes
          minInstances: 1,
          maxInstances: 10,
          scaleAmount: 1,
          priority: 10
        }
      ];
    }

    // Sort rules by priority (highest first)
    this.config.rules.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Set load balancer reference
   */
  setLoadBalancer(loadBalancer: LoadBalancer): void {
    this.loadBalancer = loadBalancer;
  }

  /**
   * Set cluster manager reference
   */
  setClusterManager(clusterManager: ClusterManager): void {
    this.clusterManager = clusterManager;
  }

  /**
   * Start auto-scaling
   */
  start(): void {
    if (!this.config.enabled) {
      console.log('⚖️  Auto-scaling is disabled');
      return;
    }

    console.log(`🔄 Starting auto-scaler (evaluation interval: ${this.config.evaluationInterval}ms)`);
    console.log(`📏 Scaling constraints: ${this.config.constraints.minInstances}-${this.config.constraints.maxInstances} instances`);
    console.log(`📋 Active scaling rules: ${this.config.rules.length}`);

    this.enabled = true;

    this.evaluationInterval = setInterval(async () => {
      await this.evaluateScaling();
    }, this.config.evaluationInterval);

    // Initial evaluation
    setImmediate(() => this.evaluateScaling());
  }

  /**
   * Stop auto-scaling
   */
  stop(): void {
    console.log('🛑 Stopping auto-scaler');
    
    this.enabled = false;
    
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
    }
  }

  /**
   * Evaluate scaling decisions
   */
  private async evaluateScaling(): Promise<void> {
    if (!this.enabled) return;

    try {
      const metrics = await this.collectScalingMetrics();
      const decisions = this.evaluateRules(metrics);

      if (decisions.length > 0) {
        const finalDecision = this.consolidateDecisions(decisions);
        if (finalDecision) {
          await this.executeScalingDecision(finalDecision, metrics);
        }
      }

    } catch (error) {
      console.error('Auto-scaling evaluation error:', error);
      this.emit('scalingError', error);
    }
  }

  /**
   * Collect metrics for scaling decisions
   */
  private async collectScalingMetrics(): Promise<ScalingMetrics> {
    const healthMetrics = this.healthMonitor.getMetrics();
    const loadBalancerStats = this.loadBalancer?.getStats();

    return {
      cpu: healthMetrics.cpu.usage,
      memory: healthMetrics.memory.usage,
      responseTime: healthMetrics.application.responseTime,
      errorRate: healthMetrics.application.errorRate,
      activeConnections: healthMetrics.application.activeConnections,
      requestsPerSecond: healthMetrics.application.requestsPerSecond,
      queueLength: 0 // Could be implemented based on your queue system
    };
  }

  /**
   * Evaluate scaling rules against current metrics
   */
  private evaluateRules(metrics: ScalingMetrics): Array<{ rule: ScalingRule; triggered: boolean }> {
    const decisions: Array<{ rule: ScalingRule; triggered: boolean }> = [];

    for (const rule of this.config.rules) {
      // Check cooldown period
      const lastAction = this.lastScalingActions.get(rule.name);
      if (lastAction && Date.now() - lastAction.getTime() < rule.cooldownPeriod) {
        continue;
      }

      // Evaluate rule condition
      const metricValue = metrics[rule.metric];
      const triggered = this.evaluateCondition(metricValue, rule.operator, rule.threshold);

      decisions.push({ rule, triggered });

      // Log rule evaluation for debugging
      if (triggered) {
        console.log(`📊 Scaling rule triggered: ${rule.name} (${rule.metric}: ${metricValue} ${rule.operator} ${rule.threshold})`);
      }
    }

    return decisions.filter(d => d.triggered);
  }

  /**
   * Evaluate a single condition
   */
  private evaluateCondition(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt': return value > threshold;
      case 'gte': return value >= threshold;
      case 'lt': return value < threshold;
      case 'lte': return value <= threshold;
      case 'eq': return value === threshold;
      default: return false;
    }
  }

  /**
   * Consolidate multiple scaling decisions
   */
  private consolidateDecisions(decisions: Array<{ rule: ScalingRule; triggered: boolean }>): ScalingRule | null {
    if (decisions.length === 0) return null;

    // Group decisions by action
    const scaleUpDecisions = decisions.filter(d => d.rule.action === 'scale-up');
    const scaleDownDecisions = decisions.filter(d => d.rule.action === 'scale-down');

    // Scale up takes priority over scale down
    if (scaleUpDecisions.length > 0) {
      // Choose the highest priority scale-up rule
      return scaleUpDecisions.sort((a, b) => b.rule.priority - a.rule.priority)[0].rule;
    }

    if (scaleDownDecisions.length > 0) {
      // Check stabilization window for scale down
      if (this.shouldStabilizeScaleDown()) {
        console.log('📉 Scale down postponed due to stabilization window');
        return null;
      }

      // Choose the highest priority scale-down rule
      return scaleDownDecisions.sort((a, b) => b.rule.priority - a.rule.priority)[0].rule;
    }

    return null;
  }

  /**
   * Check if scale-down should be postponed for stabilization
   */
  private shouldStabilizeScaleDown(): boolean {
    const now = Date.now();
    const recentScaleUps = this.scalingHistory.filter(event => 
      event.action === 'scale-up' && 
      now - event.timestamp.getTime() < this.config.stabilization.scaleDownStabilizationWindow
    );

    return recentScaleUps.length > 0;
  }

  /**
   * Execute scaling decision
   */
  private async executeScalingDecision(rule: ScalingRule, metrics: ScalingMetrics): Promise<void> {
    const currentInstances = this.getCurrentInstanceCount();
    let targetInstances: number;

    if (rule.action === 'scale-up') {
      targetInstances = Math.min(
        currentInstances + rule.scaleAmount,
        this.config.constraints.maxInstances,
        rule.maxInstances
      );
      
      // Check max scale up per interval
      const recentScaleUps = this.getRecentScalingEvents('scale-up');
      if (recentScaleUps >= this.config.constraints.maxScaleUpPerInterval) {
        console.log('📈 Scale up postponed due to rate limiting');
        return;
      }
    } else {
      targetInstances = Math.max(
        currentInstances - rule.scaleAmount,
        this.config.constraints.minInstances,
        rule.minInstances
      );

      // Check max scale down per interval
      const recentScaleDowns = this.getRecentScalingEvents('scale-down');
      if (recentScaleDowns >= this.config.constraints.maxScaleDownPerInterval) {
        console.log('📉 Scale down postponed due to rate limiting');
        return;
      }
    }

    // No change needed
    if (targetInstances === currentInstances) {
      console.log(`⚖️  No scaling needed (current: ${currentInstances}, target: ${targetInstances})`);
      return;
    }

    console.log(`🔄 Executing scaling: ${rule.name} (${currentInstances} → ${targetInstances} instances)`);

    try {
      await this.performScaling(targetInstances, rule.action);

      // Record scaling event
      const scalingEvent: ScalingEvent = {
        timestamp: new Date(),
        action: rule.action,
        trigger: rule.name,
        currentInstances,
        targetInstances,
        metrics: { ...metrics }
      };

      this.scalingHistory.push(scalingEvent);
      this.lastScalingActions.set(rule.name, new Date());
      this.currentInstances = targetInstances;

      // Limit history size
      if (this.scalingHistory.length > 100) {
        this.scalingHistory = this.scalingHistory.slice(-50);
      }

      this.emit('scalingExecuted', scalingEvent);

    } catch (error) {
      console.error(`❌ Scaling execution failed for rule ${rule.name}:`, error);
      this.emit('scalingFailed', { rule, error, metrics });
    }
  }

  /**
   * Get recent scaling events count
   */
  private getRecentScalingEvents(action: 'scale-up' | 'scale-down'): number {
    const now = Date.now();
    const windowStart = now - this.config.evaluationInterval;

    return this.scalingHistory.filter(event =>
      event.action === action && 
      event.timestamp.getTime() >= windowStart
    ).length;
  }

  /**
   * Perform actual scaling operation
   */
  private async performScaling(targetInstances: number, action: 'scale-up' | 'scale-down'): Promise<void> {
    if (this.clusterManager) {
      // Scale using cluster manager
      this.clusterManager.scale(targetInstances);
    } else if (this.loadBalancer) {
      // Scale using load balancer (would need integration with orchestration system)
      console.log(`Load balancer scaling to ${targetInstances} instances`);
      // In a real implementation, this would integrate with Docker, Kubernetes, etc.
    } else {
      console.warn('No scaling executor available (cluster manager or load balancer)');
    }
  }

  /**
   * Get current instance count
   */
  private getCurrentInstanceCount(): number {
    if (this.clusterManager) {
      const status = this.clusterManager.getStatus();
      return status.activeWorkers;
    } else if (this.loadBalancer) {
      const stats = this.loadBalancer.getStats();
      return stats.healthyServers;
    } else {
      return this.currentInstances;
    }
  }

  /**
   * Add custom scaling rule
   */
  addRule(rule: ScalingRule): void {
    this.config.rules.push(rule);
    this.config.rules.sort((a, b) => b.priority - a.priority);
    console.log(`➕ Added scaling rule: ${rule.name}`);
  }

  /**
   * Remove scaling rule
   */
  removeRule(ruleName: string): void {
    const index = this.config.rules.findIndex(r => r.name === ruleName);
    if (index > -1) {
      this.config.rules.splice(index, 1);
      console.log(`➖ Removed scaling rule: ${ruleName}`);
    }
  }

  /**
   * Update scaling constraints
   */
  updateConstraints(constraints: Partial<ScalingConfig['constraints']>): void {
    this.config.constraints = { ...this.config.constraints, ...constraints };
    console.log('📏 Updated scaling constraints:', this.config.constraints);
  }

  /**
   * Get scaling statistics
   */
  getStats(): {
    enabled: boolean;
    currentInstances: number;
    constraints: ScalingConfig['constraints'];
    recentEvents: ScalingEvent[];
    activeRules: number;
  } {
    return {
      enabled: this.enabled,
      currentInstances: this.getCurrentInstanceCount(),
      constraints: this.config.constraints,
      recentEvents: this.scalingHistory.slice(-10), // Last 10 events
      activeRules: this.config.rules.length
    };
  }

  /**
   * Get scaling history
   */
  getScalingHistory(limit: number = 50): ScalingEvent[] {
    return this.scalingHistory.slice(-limit);
  }

  /**
   * Enable/disable auto-scaling
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
    if (enabled && !this.enabled) {
      this.start();
    } else if (!enabled && this.enabled) {
      this.stop();
    }
  }

  /**
   * Manual scaling trigger
   */
  async manualScale(targetInstances: number, reason: string = 'Manual trigger'): Promise<void> {
    if (targetInstances < this.config.constraints.minInstances || 
        targetInstances > this.config.constraints.maxInstances) {
      throw new Error(`Target instances (${targetInstances}) outside constraints (${this.config.constraints.minInstances}-${this.config.constraints.maxInstances})`);
    }

    const currentInstances = this.getCurrentInstanceCount();
    const action = targetInstances > currentInstances ? 'scale-up' : 'scale-down';

    console.log(`🔧 Manual scaling: ${reason} (${currentInstances} → ${targetInstances} instances)`);

    await this.performScaling(targetInstances, action);

    // Record manual scaling event
    const metrics = await this.collectScalingMetrics();
    const scalingEvent: ScalingEvent = {
      timestamp: new Date(),
      action,
      trigger: `Manual: ${reason}`,
      currentInstances,
      targetInstances,
      metrics
    };

    this.scalingHistory.push(scalingEvent);
    this.currentInstances = targetInstances;

    this.emit('manualScaling', scalingEvent);
  }
}