-- =============================================================
-- DocFlow Database Schema — Migration 004
-- jobs.updated_at column for live-state timestamps
-- =============================================================

BEGIN;

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Keep updated_at in sync on every job state change
DROP TRIGGER IF EXISTS trg_jobs_updated_at ON jobs;
CREATE TRIGGER trg_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
