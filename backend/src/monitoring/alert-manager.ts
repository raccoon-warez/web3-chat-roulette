import { EventEmitter } from 'events';
import nodemailer from 'nodemailer';
import logger from './logger';
import { performance } from 'perf_hooks';

export interface Alert {
  id: string;
  type: 'error' | 'performance' | 'security' | 'health' | 'business';
  severity: 'low' | 'medium' | 'high' | 'critical';
  title: string;
  message: string;
  timestamp: Date;
  metadata?: any;
  resolved?: boolean;
  resolvedAt?: Date;
  resolvedBy?: string;
  notifications: NotificationAttempt[];
}

export interface NotificationAttempt {
  channel: string;
  timestamp: Date;
  success: boolean;
  error?: string;
  responseTime: number;
}

export interface AlertRule {
  id: string;
  name: string;
  condition: (data: any) => boolean;
  severity: Alert['severity'];
  type: Alert['type'];
  cooldown: number; // Minutes
  channels: string[];
  template: {
    title: string;
    message: string;
  };
  enabled: boolean;
}

export interface NotificationChannel {
  name: string;
  type: 'email' | 'slack' | 'webhook' | 'sms' | 'console';
  config: any;
  enabled: boolean;
  rateLimitMinutes: number;
}

export class AlertManager extends EventEmitter {
  private alerts: Map<string, Alert> = new Map();
  private alertRules: Map<string, AlertRule> = new Map();
  private notificationChannels: Map<string, NotificationChannel> = new Map();
  private cooldownTracker: Map<string, Date> = new Map();
  private rateLimitTracker: Map<string, number[]> = new Map();
  private emailTransporter?: nodemailer.Transporter;

  constructor() {
    super();
    this.initializeEmailTransporter();
    this.setupDefaultChannels();
    this.setupDefaultRules();
    
    // Cleanup old alerts periodically
    setInterval(() => this.cleanupOldAlerts(), 60 * 60 * 1000); // Every hour
  }

  /**
   * Send an alert
   */
  async sendAlert(alertData: Omit<Alert, 'id' | 'timestamp' | 'notifications'>): Promise<string> {
    const alert: Alert = {
      ...alertData,
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(),
      notifications: []
    };

    this.alerts.set(alert.id, alert);

    // Check cooldown for this type of alert
    const cooldownKey = `${alert.type}_${alert.severity}`;
    const lastAlert = this.cooldownTracker.get(cooldownKey);
    const cooldownPeriod = this.getCooldownPeriod(alert.severity);
    
    if (lastAlert && Date.now() - lastAlert.getTime() < cooldownPeriod * 60 * 1000) {
      logger.debug('Alert in cooldown period, skipping notifications', {
        alertId: alert.id,
        type: alert.type,
        severity: alert.severity
      });
      return alert.id;
    }

    this.cooldownTracker.set(cooldownKey, new Date());

    logger.warn('Alert triggered', {
      alertId: alert.id,
      type: alert.type,
      severity: alert.severity,
      title: alert.title,
      message: alert.message
    });

    // Determine notification channels based on severity
    const channels = this.getChannelsForSeverity(alert.severity);
    
    // Send notifications
    const notificationPromises = channels.map(channel => 
      this.sendNotification(alert, channel)
    );

    await Promise.allSettled(notificationPromises);

    // Emit alert event
    this.emit('alertTriggered', alert);

    return alert.id;
  }

  /**
   * Resolve an alert
   */
  resolveAlert(alertId: string, resolvedBy?: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.resolved = true;
    alert.resolvedAt = new Date();
    alert.resolvedBy = resolvedBy;

    logger.info('Alert resolved', {
      alertId,
      resolvedBy,
      duration: alert.resolvedAt.getTime() - alert.timestamp.getTime()
    });

    this.emit('alertResolved', alert);
    return true;
  }

  /**
   * Add alert rule
   */
  addAlertRule(rule: AlertRule): void {
    this.alertRules.set(rule.id, rule);
    logger.info(`Alert rule added: ${rule.name}`);
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId: string): boolean {
    const removed = this.alertRules.delete(ruleId);
    if (removed) {
      logger.info(`Alert rule removed: ${ruleId}`);
    }
    return removed;
  }

  /**
   * Add notification channel
   */
  addNotificationChannel(channel: NotificationChannel): void {
    this.notificationChannels.set(channel.name, channel);
    logger.info(`Notification channel added: ${channel.name} (${channel.type})`);
  }

  /**
   * Process data against alert rules
   */
  processAlertRules(data: any): void {
    for (const rule of this.alertRules.values()) {
      if (!rule.enabled) continue;

      try {
        if (rule.condition(data)) {
          this.sendAlert({
            type: rule.type,
            severity: rule.severity,
            title: this.interpolateTemplate(rule.template.title, data),
            message: this.interpolateTemplate(rule.template.message, data),
            metadata: data
          });
        }
      } catch (error) {
        logger.error('Error processing alert rule', {
          ruleId: rule.id,
          error: error.message
        });
      }
    }
  }

  /**
   * Get alert statistics
   */
  getAlertStats(timeRange: { start: Date; end: Date } = {
    start: new Date(Date.now() - 24 * 60 * 60 * 1000),
    end: new Date()
  }): {
    total: number;
    bySeverity: Record<string, number>;
    byType: Record<string, number>;
    resolved: number;
    averageResolutionTime: number;
    topAlerts: Array<{ title: string; count: number }>;
  } {
    const alerts = Array.from(this.alerts.values()).filter(alert =>
      alert.timestamp >= timeRange.start && alert.timestamp <= timeRange.end
    );

    const bySeverity: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const alertTitles: Record<string, number> = {};
    let totalResolutionTime = 0;
    let resolvedCount = 0;

    alerts.forEach(alert => {
      bySeverity[alert.severity] = (bySeverity[alert.severity] || 0) + 1;
      byType[alert.type] = (byType[alert.type] || 0) + 1;
      alertTitles[alert.title] = (alertTitles[alert.title] || 0) + 1;

      if (alert.resolved && alert.resolvedAt) {
        resolvedCount++;
        totalResolutionTime += alert.resolvedAt.getTime() - alert.timestamp.getTime();
      }
    });

    const topAlerts = Object.entries(alertTitles)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([title, count]) => ({ title, count }));

    return {
      total: alerts.length,
      bySeverity,
      byType,
      resolved: resolvedCount,
      averageResolutionTime: resolvedCount > 0 ? totalResolutionTime / resolvedCount : 0,
      topAlerts
    };
  }

  /**
   * Get recent alerts
   */
  getRecentAlerts(limit: number = 50): Alert[] {
    return Array.from(this.alerts.values())
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  /**
   * Send notification to specific channel
   */
  private async sendNotification(alert: Alert, channelName: string): Promise<void> {
    const channel = this.notificationChannels.get(channelName);
    if (!channel || !channel.enabled) {
      return;
    }

    // Rate limiting check
    if (!this.checkRateLimit(channelName, channel.rateLimitMinutes)) {
      logger.debug('Notification rate limited', { channel: channelName, alert: alert.id });
      return;
    }

    const startTime = performance.now();
    let success = false;
    let error = '';

    try {
      switch (channel.type) {
        case 'email':
          await this.sendEmailNotification(alert, channel);
          break;
        case 'slack':
          await this.sendSlackNotification(alert, channel);
          break;
        case 'webhook':
          await this.sendWebhookNotification(alert, channel);
          break;
        case 'sms':
          await this.sendSMSNotification(alert, channel);
          break;
        case 'console':
          this.sendConsoleNotification(alert, channel);
          break;
        default:
          throw new Error(`Unknown channel type: ${channel.type}`);
      }
      success = true;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      logger.error('Failed to send notification', {
        channel: channelName,
        alertId: alert.id,
        error
      });
    }

    const responseTime = performance.now() - startTime;
    
    alert.notifications.push({
      channel: channelName,
      timestamp: new Date(),
      success,
      error: success ? undefined : error,
      responseTime
    });
  }

  /**
   * Send email notification
   */
  private async sendEmailNotification(alert: Alert, channel: NotificationChannel): Promise<void> {
    if (!this.emailTransporter) {
      throw new Error('Email transporter not configured');
    }

    const { to, from } = channel.config;
    
    const mailOptions = {
      from,
      to: Array.isArray(to) ? to.join(', ') : to,
      subject: `[${alert.severity.toUpperCase()}] ${alert.title}`,
      html: this.formatEmailAlert(alert),
      text: `${alert.title}\n\n${alert.message}\n\nSeverity: ${alert.severity}\nTime: ${alert.timestamp.toISOString()}`
    };

    await this.emailTransporter.sendMail(mailOptions);
  }

  /**
   * Send Slack notification
   */
  private async sendSlackNotification(alert: Alert, channel: NotificationChannel): Promise<void> {
    const { webhookUrl } = channel.config;
    
    const color = this.getSeverityColor(alert.severity);
    const payload = {
      attachments: [
        {
          color,
          title: alert.title,
          text: alert.message,
          fields: [
            { title: 'Severity', value: alert.severity.toUpperCase(), short: true },
            { title: 'Type', value: alert.type, short: true },
            { title: 'Time', value: alert.timestamp.toISOString(), short: true },
            { title: 'Alert ID', value: alert.id, short: true }
          ],
          footer: 'Web3 Chat Roulette Monitoring',
          ts: Math.floor(alert.timestamp.getTime() / 1000)
        }
      ]
    };

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Slack API error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Send webhook notification
   */
  private async sendWebhookNotification(alert: Alert, channel: NotificationChannel): Promise<void> {
    const { url, method = 'POST', headers = {} } = channel.config;
    
    const payload = {
      alert,
      timestamp: new Date().toISOString(),
      source: 'web3-chat-roulette-monitoring'
    };

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Webhook error: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * Send SMS notification
   */
  private async sendSMSNotification(alert: Alert, channel: NotificationChannel): Promise<void> {
    // SMS implementation would depend on provider (Twilio, AWS SNS, etc.)
    logger.warn('SMS notifications not implemented yet', { alert: alert.id });
  }

  /**
   * Send console notification
   */
  private sendConsoleNotification(alert: Alert, channel: NotificationChannel): void {
    const color = alert.severity === 'critical' ? '\x1b[31m' : 
                  alert.severity === 'high' ? '\x1b[33m' : '\x1b[36m';
    const reset = '\x1b[0m';
    
    console.log(`${color}🚨 ALERT [${alert.severity.toUpperCase()}]: ${alert.title}${reset}`);
    console.log(`   ${alert.message}`);
    console.log(`   Time: ${alert.timestamp.toISOString()}`);
    console.log(`   ID: ${alert.id}`);
    console.log('');
  }

  /**
   * Initialize email transporter
   */
  private initializeEmailTransporter(): void {
    const emailConfig = {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    };

    if (emailConfig.host && emailConfig.auth.user) {
      this.emailTransporter = nodemailer.createTransport(emailConfig);
      logger.info('Email transporter initialized');
    } else {
      logger.warn('Email configuration incomplete, email notifications disabled');
    }
  }

  /**
   * Setup default notification channels
   */
  private setupDefaultChannels(): void {
    // Console channel (always available)
    this.addNotificationChannel({
      name: 'console',
      type: 'console',
      config: {},
      enabled: true,
      rateLimitMinutes: 1 // 1 minute
    });

    // Email channel (if configured)
    if (process.env.SMTP_HOST && process.env.ALERT_EMAIL_TO) {
      this.addNotificationChannel({
        name: 'email',
        type: 'email',
        config: {
          to: process.env.ALERT_EMAIL_TO.split(','),
          from: process.env.ALERT_EMAIL_FROM || process.env.SMTP_USER
        },
        enabled: true,
        rateLimitMinutes: 5
      });
    }

    // Slack channel (if configured)
    if (process.env.SLACK_WEBHOOK_URL) {
      this.addNotificationChannel({
        name: 'slack',
        type: 'slack',
        config: {
          webhookUrl: process.env.SLACK_WEBHOOK_URL
        },
        enabled: true,
        rateLimitMinutes: 2
      });
    }
  }

  /**
   * Setup default alert rules
   */
  private setupDefaultRules(): void {
    // High error rate rule
    this.addAlertRule({
      id: 'high-error-rate',
      name: 'High Error Rate',
      condition: (data) => data.errorRate && data.errorRate > 10, // 10% error rate
      severity: 'high',
      type: 'error',
      cooldown: 15,
      channels: ['console', 'email', 'slack'],
      template: {
        title: 'High Error Rate Detected',
        message: 'Error rate has exceeded 10% ({{errorRate}}%)'
      },
      enabled: true
    });

    // Critical error rule
    this.addAlertRule({
      id: 'critical-error',
      name: 'Critical Error',
      condition: (data) => data.severity === 'critical',
      severity: 'critical',
      type: 'error',
      cooldown: 5,
      channels: ['console', 'email', 'slack'],
      template: {
        title: 'Critical Error Occurred',
        message: '{{message}}'
      },
      enabled: true
    });

    // Performance degradation rule
    this.addAlertRule({
      id: 'slow-response',
      name: 'Slow Response Time',
      condition: (data) => data.responseTime && data.responseTime > 5000,
      severity: 'medium',
      type: 'performance',
      cooldown: 10,
      channels: ['console', 'email'],
      template: {
        title: 'Slow Response Time',
        message: 'Response time exceeded 5 seconds ({{responseTime}}ms)'
      },
      enabled: true
    });
  }

  /**
   * Check rate limiting for channel
   */
  private checkRateLimit(channelName: string, rateLimitMinutes: number): boolean {
    const now = Date.now();
    const windowStart = now - (rateLimitMinutes * 60 * 1000);
    
    if (!this.rateLimitTracker.has(channelName)) {
      this.rateLimitTracker.set(channelName, []);
    }

    const timestamps = this.rateLimitTracker.get(channelName)!;
    
    // Remove old timestamps
    const validTimestamps = timestamps.filter(ts => ts > windowStart);
    
    // Check if under limit (1 notification per rate limit window)
    if (validTimestamps.length >= 1) {
      return false;
    }

    // Add current timestamp and update
    validTimestamps.push(now);
    this.rateLimitTracker.set(channelName, validTimestamps);
    
    return true;
  }

  /**
   * Get channels for severity level
   */
  private getChannelsForSeverity(severity: Alert['severity']): string[] {
    switch (severity) {
      case 'critical':
        return ['console', 'email', 'slack', 'sms'];
      case 'high':
        return ['console', 'email', 'slack'];
      case 'medium':
        return ['console', 'email'];
      case 'low':
        return ['console'];
      default:
        return ['console'];
    }
  }

  /**
   * Get cooldown period for severity
   */
  private getCooldownPeriod(severity: Alert['severity']): number {
    switch (severity) {
      case 'critical': return 5;   // 5 minutes
      case 'high': return 10;      // 10 minutes
      case 'medium': return 15;    // 15 minutes
      case 'low': return 30;       // 30 minutes
      default: return 15;
    }
  }

  /**
   * Get color for severity in Slack
   */
  private getSeverityColor(severity: Alert['severity']): string {
    switch (severity) {
      case 'critical': return 'danger';
      case 'high': return 'warning';
      case 'medium': return '#ffaa00';
      case 'low': return 'good';
      default: return '#cccccc';
    }
  }

  /**
   * Interpolate template with data
   */
  private interpolateTemplate(template: string, data: any): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return data[key] || match;
    });
  }

  /**
   * Format email alert HTML
   */
  private formatEmailAlert(alert: Alert): string {
    const severityColor = {
      critical: '#dc3545',
      high: '#fd7e14',
      medium: '#ffc107',
      low: '#28a745'
    }[alert.severity] || '#6c757d';

    return `
      <div style="font-family: Arial, sans-serif; max-width: 600px;">
        <div style="background-color: ${severityColor}; color: white; padding: 20px; border-radius: 5px 5px 0 0;">
          <h2 style="margin: 0;">🚨 ${alert.title}</h2>
          <p style="margin: 5px 0 0 0;">Severity: ${alert.severity.toUpperCase()}</p>
        </div>
        <div style="background-color: #f8f9fa; padding: 20px; border: 1px solid #dee2e6; border-radius: 0 0 5px 5px;">
          <p><strong>Message:</strong> ${alert.message}</p>
          <p><strong>Time:</strong> ${alert.timestamp.toISOString()}</p>
          <p><strong>Type:</strong> ${alert.type}</p>
          <p><strong>Alert ID:</strong> ${alert.id}</p>
          ${alert.metadata ? `<p><strong>Metadata:</strong><br><pre style="background: #e9ecef; padding: 10px; border-radius: 3px;">${JSON.stringify(alert.metadata, null, 2)}</pre></p>` : ''}
        </div>
        <div style="margin-top: 20px; font-size: 12px; color: #6c757d;">
          <p>Web3 Chat Roulette Monitoring System</p>
        </div>
      </div>
    `;
  }

  /**
   * Cleanup old alerts
   */
  private cleanupOldAlerts(): void {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
    
    for (const [id, alert] of this.alerts.entries()) {
      if (alert.timestamp < cutoff) {
        this.alerts.delete(id);
      }
    }

    logger.debug('Alert cleanup completed', { 
      remainingAlerts: this.alerts.size 
    });
  }
}

export const alertManager = new AlertManager();