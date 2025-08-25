import { Pool, PoolClient } from 'pg';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

interface Migration {
  id: string;
  name: string;
  filename: string;
  sql: string;
  checksum: string;
  createdAt: Date;
  executedAt?: Date;
}

interface MigrationResult {
  success: boolean;
  migrationsRun: number;
  errors: string[];
  executionTime: number;
}

export class MigrationManager {
  private migrationsPath: string;

  constructor(private pool: Pool, migrationsPath?: string) {
    this.migrationsPath = migrationsPath || path.join(__dirname, '..', '..', 'migrations');
  }

  async initialize(): Promise<void> {
    console.log('Initializing migration manager');
    await this.createMigrationTable();
  }

  async runMigrations(): Promise<MigrationResult> {
    const startTime = Date.now();
    const result: MigrationResult = {
      success: true,
      migrationsRun: 0,
      errors: [],
      executionTime: 0
    };

    try {
      // Create migrations directory if it doesn't exist
      try {
        await fs.mkdir(this.migrationsPath, { recursive: true });
      } catch (error) {
        // Directory might already exist
      }

      // Get pending migrations
      const pendingMigrations = await this.getPendingMigrations();
      
      if (pendingMigrations.length === 0) {
        console.log('No pending migrations found');
        result.executionTime = Date.now() - startTime;
        return result;
      }

      console.log(`Found ${pendingMigrations.length} pending migrations`);

      // Execute migrations in transaction
      const client = await this.pool.connect();
      
      try {
        await client.query('BEGIN');
        
        for (const migration of pendingMigrations) {
          try {
            console.log(`Running migration: ${migration.name}`);
            
            // Execute migration SQL
            await client.query(migration.sql);
            
            // Record migration as completed
            await client.query(
              'INSERT INTO schema_migrations (id, name, filename, checksum, executed_at) VALUES ($1, $2, $3, $4, NOW())',
              [migration.id, migration.name, migration.filename, migration.checksum]
            );
            
            result.migrationsRun++;
            console.log(`✓ Migration completed: ${migration.name}`);
            
          } catch (error) {
            const errorMsg = `Migration failed: ${migration.name} - ${error.message}`;
            console.error(errorMsg);
            result.errors.push(errorMsg);
            result.success = false;
            throw error; // This will trigger rollback
          }
        }
        
        await client.query('COMMIT');
        console.log(`Successfully executed ${result.migrationsRun} migrations`);
        
      } catch (error) {
        await client.query('ROLLBACK');
        console.error('Migration transaction rolled back:', error.message);
      } finally {
        client.release();
      }
      
    } catch (error) {
      result.success = false;
      result.errors.push(error.message);
    }

    result.executionTime = Date.now() - startTime;
    return result;
  }

  async createMigration(name: string, sql: string): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:\-T]/g, '').substring(0, 14);
    const filename = `${timestamp}_${name.replace(/[^a-zA-Z0-9]/g, '_')}.sql`;
    const filepath = path.join(this.migrationsPath, filename);
    
    const migrationContent = `-- Migration: ${name}
-- Created: ${new Date().toISOString()}

${sql}
`;

    await fs.writeFile(filepath, migrationContent, 'utf8');
    console.log(`Created migration file: ${filename}`);
    
    return filename;
  }

  async getMigrationStatus(): Promise<{ applied: Migration[]; pending: Migration[] }> {
    const appliedMigrations = await this.getAppliedMigrations();
    const pendingMigrations = await this.getPendingMigrations();
    
    return {
      applied: appliedMigrations,
      pending: pendingMigrations
    };
  }

  private async createMigrationTable(): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id VARCHAR(255) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          filename VARCHAR(255) NOT NULL,
          checksum VARCHAR(64) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          executed_at TIMESTAMP WITH TIME ZONE
        )
      `);
      
      // Create index for performance
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_schema_migrations_executed_at 
        ON schema_migrations (executed_at)
      `);
      
    } finally {
      client.release();
    }
  }

  private async getPendingMigrations(): Promise<Migration[]> {
    try {
      // Read migration files
      const files = await fs.readdir(this.migrationsPath);
      const migrationFiles = files
        .filter(file => file.endsWith('.sql'))
        .sort(); // Ensure chronological order

      // Get applied migrations
      const appliedMigrations = await this.getAppliedMigrations();
      const appliedIds = new Set(appliedMigrations.map(m => m.id));

      const pendingMigrations: Migration[] = [];

      for (const file of migrationFiles) {
        const filepath = path.join(this.migrationsPath, file);
        const content = await fs.readFile(filepath, 'utf8');
        const checksum = crypto.createHash('sha256').update(content).digest('hex');
        const id = this.generateMigrationId(file);

        if (!appliedIds.has(id)) {
          pendingMigrations.push({
            id,
            name: this.extractMigrationName(file),
            filename: file,
            sql: content,
            checksum,
            createdAt: new Date()
          });
        }
      }

      return pendingMigrations;
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('Migrations directory does not exist, creating it...');
        await fs.mkdir(this.migrationsPath, { recursive: true });
        return [];
      }
      throw error;
    }
  }

  private async getAppliedMigrations(): Promise<Migration[]> {
    const client = await this.pool.connect();
    
    try {
      const result = await client.query(`
        SELECT id, name, filename, checksum, created_at, executed_at
        FROM schema_migrations
        ORDER BY executed_at ASC
      `);
      
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        filename: row.filename,
        checksum: row.checksum,
        createdAt: row.created_at,
        executedAt: row.executed_at
      }));
    } finally {
      client.release();
    }
  }

  private generateMigrationId(filename: string): string {
    // Extract timestamp from filename or generate hash
    const timestampMatch = filename.match(/^(\d{14})/);
    if (timestampMatch) {
      return timestampMatch[1];
    }
    
    // Fallback to hash of filename
    return crypto.createHash('md5').update(filename).digest('hex');
  }

  private extractMigrationName(filename: string): string {
    return filename
      .replace(/^\d{14}_/, '') // Remove timestamp prefix
      .replace(/\.sql$/, '') // Remove .sql extension
      .replace(/_/g, ' ') // Replace underscores with spaces
      .replace(/\b\w/g, l => l.toUpperCase()); // Capitalize first letter of each word
  }
}

// Create initial migration files
export async function createInitialMigrations(migrationsPath: string): Promise<void> {
  const migrationManager = new MigrationManager(new Pool(), migrationsPath);
  
  // Migration 1: Performance Indexes
  await migrationManager.createMigration('create_performance_indexes', `
-- Critical performance indexes for Web3 Chat Roulette

-- Sessions table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_a_addr ON sessions (a_addr);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_b_addr ON sessions (b_addr);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_started_at ON sessions (started_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_chain_id ON sessions (chain_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_active ON sessions (started_at) WHERE ended_at IS NULL;

-- Reports table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_target_addr ON reports (target_addr);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_reporter_addr ON reports (reporter_addr);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_created_at ON reports (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_status ON reports (status);

-- Blocks table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_blocker_active ON blocks (blocker_addr) WHERE active = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_blocked_active ON blocks (blocked_addr) WHERE active = true;

-- Nonces table indexes (critical for auth performance)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nonces_expires_at ON nonces (expires_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nonces_consumed ON nonces (consumed, expires_at) WHERE consumed = false;

-- Telemetry events indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_address ON telemetry_events (address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_type ON telemetry_events (type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_ts ON telemetry_events (ts);
  `);

  // Migration 2: Add missing columns
  await migrationManager.createMigration('add_optimization_columns', `
-- Add optimization columns to existing tables

-- Add performance tracking columns to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS session_count INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;

-- Add computed columns to sessions table
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS duration_seconds INTEGER GENERATED ALWAYS AS (
  CASE WHEN ended_at IS NOT NULL 
  THEN EXTRACT(EPOCH FROM (ended_at - started_at))::INTEGER 
  ELSE NULL END
) STORED;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS created_date DATE GENERATED ALWAYS AS (started_at::DATE) STORED;

-- Add status tracking to reports table
ALTER TABLE reports ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending';
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE reports ADD COLUMN IF NOT EXISTS resolved_by VARCHAR(42);

-- Add expiration to blocks table
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS reason VARCHAR(100);
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE blocks ADD COLUMN IF NOT EXISTS active BOOLEAN DEFAULT TRUE;

-- Add consumed tracking to nonces table
ALTER TABLE nonces ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMP WITH TIME ZONE;
  `);

  // Migration 3: Create partitioning for telemetry_events
  await migrationManager.createMigration('setup_telemetry_partitioning', `
-- Setup partitioning for telemetry_events table

-- First, if the table exists without partitioning, we need to recreate it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'telemetry_events' AND table_schema = 'public') THEN
    -- Check if it's already partitioned
    IF NOT EXISTS (SELECT 1 FROM pg_partitioned_table WHERE partrelid = 'telemetry_events'::regclass) THEN
      -- Rename existing table
      ALTER TABLE telemetry_events RENAME TO telemetry_events_old;
      
      -- Create new partitioned table
      CREATE TABLE telemetry_events (
        id SERIAL,
        address VARCHAR(42),
        type VARCHAR(100) NOT NULL,
        payload JSONB,
        ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        created_date DATE GENERATED ALWAYS AS (ts::DATE) STORED
      ) PARTITION BY RANGE (created_date);
      
      -- Copy data from old table (if not too large)
      INSERT INTO telemetry_events (address, type, payload, ts)
      SELECT address, type, payload, ts FROM telemetry_events_old
      WHERE ts >= CURRENT_DATE - INTERVAL '30 days'; -- Only copy recent data
      
      -- Drop old table (uncomment when ready)
      -- DROP TABLE telemetry_events_old;
    END IF;
  ELSE
    -- Create new partitioned table
    CREATE TABLE telemetry_events (
      id SERIAL,
      address VARCHAR(42),
      type VARCHAR(100) NOT NULL,
      payload JSONB,
      ts TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
      created_date DATE GENERATED ALWAYS AS (ts::DATE) STORED
    ) PARTITION BY RANGE (created_date);
  END IF;
END $$;

-- Create partitions for current and next 3 months
DO $$
DECLARE
  partition_date DATE;
  next_partition_date DATE;
  partition_name TEXT;
BEGIN
  FOR i IN 0..3 LOOP
    partition_date := DATE_TRUNC('month', CURRENT_DATE) + (i || ' months')::INTERVAL;
    next_partition_date := partition_date + INTERVAL '1 month';
    partition_name := 'telemetry_events_' || TO_CHAR(partition_date, 'YYYY_MM');
    
    EXECUTE FORMAT('CREATE TABLE IF NOT EXISTS %I PARTITION OF telemetry_events FOR VALUES FROM (%L) TO (%L)',
                   partition_name, partition_date, next_partition_date);
  END LOOP;
END $$;
  `);

  console.log('Initial migration files created');
}
