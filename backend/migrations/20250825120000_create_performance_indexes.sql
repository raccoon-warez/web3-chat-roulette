-- Migration: Create Performance Indexes
-- Created: 2025-08-25T12:00:00.000Z

-- Critical performance indexes for Web3 Chat Roulette

-- Users table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_created_at ON users (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_last_active ON users (last_active);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_risk_score ON users (risk_score) WHERE risk_score > 0;

-- Sessions table indexes - critical for performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_started_at ON sessions (started_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_ended_at ON sessions (ended_at) WHERE ended_at IS NOT NULL;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_a_addr ON sessions (a_addr);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_b_addr ON sessions (b_addr);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_chain_id ON sessions (chain_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_created_date ON sessions (created_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_reported ON sessions (reported) WHERE reported = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_active ON sessions (started_at) WHERE ended_at IS NULL;

-- Composite indexes for common query patterns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_addr_date ON sessions (a_addr, created_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_addr_date_b ON sessions (b_addr, created_date);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_chain_date ON sessions (chain_id, created_date);

-- Reports table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_reporter_addr ON reports (reporter_addr);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_target_addr ON reports (target_addr);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_session_id ON reports (session_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_created_at ON reports (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_status ON reports (status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_reason_enum ON reports (reason_enum);

-- Composite indexes for reports
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_target_status ON reports (target_addr, status);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_reports_target_created ON reports (target_addr, created_at);

-- Blocks table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_blocker_active ON blocks (blocker_addr) WHERE active = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_blocked_active ON blocks (blocked_addr) WHERE active = true;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_created_at ON blocks (created_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_blocks_expires_at ON blocks (expires_at) WHERE expires_at IS NOT NULL;

-- Nonces table indexes - critical for auth performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nonces_expires_at ON nonces (expires_at);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_nonces_consumed ON nonces (consumed, expires_at) WHERE consumed = false;

-- Telemetry events indexes (will be created per partition)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_address ON telemetry_events (address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_type ON telemetry_events (type);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_ts ON telemetry_events (ts);

-- GIN indexes for JSONB columns
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_telemetry_payload_gin ON telemetry_events USING GIN (payload);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balances_tokens_gin ON balances USING GIN (erc20_tokens);

-- Balances table indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balances_address ON balances (address);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balances_chain_id ON balances (chain_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balances_last_updated ON balances (last_updated);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_balances_total_value ON balances (total_usd_value) WHERE total_usd_value > 0;

-- Query stats indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_stats_hash ON query_stats (query_hash);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_stats_avg_duration ON query_stats (avg_duration_ms DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_stats_execution_count ON query_stats (execution_count DESC);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_query_stats_last_executed ON query_stats (last_executed);
