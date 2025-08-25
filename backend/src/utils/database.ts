import { Pool, PoolClient, PoolConfig } from 'pg';
import { initializeRedis } from './redis';
import { QueryPerformanceMonitor } from '../database/performance-monitor';
import { DatabaseOptimizer } from '../database/optimizer';
import { CacheManager } from '../database/cache-manager';

// Performance-optimized PostgreSQL connection pool
const poolConfig: PoolConfig = {
  connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/web3chat',
  
  // Connection Pool Settings - Optimized for high throughput
  max: parseInt(process.env.DB_POOL_MAX || '50'), // Increased from 20
  min: parseInt(process.env.DB_POOL_MIN || '5'), // Minimum connections
  
  // Timeout Settings - Optimized for sub-50ms queries
  idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT || '10000'), // Reduced from 30s
  connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT || '1000'), // Reduced from 2s
  
  // Query Settings
  query_timeout: parseInt(process.env.DB_QUERY_TIMEOUT || '5000'), // 5s timeout
  statement_timeout: parseInt(process.env.DB_STATEMENT_TIMEOUT || '10000'), // 10s timeout
  
  // Connection Settings
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  
  // SSL Settings (for production)
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  
  // Application name for monitoring
  application_name: 'web3-chat-roulette',
};

// Create optimized connection pool
const pool = new Pool(poolConfig);

// Initialize performance monitoring
const performanceMonitor = new QueryPerformanceMonitor();
const optimizer = new DatabaseOptimizer(pool);
const cacheManager = new CacheManager();

// Pool event handlers for monitoring
pool.on('connect', (client) => {
  console.log('New database client connected');
  performanceMonitor.recordConnection();
});

pool.on('error', (err, client) => {
  console.error('Database pool error:', err);
  performanceMonitor.recordError(err);
});

pool.on('remove', (client) => {
  console.log('Database client removed from pool');
  performanceMonitor.recordDisconnection();
});

// Enhanced query wrapper with performance monitoring and caching
const query = async (text: string, params?: any[], options?: QueryOptions): Promise<any> => {
  const startTime = Date.now();
  const queryId = performanceMonitor.generateQueryId();
  
  try {
    // Check cache first if enabled
    if (options?.cache?.enabled) {
      const cached = await cacheManager.get(options.cache.key || text, params);
      if (cached) {
        performanceMonitor.recordCacheHit(queryId, Date.now() - startTime);
        return cached;
      }
    }
    
    // Execute query with prepared statements for better performance
    const result = await pool.query(text, params);
    const duration = Date.now() - startTime;
    
    // Record performance metrics
    performanceMonitor.recordQuery(queryId, {
      query: text,
      params,
      duration,
      rows: result.rows.length,
      success: true
    });
    
    // Cache result if enabled
    if (options?.cache?.enabled && options.cache.ttl) {
      await cacheManager.set(
        options.cache.key || text, 
        result, 
        options.cache.ttl, 
        params
      );
    }
    
    // Alert if query is slow
    if (duration > (options?.slowQueryThreshold || 50)) {
      console.warn(`Slow query detected (${duration}ms):`, {
        queryId,
        query: text.substring(0, 100),
        duration,
        params: params?.length
      });
    }
    
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    performanceMonitor.recordQuery(queryId, {
      query: text,
      params,
      duration,
      error: error.message,
      success: false
    });
    throw error;
  }
};

// Transaction wrapper with optimizations
const withTransaction = async <T>(
  callback: (client: PoolClient) => Promise<T>,
  options?: TransactionOptions
): Promise<T> => {
  const client = await pool.connect();
  const startTime = Date.now();
  
  try {
    await client.query('BEGIN');
    
    // Set transaction isolation level if specified
    if (options?.isolationLevel) {
      await client.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolationLevel}`);
    }
    
    const result = await callback(client);
    await client.query('COMMIT');
    
    const duration = Date.now() - startTime;
    performanceMonitor.recordTransaction(duration, true);
    
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    const duration = Date.now() - startTime;
    performanceMonitor.recordTransaction(duration, false);
    throw error;
  } finally {
    client.release();
  }
};

// Batch insert optimization
const batchInsert = async (
  table: string,
  columns: string[],
  values: any[][],
  options?: BatchInsertOptions
): Promise<void> => {
  if (values.length === 0) return;
  
  const batchSize = options?.batchSize || 1000;
  const batches = [];
  
  // Split into batches
  for (let i = 0; i < values.length; i += batchSize) {
    batches.push(values.slice(i, i + batchSize));
  }
  
  // Execute batches
  for (const batch of batches) {
    const placeholders = batch
      .map((_, rowIndex) => 
        `(${columns.map((_, colIndex) => `$${rowIndex * columns.length + colIndex + 1}`).join(', ')})`
      )
      .join(', ');
    
    const flatValues = batch.flat();
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders}`;
    
    await query(sql, flatValues, { 
      slowQueryThreshold: options?.slowQueryThreshold || 100 
    });
  }
};

// Database health check
const healthCheck = async (): Promise<DatabaseHealth> => {
  try {
    const startTime = Date.now();
    await query('SELECT 1');
    const queryTime = Date.now() - startTime;
    
    const poolInfo = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    };
    
    return {
      status: 'healthy',
      queryTime,
      pool: poolInfo,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    };
  }
};

// Initialize database with optimizations
const initializeDatabase = async (): Promise<void> => {
  try {
    // Test database connection
    const client = await pool.connect();
    console.log('Connected to PostgreSQL database');
    
    // Set optimized connection parameters
    await client.query(`
      SET default_statistics_target = 100;
      SET random_page_cost = 1.1;
      SET effective_cache_size = '1GB';
      SET shared_preload_libraries = 'pg_stat_statements';
    `);
    
    client.release();
    
    // Initialize components
    await initializeRedis();
    await performanceMonitor.initialize();
    await optimizer.initialize();
    await cacheManager.initialize();
    
    // Start background optimization tasks
    setInterval(async () => {
      await optimizer.analyzeAndOptimize();
    }, 300000); // Every 5 minutes
    
    // Start performance monitoring
    setInterval(async () => {
      const metrics = await performanceMonitor.getMetrics();
      if (metrics.averageQueryTime > 50) {
        console.warn('Database performance degradation detected:', metrics);
      }
    }, 60000); // Every minute
    
    console.log('Database optimization system initialized');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
};

// Create tables with optimized schema
const createTables = async (): Promise<void> => {
  const client = await pool.connect();
  
  try {
    // Create users table with optimizations
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        wallet_address VARCHAR(42) PRIMARY KEY,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        ens_name VARCHAR(255),
        risk_score INTEGER DEFAULT 0 CHECK (risk_score >= 0 AND risk_score <= 100),
        last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        session_count INTEGER DEFAULT 0,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    // Create sessions table with partitioning support
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY,
        a_addr VARCHAR(42) NOT NULL,
        b_addr VARCHAR(42) NOT NULL,
        started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP WITH TIME ZONE,
        reason_end VARCHAR(50),
        chain_id INTEGER NOT NULL DEFAULT 1,
        tip_count INTEGER DEFAULT 0,
        reported BOOLEAN DEFAULT FALSE,
        duration_seconds INTEGER GENERATED ALWAYS AS (
          CASE WHEN ended_at IS NOT NULL 
          THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER 
          ELSE NULL END
        ) STORED,
        created_date DATE GENERATED ALWAYS AS (started_at::DATE) STORED
      );
    `);
    
    // Create reports table
    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        reporter_addr VARCHAR(42) NOT NULL,
        target_addr VARCHAR(42) NOT NULL,
        session_id VARCHAR(255),
        reason_enum VARCHAR(50) NOT NULL,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) DEFAULT 'pending',
        resolved_at TIMESTAMP WITH TIME ZONE,
        resolved_by VARCHAR(42)
      );
    `);
    
    // Create blocks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        blocker_addr VARCHAR(42) NOT NULL,
        blocked_addr VARCHAR(42) NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        reason VARCHAR(100),
        expires_at TIMESTAMP WITH TIME ZONE,
        active BOOLEAN DEFAULT TRUE,
        PRIMARY KEY (blocker_addr, blocked_addr)
      );
    `);
    
    // Create nonces table with automatic cleanup
    await client.query(`
      CREATE TABLE IF NOT EXISTS nonces (
        address VARCHAR(42) NOT NULL,
        nonce VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
        consumed BOOLEAN DEFAULT FALSE,
        consumed_at TIMESTAMP WITH TIME ZONE,
        PRIMARY KEY (address, nonce)
      );
    `);
    
    // Create partitioned telemetry_events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id SERIAL,
        address VARCHAR(42),
        type VARCHAR(100) NOT NULL,
        payload JSONB,
        ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_date DATE GENERATED ALWAYS AS (ts::DATE) STORED
      ) PARTITION BY RANGE (created_date);
    `);
    
    // Create balances cache table
    await client.query(`
      CREATE TABLE IF NOT EXISTS balances (
        address VARCHAR(42) NOT NULL,
        chain_id INTEGER NOT NULL,
        native_balance DECIMAL(78, 18),
        native_usd_value DECIMAL(18, 8),
        erc20_tokens JSONB DEFAULT '[]'::jsonb,
        total_usd_value DECIMAL(18, 8),
        last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (address, chain_id)
      );
    `);
    
    // Create query stats table
    await client.query(`
      CREATE TABLE IF NOT EXISTS query_stats (
        id SERIAL PRIMARY KEY,
        query_hash VARCHAR(64) NOT NULL,
        query_text TEXT NOT NULL,
        execution_count INTEGER DEFAULT 0,
        total_duration_ms BIGINT DEFAULT 0,
        avg_duration_ms DECIMAL(10, 2) DEFAULT 0,
        min_duration_ms INTEGER DEFAULT 0,
        max_duration_ms INTEGER DEFAULT 0,
        last_executed TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
    
    console.log('Database tables created successfully');
  } catch (error) {
    console.error('Error creating tables:', error);
    throw error;
  } finally {
    client.release();
  }
};

// Interface definitions
interface QueryOptions {
  cache?: {
    enabled: boolean;
    key?: string;
    ttl?: number;
  };
  slowQueryThreshold?: number;
}

interface TransactionOptions {
  isolationLevel?: 'READ UNCOMMITTED' | 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
}

interface BatchInsertOptions {
  batchSize?: number;
  slowQueryThreshold?: number;
}

interface DatabaseHealth {
  status: 'healthy' | 'unhealthy';
  queryTime?: number;
  pool?: {
    totalCount: number;
    idleCount: number;
    waitingCount: number;
  };
  error?: string;
  timestamp: string;
}

// Export optimized database utilities
export { 
  pool, 
  query,
  withTransaction,
  batchInsert,
  healthCheck,
  initializeDatabase, 
  createTables,
  performanceMonitor,
  optimizer,
  cacheManager
};
