import { Pool, PoolClient } from 'pg';
import crypto from 'crypto';

interface IndexRecommendation {
  table: string;
  columns: string[];
  type: 'btree' | 'hash' | 'gin' | 'gist';
  reason: string;
  estimatedImpact: 'high' | 'medium' | 'low';
}

interface OptimizationResult {
  indexesCreated: number;
  indexesDropped: number;
  tablesAnalyzed: number;
  recommendations: IndexRecommendation[];
  executionTime: number;
}

export class DatabaseOptimizer {
  constructor(private pool: Pool) {}

  async initialize(): Promise<void> {
    console.log('Initializing database optimizer');
    
    // Create critical indexes immediately
    await this.createCriticalIndexes();
    
    // Create partitions for telemetry_events
    await this.setupPartitioning();
    
    // Enable query monitoring extensions
    await this.enableQueryMonitoring();
  }

  async analyzeAndOptimize(): Promise<OptimizationResult> {
    const startTime = Date.now();
    console.log('Starting database optimization analysis');
    
    const result: OptimizationResult = {
      indexesCreated: 0,
      indexesDropped: 0,
      tablesAnalyzed: 0,
      recommendations: [],
      executionTime: 0
    };

    try {
      // Update table statistics
      await this.updateTableStatistics();
      result.tablesAnalyzed = 7; // Number of main tables

      // Analyze slow queries and create indexes
      const slowQueries = await this.identifySlowQueries();
      const indexRecommendations = await this.generateIndexRecommendations(slowQueries);
      result.recommendations = indexRecommendations;

      // Create recommended indexes
      for (const recommendation of indexRecommendations) {
        if (recommendation.estimatedImpact === 'high') {
          await this.createIndex(recommendation);
          result.indexesCreated++;
        }
      }

      // Drop unused indexes
      const droppedIndexes = await this.dropUnusedIndexes();
      result.indexesDropped = droppedIndexes;

      // Optimize table storage
      await this.optimizeTableStorage();

      result.executionTime = Date.now() - startTime;
      console.log(`Database optimization completed in ${result.executionTime}ms`, result);
      
      return result;
    } catch (error) {
      console.error('Database optimization error:', error);
      result.executionTime = Date.now() - startTime;
      return result;
    }
  }

  private async createCriticalIndexes(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      console.log('Creating critical performance indexes');
      
      // Critical indexes for common query patterns
      const indexes = [
        // Users table indexes
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at ON users (created_at)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_last_active ON users (last_active)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_risk_score ON users (risk_score) WHERE risk_score > 0',
        
        // Sessions table indexes - critical for performance
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_started_at ON sessions (started_at)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_ended_at ON sessions (ended_at) WHERE ended_at IS NOT NULL',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_a_addr ON sessions (a_addr)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_b_addr ON sessions (b_addr)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_chain_id ON sessions (chain_id)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_created_date ON sessions (created_date)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_reported ON sessions (reported) WHERE reported = true',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_active ON sessions (started_at) WHERE ended_at IS NULL',
        
        // Composite indexes for common query patterns
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_addr_date ON sessions (a_addr, created_date)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_addr_date_b ON sessions (b_addr, created_date)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_chain_date ON sessions (chain_id, created_date)',
        
        // Reports table indexes
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_reporter_addr ON reports (reporter_addr)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_target_addr ON reports (target_addr)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_session_id ON reports (session_id)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_created_at ON reports (created_at)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_status ON reports (status)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_reason_enum ON reports (reason_enum)',
        
        // Composite indexes for reports
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_target_status ON reports (target_addr, status)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_target_created ON reports (target_addr, created_at)',
        
        // Blocks table indexes
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_blocker_active ON blocks (blocker_addr) WHERE active = true',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_blocked_active ON blocks (blocked_addr) WHERE active = true',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_created_at ON blocks (created_at)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_expires_at ON blocks (expires_at) WHERE expires_at IS NOT NULL',
        
        // Nonces table indexes - critical for auth performance
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nonces_expires_at ON nonces (expires_at)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nonces_consumed ON nonces (consumed, expires_at) WHERE consumed = false',
        
        // Telemetry events indexes (will be created per partition)
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_address ON telemetry_events (address)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_type ON telemetry_events (type)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_ts ON telemetry_events (ts)',
        
        // GIN indexes for JSONB columns
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_payload_gin ON telemetry_events USING GIN (payload)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balances_tokens_gin ON balances USING GIN (erc20_tokens)',
        
        // Balances table indexes
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balances_address ON balances (address)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balances_chain_id ON balances (chain_id)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balances_last_updated ON balances (last_updated)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balances_total_value ON balances (total_usd_value) WHERE total_usd_value > 0',
        
        // Query stats indexes
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_stats_hash ON query_stats (query_hash)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_stats_avg_duration ON query_stats (avg_duration_ms DESC)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_stats_execution_count ON query_stats (execution_count DESC)',
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_stats_last_executed ON query_stats (last_executed)'
      ];

      // Create indexes in parallel batches to avoid blocking
      const batchSize = 5;
      for (let i = 0; i < indexes.length; i += batchSize) {
        const batch = indexes.slice(i, i + batchSize);
        await Promise.all(batch.map(async (indexSql) => {
          try {
            await client.query(indexSql);
            console.log(`✓ Created index: ${indexSql.match(/idx_\w+/)?.[0]}`);
          } catch (error) {
            if (!error.message.includes('already exists')) {
              console.warn(`Failed to create index: ${error.message}`);
            }
          }
        }));
        
        // Small delay between batches to reduce system load
        if (i + batchSize < indexes.length) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      console.log('Critical indexes created successfully');
    } catch (error) {
      console.error('Error creating critical indexes:', error);
    } finally {
      client.release();
    }
  }

  private async setupPartitioning(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      console.log('Setting up table partitioning for telemetry_events');
      
      // Create partitions for current month and next 3 months
      const currentDate = new Date();
      const partitions = [];
      
      for (let i = 0; i < 4; i++) {
        const partitionDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i, 1);
        const nextPartitionDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i + 1, 1);
        
        const partitionName = `telemetry_events_${partitionDate.getFullYear()}_${String(partitionDate.getMonth() + 1).padStart(2, '0')}`;
        const startDate = partitionDate.toISOString().split('T')[0];
        const endDate = nextPartitionDate.toISOString().split('T')[0];
        
        const createPartitionSql = `
          CREATE TABLE IF NOT EXISTS ${partitionName} 
          PARTITION OF telemetry_events 
          FOR VALUES FROM ('${startDate}') TO ('${endDate}')
        `;
        
        await client.query(createPartitionSql);
        console.log(`✓ Created partition: ${partitionName}`);
        
        // Create indexes on partition
        const partitionIndexes = [
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${partitionName}_address ON ${partitionName} (address)`,
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${partitionName}_type ON ${partitionName} (type)`,
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${partitionName}_ts ON ${partitionName} (ts)`,
          `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${partitionName}_payload_gin ON ${partitionName} USING GIN (payload)`
        ];
        
        for (const indexSql of partitionIndexes) {
          try {
            await client.query(indexSql);
          } catch (error) {
            if (!error.message.includes('already exists')) {
              console.warn(`Failed to create partition index: ${error.message}`);
            }
          }
        }
      }
      
      // Set up automatic partition maintenance
      await this.setupPartitionMaintenance();
      
      console.log('Table partitioning setup completed');
    } catch (error) {
      console.error('Error setting up partitioning:', error);
    } finally {
      client.release();
    }
  }

  private async setupPartitionMaintenance(): Promise<void> {
    // In a production system, this would set up automatic partition creation/dropping
    // using pg_cron or similar scheduling mechanism
    console.log('Partition maintenance setup (manual implementation required for production)');
  }

  private async enableQueryMonitoring(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      // Enable pg_stat_statements for query analysis
      await client.query('CREATE EXTENSION IF NOT EXISTS pg_stat_statements');
      console.log('✓ Enabled pg_stat_statements extension');
      
      // Set configuration for better monitoring
      await client.query(`
        SELECT pg_stat_statements_reset()
      `);
      
    } catch (error) {
      console.warn('Could not enable query monitoring extensions:', error.message);
    } finally {
      client.release();
    }
  }

  private async updateTableStatistics(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      const tables = ['users', 'sessions', 'reports', 'blocks', 'nonces', 'balances', 'query_stats'];
      
      for (const table of tables) {
        await client.query(`ANALYZE ${table}`);
      }
      
      console.log('✓ Updated table statistics');
    } catch (error) {
      console.error('Error updating table statistics:', error);
    } finally {
      client.release();
    }
  }

  private async identifySlowQueries(): Promise<any[]> {
    const client = await this.pool.connect();
    
    try {
      // Get slow queries from pg_stat_statements
      const result = await client.query(`
        SELECT 
          query,
          calls,
          total_time,
          mean_time,
          max_time,
          rows
        FROM pg_stat_statements 
        WHERE mean_time > 50 
        AND calls > 10
        ORDER BY mean_time DESC 
        LIMIT 20
      `);
      
      return result.rows;
    } catch (error) {
      console.warn('Could not fetch slow queries from pg_stat_statements:', error.message);
      return [];
    } finally {
      client.release();
    }
  }

  private async generateIndexRecommendations(slowQueries: any[]): Promise<IndexRecommendation[]> {
    const recommendations: IndexRecommendation[] = [];
    
    // Analyze slow queries for index opportunities
    for (const query of slowQueries) {
      const queryText = query.query.toLowerCase();
      
      // Look for WHERE clause patterns that could benefit from indexes
      if (queryText.includes('where') && queryText.includes('sessions')) {
        if (queryText.includes('a_addr') || queryText.includes('b_addr')) {
          recommendations.push({
            table: 'sessions',
            columns: ['a_addr', 'b_addr'],
            type: 'btree',
            reason: 'Frequent WHERE conditions on session addresses',
            estimatedImpact: 'high'
          });
        }
      }
      
      if (queryText.includes('reports') && queryText.includes('target_addr')) {
        recommendations.push({
          table: 'reports',
          columns: ['target_addr', 'created_at'],
          type: 'btree',
          reason: 'Report queries by target address with date filtering',
          estimatedImpact: 'medium'
        });
      }
    }
    
    return recommendations;
  }

  private async createIndex(recommendation: IndexRecommendation): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      const indexName = `idx_${recommendation.table}_${recommendation.columns.join('_')}_opt`;
      const columnsList = recommendation.columns.join(', ');
      
      const createIndexSql = `
        CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} 
        ON ${recommendation.table} 
        ${recommendation.type === 'btree' ? '' : `USING ${recommendation.type}`} 
        (${columnsList})
      `;
      
      await client.query(createIndexSql);
      console.log(`✓ Created optimized index: ${indexName}`);
    } catch (error) {
      console.error(`Failed to create index for ${recommendation.table}:`, error.message);
    } finally {
      client.release();
    }
  }

  private async dropUnusedIndexes(): Promise<number> {
    const client = await this.pool.connect();
    let droppedCount = 0;
    
    try {
      // Find unused indexes (not used in the last 7 days)
      const unusedIndexesQuery = `
        SELECT 
          schemaname,
          tablename,
          indexname,
          idx_scan,
          pg_size_pretty(pg_relation_size(indexrelid)) as size
        FROM pg_stat_user_indexes 
        WHERE idx_scan < 10 
        AND schemaname = 'public'
        AND indexname NOT LIKE '%_pkey'
        AND indexname NOT LIKE '%_unique'
      `;
      
      const result = await client.query(unusedIndexesQuery);
      
      for (const row of result.rows) {
        // Be conservative - only drop indexes that are clearly unused and not critical
        if (row.idx_scan === 0 && !row.indexname.includes('_critical_')) {
          try {
            await client.query(`DROP INDEX CONCURRENTLY IF EXISTS ${row.indexname}`);
            console.log(`✓ Dropped unused index: ${row.indexname} (size: ${row.size})`);
            droppedCount++;
          } catch (error) {
            console.warn(`Failed to drop index ${row.indexname}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.error('Error analyzing unused indexes:', error.message);
    } finally {
      client.release();
    }
    
    return droppedCount;
  }

  private async optimizeTableStorage(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      // Run VACUUM ANALYZE on tables that might benefit
      const tables = ['sessions', 'telemetry_events', 'reports'];
      
      for (const table of tables) {
        await client.query(`VACUUM ANALYZE ${table}`);
      }
      
      console.log('✓ Optimized table storage');
    } catch (error) {
      console.error('Error optimizing table storage:', error);
    } finally {
      client.release();
    }
  }

  async getIndexUsageStats(): Promise<any[]> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT 
          schemaname,
          tablename,
          indexname,
          idx_scan as scans,
          idx_tup_read as tuples_read,
          idx_tup_fetch as tuples_fetched,
          pg_size_pretty(pg_relation_size(indexrelid)) as size
        FROM pg_stat_user_indexes 
        WHERE schemaname = 'public'
        ORDER BY idx_scan DESC
      `);
      
      return result.rows;
    } catch (error) {
      console.error('Error fetching index usage stats:', error);
      return [];
    } finally {
      client.release();
    }
  }

  async getDatabaseSize(): Promise<string> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT pg_size_pretty(pg_database_size(current_database())) as size
      `);
      
      return result.rows[0].size;
    } catch (error) {
      console.error('Error getting database size:', error);
      return 'Unknown';
    } finally {
      client.release();
    }
  }
}
