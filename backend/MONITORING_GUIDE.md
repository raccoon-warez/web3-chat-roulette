# 📊 Web3 Chat Roulette - Comprehensive Monitoring & Error Tracking Guide

## Overview

This document provides a complete guide to the comprehensive production monitoring and error tracking system implemented for the Web3 Chat Roulette application. The system provides full observability and proactive issue detection through multiple monitoring layers.

## 🎯 Key Features

### ✅ Application Metrics
- **Prometheus Integration**: Custom metrics for API, WebSocket, and Web3 operations
- **Real-time Collection**: 15-second collection intervals with configurable retention
- **Business Metrics**: User actions, session tracking, matchmaking metrics
- **Performance Metrics**: Response times, error rates, resource usage

### ✅ Error Tracking
- **Comprehensive Capture**: Automatic error tracking with context preservation
- **Deduplication**: Intelligent error fingerprinting and grouping
- **Breadcrumb Trails**: Complete request/user journey tracking
- **Performance Issues**: Automatic detection of slow operations

### ✅ Health Monitoring
- **Multi-tier Checks**: Database, Redis, system, and external service monitoring
- **Failure Detection**: Configurable thresholds with escalating alerts
- **Recovery Tracking**: Automatic recovery notifications
- **Dependency Status**: Real-time health status for all critical components

### ✅ Real-time Alerts
- **Multiple Channels**: Email, Slack, webhooks, console notifications
- **Smart Throttling**: Rate limiting and cooldown periods to prevent spam
- **Severity-based Routing**: Different notification channels based on alert severity
- **Alert Management**: Resolution tracking and alert lifecycle management

### ✅ Uptime Monitoring
- **Synthetic Monitoring**: Automated endpoint availability checks
- **Response Time Tracking**: Comprehensive latency monitoring
- **Failure Alerting**: Configurable failure thresholds and recovery detection
- **Historical Data**: Uptime statistics and trend analysis

### ✅ Observability Dashboard
- **Real-time Visualization**: Live system metrics and status
- **REST API**: Complete API for custom integrations
- **Export Capabilities**: JSON/CSV data exports
- **Mobile Responsive**: Access from any device

## 📋 Quick Start

### 1. Environment Setup

Copy the monitoring configuration template:
```bash
cp .env.monitoring.template .env.monitoring
```

Configure essential settings:
```bash
# Required settings
JWT_ACCESS_SECRET=your-super-secure-access-secret
JWT_REFRESH_SECRET=your-super-secure-refresh-secret

# Email alerts (optional but recommended)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
ALERT_EMAIL_TO=admin@yourdomain.com

# Slack alerts (optional)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK
```

### 2. Start the Application

```bash
# Development mode
npm run dev

# Production mode (with cluster and monitoring)
npm run start:production
```

### 3. Access Monitoring

- **Main Dashboard**: http://localhost:3002
- **Health Endpoint**: http://localhost:3001/health
- **Metrics (Prometheus)**: http://localhost:3001/api/metrics
- **API Documentation**: http://localhost:3002/api/dashboard

## 🔧 Configuration

### Monitoring System Configuration

```typescript
// Default configuration
const monitoringConfig = {
  metrics: {
    enabled: true,
    collectInterval: 15000  // 15 seconds
  },
  healthChecks: {
    enabled: true,
    interval: 30000  // 30 seconds
  },
  alerts: {
    enabled: true,
    channels: ['console', 'email', 'slack']
  },
  uptime: {
    enabled: true,
    endpoints: ['http://localhost:3001/health']
  },
  dashboard: {
    enabled: true,
    port: 3002
  },
  errorTracking: {
    enabled: true,
    captureUnhandled: true
  }
};
```

### Alert Thresholds

Configure alert thresholds in your environment:

```bash
# Performance thresholds
ALERT_RESPONSE_TIME_WARNING=500      # 500ms
ALERT_RESPONSE_TIME_CRITICAL=2000    # 2 seconds
ALERT_ERROR_RATE_WARNING=5           # 5%
ALERT_ERROR_RATE_CRITICAL=10         # 10%

# Resource usage thresholds
ALERT_MEMORY_USAGE_WARNING=80        # 80%
ALERT_MEMORY_USAGE_CRITICAL=90       # 90%
ALERT_CPU_USAGE_WARNING=80           # 80%
ALERT_CPU_USAGE_CRITICAL=90          # 90%
```

## 📊 Monitoring Components

### 1. Metrics Collection

The system automatically collects:

- **HTTP Requests**: Count, duration, status codes, user types
- **WebSocket Connections**: Active connections, message count, session duration
- **Database Queries**: Query count, duration, success rate by operation/table
- **Redis Operations**: Operation count, duration, success rate
- **Web3 Transactions**: Transaction count, duration, gas costs by type/network
- **WebRTC Sessions**: Session count, duration, matchmaking time
- **System Resources**: CPU, memory, disk usage
- **Business Metrics**: User actions, active sessions, transaction volume

### 2. Error Tracking

Comprehensive error tracking includes:

```typescript
// Automatic error capture
errorTracker.captureError(error, {
  userId: 'user123',
  requestId: 'req_abc123',
  url: '/api/endpoint',
  method: 'POST',
  ip: '192.168.1.1'
});

// Performance issue tracking
errorTracker.capturePerformanceIssue('Database Query', 1500, 1000, {
  operation: 'SELECT',
  table: 'users'
});

// Custom message capture
errorTracker.captureMessage('Suspicious activity detected', 'warning', {
  ip: '192.168.1.1',
  action: 'multiple_failed_logins'
});
```

### 3. Health Monitoring

Health checks monitor:

- **Database**: Connection, query performance, pool status
- **Redis**: Connection, ping response, server info
- **System**: Memory usage, CPU load, disk space
- **External Services**: API endpoints, response times

### 4. Uptime Monitoring

Synthetic monitoring includes:

```typescript
// Standard checks created automatically
const uptimeChecks = [
  {
    id: 'api-health',
    name: 'API Health Check',
    url: 'http://localhost:3001/health',
    interval: 60000,    // 1 minute
    timeout: 5000,      // 5 seconds
    expectedStatusCode: 200
  }
];
```

## 🚨 Alert Management

### Alert Types and Severity

| Severity | Description | Channels | Cooldown |
|----------|-------------|-----------|----------|
| Critical | System down, database failure | All channels | 5 minutes |
| High | High error rate, slow response | Email, Slack, Console | 10 minutes |
| Medium | Performance degradation | Email, Console | 15 minutes |
| Low | Minor issues, warnings | Console only | 30 minutes |

### Custom Alert Rules

Add custom alert rules:

```typescript
alertManager.addAlertRule({
  id: 'custom-rule',
  name: 'Custom Alert Rule',
  condition: (data) => data.customMetric > threshold,
  severity: 'high',
  type: 'performance',
  cooldown: 15,
  channels: ['email', 'slack'],
  template: {
    title: 'Custom Alert: {{metric}} exceeded threshold',
    message: 'Value {{value}} exceeded threshold {{threshold}}'
  },
  enabled: true
});
```

## 📈 Dashboard Usage

### Main Dashboard

The main dashboard provides:

- **System Overview**: Overall health status and uptime
- **Real-time Metrics**: Current performance indicators
- **Alert Status**: Active alerts and recent notifications
- **Error Summary**: Top errors and error rates
- **Resource Usage**: CPU, memory, disk utilization

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/dashboard` | GET | Complete dashboard data |
| `/api/metrics` | GET | Prometheus metrics |
| `/api/health` | GET | System health status |
| `/api/alerts` | GET | Recent alerts |
| `/api/errors` | GET | Error tracking data |
| `/api/uptime` | GET | Uptime statistics |
| `/api/system` | GET | System information |

## 🔍 Troubleshooting

### Common Issues

#### 1. Dashboard Not Loading
```bash
# Check if monitoring port is available
netstat -an | grep 3002

# Check application logs
tail -f logs/combined.log
```

#### 2. Metrics Not Collecting
```bash
# Verify metrics endpoint
curl http://localhost:3001/api/metrics

# Check metrics configuration
grep METRICS_ENABLED .env
```

#### 3. Alerts Not Sending
```bash
# Test email configuration
node -e "console.log(require('./src/monitoring/alert-manager').alertManager)"

# Check alert logs
grep "Alert triggered" logs/combined.log
```

### Debugging

Enable debug mode:
```bash
DEBUG_MONITORING=true
VERBOSE_LOGGING=true
LOG_LEVEL=debug
```

### Log Analysis

Key log locations:
- **Combined Logs**: `logs/combined.log`
- **Error Logs**: `logs/error.log`
- **Request Logs**: `logs/requests.log`
- **Exception Logs**: `logs/exceptions.log`

## 🔗 Integration

### Prometheus Integration

Scrape configuration for Prometheus:

```yaml
scrape_configs:
  - job_name: 'web3-chat-roulette'
    static_configs:
      - targets: ['localhost:3001']
    metrics_path: '/api/metrics'
    scrape_interval: 15s
```

### Grafana Dashboards

Import the provided dashboard:
- Connect Grafana to Prometheus
- Import dashboard using `/api/metrics` endpoint
- Configure alerts in Grafana Alert Manager

### External Monitoring

Integrate with external services:

```bash
# Sentry integration
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id

# CloudWatch integration
AWS_CLOUDWATCH_ENABLED=true
AWS_REGION=us-east-1
```

## 📊 Best Practices

### 1. Monitoring Strategy
- Set up alerts for critical business metrics
- Monitor user experience metrics (response times, error rates)
- Track resource utilization trends
- Implement synthetic monitoring for key user journeys

### 2. Alert Management
- Use appropriate severity levels
- Implement escalation policies
- Set up on-call rotations
- Regularly review and tune alert thresholds

### 3. Data Retention
- Configure appropriate retention periods for different data types
- Implement data archiving for long-term analysis
- Monitor storage usage and cleanup regularly

### 4. Performance Optimization
- Use sampling for high-volume metrics
- Implement metric aggregation for storage efficiency
- Regular performance testing and benchmarking

## 🎯 Production Deployment

### Pre-deployment Checklist

- [ ] Configure monitoring environment variables
- [ ] Set up external alerting channels (email, Slack)
- [ ] Test alert delivery
- [ ] Configure log retention policies
- [ ] Set up monitoring dashboard access
- [ ] Configure health check endpoints
- [ ] Test graceful shutdown procedures

### Post-deployment Verification

- [ ] Verify all monitoring components are active
- [ ] Test alert functionality
- [ ] Confirm metrics collection
- [ ] Validate dashboard accessibility
- [ ] Check log file permissions and rotation
- [ ] Verify uptime monitoring is working

## 📞 Support

For monitoring system issues:

1. Check the monitoring logs: `logs/combined.log`
2. Verify configuration: Review environment variables
3. Test components individually: Use API endpoints to isolate issues
4. Review documentation: Check this guide and inline code comments

## 🔄 Maintenance

### Regular Maintenance Tasks

- **Weekly**: Review alert trends and adjust thresholds
- **Monthly**: Analyze performance metrics and optimize
- **Quarterly**: Review monitoring coverage and add new checks
- **Annually**: Evaluate monitoring tools and upgrade dependencies

### Monitoring the Monitoring

Set up meta-monitoring to ensure:
- Monitoring system uptime
- Alert delivery success rates
- Metrics collection completeness
- Dashboard availability

---

**Note**: This monitoring system is designed to be production-ready but should be customized based on your specific requirements and infrastructure setup.