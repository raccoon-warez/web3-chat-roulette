import { Pool, PoolClient } from 'pg';
import { initializeRedis } from './redis';

// Create PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://user:password@localhost:5432/web3chat',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

// Initialize database connection
const initializeDatabase = async () => {
  try {
    // Test database connection
    const client = await pool.connect();
    console.log('Connected to PostgreSQL database');
    client.release();
    
    // Initialize Redis as well
    await initializeRedis();
  } catch (error) {
    console.error('Error connecting to database:', error);
  }
};

// Create tables if they don't exist
const createTables = async () => {
  const client = await pool.connect();
  
  try {
    // Create users table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        wallet_address VARCHAR(42) PRIMARY KEY,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ens_name VARCHAR(255),
        risk_score INTEGER DEFAULT 0
      )
    `);
    
    // Create sessions table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY,
        a_addr VARCHAR(42),
        b_addr VARCHAR(42),
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ended_at TIMESTAMP,
        reason_end VARCHAR(50),
        chain_id INTEGER,
        tip_count INTEGER DEFAULT 0,
        reported BOOLEAN DEFAULT FALSE
      )
    `);
    
    // Create reports table
    await client.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id SERIAL PRIMARY KEY,
        reporter_addr VARCHAR(42),
        target_addr VARCHAR(42),
        session_id VARCHAR(255),
        reason_enum VARCHAR(50),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create blocks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS blocks (
        blocker_addr VARCHAR(42),
        blocked_addr VARCHAR(42),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (blocker_addr, blocked_addr)
      )
    `);
    
    // Create nonces table
    await client.query(`
      CREATE TABLE IF NOT EXISTS nonces (
        address VARCHAR(42),
        nonce VARCHAR(255),
        expires_at TIMESTAMP,
        consumed BOOLEAN DEFAULT FALSE,
        PRIMARY KEY (address, nonce)
      )
    `);
    
    // Create telemetry_events table
    await client.query(`
      CREATE TABLE IF NOT EXISTS telemetry_events (
        id SERIAL PRIMARY KEY,
        address VARCHAR(42),
        type VARCHAR(100),
        payload JSONB,
        ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('Database tables created successfully');
  } catch (error) {
    console.error('Error creating tables:', error);
  } finally {
    client.release();
  }
};

// Export database utilities
export { pool, initializeDatabase, createTables };
