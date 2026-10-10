-- =============================================================
-- DocFlow Database Schema -- Migration 005
-- uploads: durable metadata for files stored in Cloudflare R2
-- =============================================================
--
-- Disk deployments keep upload metadata in sidecar JSON files under
-- STORAGE_ROOT/uploads and never write to this table. Serverless (Vercel)
-- deployments with STORAGE_BACKEND=r2 record uploads here instead, because
-- the function filesystem is ephemeral: the object lives in the bucket, the
-- row lives in Postgres.
--
-- Rows are inserted as 'pending' by POST /v1/files/presign and flipped to
-- 'ready' by POST /v1/files/:fileId/complete after the direct-to-R2 upload
-- has been validated. Orphaned pending rows (presign without complete) are
-- swept by the cleanup cron once expired.

BEGIN;

CREATE TABLE IF NOT EXISTS uploads (
    file_id         UUID PRIMARY KEY,
    user_id         TEXT,
    original_name   TEXT NOT NULL,
    mime_type       TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL CHECK (size_bytes >= 0),
    r2_key          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'ready')),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

-- Ownership lookups: getUploadMetaForUser filters by file_id, then user_id.
CREATE INDEX IF NOT EXISTS idx_uploads_user_id ON uploads (user_id);
-- Cleanup cron sweeps stale rows (pending or older than expires_at).
CREATE INDEX IF NOT EXISTS idx_uploads_expires_at ON uploads (expires_at);

GRANT SELECT, INSERT, UPDATE, DELETE ON uploads TO docflow_api;
GRANT SELECT, INSERT, UPDATE, DELETE ON uploads TO docflow_worker;

COMMIT;
