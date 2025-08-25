-- Migration: Add Optimization Columns
-- Created: 2025-08-25T12:01:00.000Z

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

-- Add constraints for data integrity
ALTER TABLE users ADD CONSTRAINT check_risk_score_range CHECK (risk_score >= 0 AND risk_score <= 100);
ALTER TABLE sessions ADD CONSTRAINT check_chain_id_positive CHECK (chain_id > 0);
ALTER TABLE reports ADD CONSTRAINT check_status_valid CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed'));
