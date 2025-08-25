-- Migration: Setup Telemetry Partitioning
-- Created: 2025-08-25T12:02:00.000Z

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
                   
    -- Create indexes on each partition
    EXECUTE FORMAT('CREATE INDEX IF NOT EXISTS %I ON %I (address)', 
                   'idx_' || partition_name || '_address', partition_name);
    EXECUTE FORMAT('CREATE INDEX IF NOT EXISTS %I ON %I (type)', 
                   'idx_' || partition_name || '_type', partition_name);
    EXECUTE FORMAT('CREATE INDEX IF NOT EXISTS %I ON %I (ts)', 
                   'idx_' || partition_name || '_ts', partition_name);
    EXECUTE FORMAT('CREATE INDEX IF NOT EXISTS %I ON %I USING GIN (payload)', 
                   'idx_' || partition_name || '_payload_gin', partition_name);
  END LOOP;
END $$;

-- Create function for automatic partition creation
CREATE OR REPLACE FUNCTION create_monthly_partition(table_name TEXT, start_date DATE)
RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
    end_date DATE;
BEGIN
    partition_name := table_name || '_' || TO_CHAR(start_date, 'YYYY_MM');
    end_date := start_date + INTERVAL '1 month';
    
    EXECUTE FORMAT('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                   partition_name, table_name, start_date, end_date);
END;
$$ LANGUAGE plpgsql;
