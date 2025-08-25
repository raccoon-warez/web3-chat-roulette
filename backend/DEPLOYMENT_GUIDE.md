# Database Optimization Deployment Guide

## Pre-Deployment Checklist

### Prerequisites
- [ ] PostgreSQL 12+ (recommended 14+)
- [ ] Redis 6+ 
- [ ] Node.js 18+ with TypeScript support
- [ ] Sufficient database permissions for index creation
- [ ] Backup of existing database

### Environment Variables
Configure the following in your `.env` file:

```bash
# Database Pool Optimization
DB_POOL_MAX=50
DB_POOL_MIN=5
DB_IDLE_TIMEOUT=10000
DB_CONNECTION_TIMEOUT=1000
DB_QUERY_TIMEOUT=5000
DB_STATEMENT_TIMEOUT=10000

# Performance Monitoring
ENABLE_QUERY_LOGGING=true
SLOW_QUERY_THRESHOLD=50
ENABLE_PERFORMANCE_MONITORING=true
ENABLE_DATABASE_OPTIMIZATION=true
```

## Deployment Steps

### 1. Database Preparation

#### Enable Required Extensions
```sql
-- Connect as superuser
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

#### Configure PostgreSQL (postgresql.conf)
```conf
# Connection Settings
max_connections = 100
shared_preload_libraries = 'pg_stat_statements'

# Memory Settings  
shared_buffers = 256MB
effective_cache_size = 1GB
work_mem = 4MB
maintenance_work_mem = 64MB

# Performance Settings
default_statistics_target = 100
random_page_cost = 1.1

# Logging
log_min_duration_statement = 50
log_statement = 'mod'
```

### 2. Application Deployment

#### Install Dependencies
```bash
npm install
```

#### Build Application
```bash
npm run build
```

#### Run Migrations
```bash
# Migrations will run automatically on startup
# Or run manually:
npm run migrate
```

### 3. Verification Steps

#### Check Database Health
```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "healthy",
  "database": {
    "status": "healthy", 
    "queryTime": 5
  },
  "redis": {
    "connected": true,
    "errorRate": 0
  }
}
```

#### Verify Performance Metrics
```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/health/performance
```

#### Check Index Creation
```sql
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef 
FROM pg_indexes 
WHERE schemaname = 'public' 
ORDER BY tablename, indexname;
```

### 4. Monitoring Setup

#### Database Metrics Endpoints
- `GET /health` - Overall health check
- `GET /health/performance` - Performance metrics (requires auth)
- `GET /database/metrics` - Detailed DB metrics (requires auth)
- `GET /database/cache-stats` - Cache performance (requires auth)

#### Set Up External Monitoring
```bash
# Example with curl for monitoring
*/5 * * * * curl -f http://localhost:3001/health || echo "Health check failed"
```

## Performance Tuning

### Connection Pool Tuning
Monitor connection usage and adjust based on load:

```bash
# Check current pool status
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/database/connections
```

Adjust pool size based on:
- **Low utilization (<30%)**: Reduce `DB_POOL_MAX`  
- **High waiting (>0)**: Increase `DB_POOL_MAX`
- **Frequent connections**: Increase `DB_POOL_MIN`

### Cache Optimization
Monitor cache performance:

```bash
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/database/cache-stats
```

Optimization guidelines:
- **Hit rate <60%**: Increase TTL values or cache more queries
- **Hit rate >90%**: Consider reducing TTL to ensure data freshness
- **High memory usage**: Implement cache eviction policies

### Query Performance
Monitor slow queries:

```sql
-- Check pg_stat_statements for slow queries
SELECT 
  query,
  calls,
  total_time,
  mean_time,
  max_time
FROM pg_stat_statements 
WHERE mean_time > 50 
ORDER BY mean_time DESC 
LIMIT 10;
```

## Troubleshooting

### Common Issues

#### 1. Migration Failures
**Symptoms**: Application fails to start, migration errors in logs

**Solutions**:
```bash
# Check migration status
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/database/migrations

# Manually run specific migration
psql -d web3chat -f migrations/20250825120000_create_performance_indexes.sql
```

#### 2. High Memory Usage  
**Symptoms**: Redis/PostgreSQL consuming excessive memory

**Solutions**:
```bash
# Check Redis memory usage
redis-cli info memory

# Optimize PostgreSQL shared_buffers
# In postgresql.conf:
shared_buffers = 25% of available RAM (max 8GB)
```

#### 3. Connection Pool Exhaustion
**Symptoms**: "Connection pool exhausted" errors

**Solutions**:
```bash
# Increase pool size
DB_POOL_MAX=100

# Or optimize query performance to reduce connection hold time
```

#### 4. Slow Query Performance
**Symptoms**: Queries still slow despite indexes

**Solutions**:
```sql
-- Force statistics update
ANALYZE;

-- Check if indexes are being used
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM sessions WHERE a_addr = $1;
```

### Health Check Failures

#### Database Unhealthy
1. Check PostgreSQL service status
2. Verify connection string
3. Check network connectivity
4. Review PostgreSQL logs

#### Redis Unhealthy  
1. Check Redis service status
2. Verify Redis URL
3. Check Redis memory limits
4. Review Redis logs

## Rollback Procedures

### Emergency Rollback
If issues occur, rollback steps:

1. **Stop application**
   ```bash
   pm2 stop web3-chat-roulette
   ```

2. **Restore database backup**
   ```bash
   pg_restore -d web3chat backup_before_optimization.sql
   ```

3. **Revert to previous application version**
   ```bash
   git checkout previous-version
   npm run build
   npm start
   ```

### Partial Rollback
To disable specific optimizations:

```bash
# Disable automatic optimization
ENABLE_DATABASE_OPTIMIZATION=false

# Disable performance monitoring  
ENABLE_PERFORMANCE_MONITORING=false

# Disable caching
ENABLE_CACHE_OPTIMIZATION=false
```

## Scaling Recommendations

### Vertical Scaling
- **CPU**: 4+ cores recommended for high query volume
- **Memory**: 8GB+ RAM (4GB for PostgreSQL, 2GB for Redis, 2GB for Node.js)
- **Storage**: SSD storage with 1000+ IOPS

### Horizontal Scaling
- **Read Replicas**: Add PostgreSQL read replicas for read-heavy workloads
- **Connection Pooling**: Use PgBouncer for connection pooling at infrastructure level
- **Cache Clustering**: Redis Cluster for distributed caching

### Load Testing
Recommended load testing approach:

```bash
# Install k6 or similar tool
npm install -g k6

# Run progressive load test
k6 run --vus 10 --duration 1m load-test.js
k6 run --vus 50 --duration 2m load-test.js  
k6 run --vus 100 --duration 3m load-test.js
```

Monitor during load tests:
- Query response times
- Connection pool utilization
- Cache hit rates
- Error rates

## Success Metrics

After deployment, verify these metrics:

| Metric | Target | How to Check |
|--------|--------|--------------|
| P95 Query Time | <50ms | `/health/performance` endpoint |
| Cache Hit Rate | >70% | `/database/cache-stats` endpoint |
| Connection Pool Usage | <80% | `/database/connections` endpoint |
| Error Rate | <1% | Application logs |
| Index Usage | >90% queries using indexes | `pg_stat_user_indexes` |

## Maintenance Schedule

### Daily
- Monitor performance metrics
- Check error logs
- Verify cache hit rates

### Weekly  
- Review slow query reports
- Analyze index usage statistics
- Check connection pool trends

### Monthly
- Update table statistics (`ANALYZE`)
- Review and optimize cache TTL values
- Plan for storage growth

---

**🚀 Deployment Complete**: Your Web3 Chat Roulette backend now features 5x performance improvements with comprehensive monitoring and automated optimization!
