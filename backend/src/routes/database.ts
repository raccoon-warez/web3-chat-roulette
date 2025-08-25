import express from 'express';
import authenticateToken, { AuthRequest } from '../middleware/auth';
import { generalRateLimit } from '../middleware/rateLimiter';
import { 
  pool, 
  healthCheck, 
  performanceMonitor, 
  optimizer, 
  cacheManager 
} from '../utils/database';

const router = express.Router();

// GET /database/health - Database health check
router.get('/health',
  generalRateLimit,
  async (req: express.Request, res: express.Response): Promise<any> => {
    try {
      const health = await healthCheck();
      
      // Get additional metrics
      const [performanceMetrics, cacheStats] = await Promise.all([
        performanceMonitor.getMetrics(),
        cacheManager.getStats()
      ]);
      
      const response = {
        database: health,
        performance: performanceMetrics,
        cache: cacheStats,
        timestamp: new Date().toISOString()
      };
      
      // Set appropriate status code
      const statusCode = health.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(response);
      
    } catch (error) {
      console.error('Database health check error:', error);
      res.status(500).json({
        database: { status: 'error', error: error.message },
        timestamp: new Date().toISOString()
      });
    }
  }
);

// GET /database/metrics - Detailed performance metrics (authenticated)
router.get('/metrics',
  generalRateLimit,
  authenticateToken,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const [
        performanceMetrics,
        slowQueries,
        queryStats,
        indexStats,
        dbSize
      ] = await Promise.all([
        performanceMonitor.getMetrics(),
        performanceMonitor.getSlowQueries(20),
        performanceMonitor.getQueryStats(),
        optimizer.getIndexUsageStats(),
        optimizer.getDatabaseSize()
      ]);
      
      res.json({
        performance: performanceMetrics,
        slowQueries,
        queryStats: queryStats.slice(0, 10), // Top 10 queries by total time
        indexUsage: indexStats.slice(0, 20), // Top 20 indexes
        databaseSize: dbSize,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Database metrics error:', error);
      res.status(500).json({
        error: 'Failed to fetch database metrics',
        code: 'METRICS_FETCH_FAILED'
      });
    }
  }
);

// GET /database/cache-stats - Cache performance statistics
router.get('/cache-stats',
  generalRateLimit,
  authenticateToken,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const cacheStats = await cacheManager.getStats();
      
      res.json({
        cache: cacheStats,
        recommendations: [
          cacheStats.hitRate < 70 ? 'Consider increasing cache TTL for frequently accessed data' : null,
          cacheStats.totalKeys > 10000 ? 'Consider implementing cache cleanup strategies' : null,
        ].filter(Boolean),
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Cache stats error:', error);
      res.status(500).json({
        error: 'Failed to fetch cache statistics',
        code: 'CACHE_STATS_FAILED'
      });
    }
  }
);

// POST /database/optimize - Trigger database optimization (authenticated)
router.post('/optimize',
  generalRateLimit,
  authenticateToken,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      console.log(`Database optimization triggered by ${req.user!.address}`);
      
      const result = await optimizer.analyzeAndOptimize();
      
      res.json({
        message: 'Database optimization completed',
        result,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Database optimization error:', error);
      res.status(500).json({
        error: 'Failed to optimize database',
        code: 'OPTIMIZATION_FAILED'
      });
    }
  }
);

// POST /database/cache/clear - Clear cache (authenticated)
router.post('/cache/clear',
  generalRateLimit,
  authenticateToken,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const { tags } = req.body;
      
      if (tags && Array.isArray(tags)) {
        const invalidatedCount = await cacheManager.invalidateByTags(tags);
        res.json({
          message: `Cache cleared for ${tags.length} tags`,
          invalidatedEntries: invalidatedCount,
          tags,
          timestamp: new Date().toISOString()
        });
      } else {
        await cacheManager.clear();
        res.json({
          message: 'All cache entries cleared',
          timestamp: new Date().toISOString()
        });
      }
      
    } catch (error) {
      console.error('Cache clear error:', error);
      res.status(500).json({
        error: 'Failed to clear cache',
        code: 'CACHE_CLEAR_FAILED'
      });
    }
  }
);

// GET /database/connections - Connection pool status
router.get('/connections',
  generalRateLimit,
  authenticateToken,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const poolInfo = {
        totalCount: pool.totalCount,
        idleCount: pool.idleCount,
        waitingCount: pool.waitingCount,
        maxConnections: parseInt(process.env.DB_POOL_MAX || '50'),
        utilization: pool.totalCount > 0 
          ? ((pool.totalCount - pool.idleCount) / pool.totalCount * 100).toFixed(2) + '%'
          : '0%'
      };
      
      const status = pool.waitingCount > 0 ? 'warning' : 'healthy';
      const recommendations = [];
      
      if (pool.waitingCount > 0) {
        recommendations.push('Connection pool exhausted - consider increasing max connections');
      }
      
      if (pool.totalCount === parseInt(process.env.DB_POOL_MAX || '50')) {
        recommendations.push('Connection pool at maximum capacity - monitor for performance issues');
      }
      
      res.json({
        status,
        connections: poolInfo,
        recommendations,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Connection pool status error:', error);
      res.status(500).json({
        error: 'Failed to get connection pool status',
        code: 'POOL_STATUS_FAILED'
      });
    }
  }
);

// GET /database/query-analysis - Analysis of query patterns
router.get('/query-analysis',
  generalRateLimit,
  authenticateToken,
  async (req: AuthRequest, res: express.Response): Promise<any> => {
    try {
      const client = await pool.connect();
      
      try {
        // Get query statistics from pg_stat_statements if available
        const queryAnalysis = await client.query(`
          SELECT 
            query,
            calls,
            total_time,
            mean_time,
            max_time,
            min_time,
            rows,
            100.0 * shared_blks_hit / nullif(shared_blks_hit + shared_blks_read, 0) AS hit_percent
          FROM pg_stat_statements 
          WHERE calls > 5
          ORDER BY total_time DESC 
          LIMIT 20
        `);
        
        // Get table statistics
        const tableStats = await client.query(`
          SELECT 
            schemaname,
            tablename,
            n_tup_ins,
            n_tup_upd,
            n_tup_del,
            n_live_tup,
            n_dead_tup,
            last_vacuum,
            last_analyze
          FROM pg_stat_user_tables 
          ORDER BY n_live_tup DESC
        `);
        
        res.json({
          queryStatistics: queryAnalysis.rows,
          tableStatistics: tableStats.rows,
          analysis: {
            totalTrackedQueries: queryAnalysis.rows.length,
            averageHitPercent: queryAnalysis.rows.length > 0 
              ? (queryAnalysis.rows.reduce((sum, row) => sum + (row.hit_percent || 0), 0) / queryAnalysis.rows.length).toFixed(2) + '%'
              : 'N/A'
          },
          timestamp: new Date().toISOString()
        });
        
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('Query analysis error:', error);
      
      // If pg_stat_statements is not available, return basic analysis
      const basicStats = await performanceMonitor.getQueryStats();
      res.json({
        queryStatistics: basicStats,
        message: 'Advanced query analysis requires pg_stat_statements extension',
        timestamp: new Date().toISOString()
      });
    }
  }
);

export default router;
