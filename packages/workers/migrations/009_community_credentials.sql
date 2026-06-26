-- Migration 009: Move API credentials from suppliers to communities
--
-- Corcentric API credentials (username, password, URL) logically belong
-- at the community level — you map at the community level, so that's
-- where the API user/pass applies. During supplier setup you assign a
-- community, and on submit it pulls the community's API credentials.
--
-- Phase 1: Add columns to communities (this migration)
-- Phase 2: Backfill from suppliers → communities (manual, see below)
-- Phase 3: Drop supplier columns (future migration, after confirming)

-- ── Add credential columns to communities ──
ALTER TABLE communities ADD COLUMN IF NOT EXISTS cor_api_url TEXT;
ALTER TABLE communities ADD COLUMN IF NOT EXISTS cor_username TEXT;
ALTER TABLE communities ADD COLUMN IF NOT EXISTS cor_password TEXT;

-- ── Backfill: copy credentials from the first supplier in each community ──
-- This picks one supplier per community that has credentials set.
-- After running, verify the values are correct before dropping supplier columns.
UPDATE communities c
SET
  cor_api_url  = s.cor_api_url,
  cor_username = s.cor_username,
  cor_password = s.cor_password
FROM (
  SELECT DISTINCT ON (community_id)
    community_id, cor_api_url, cor_username, cor_password
  FROM suppliers
  WHERE community_id IS NOT NULL
    AND cor_username IS NOT NULL
    AND cor_username != ''
  ORDER BY community_id, created_at ASC
) s
WHERE c.id = s.community_id
  AND c.cor_username IS NULL;

-- NOTE: Do NOT drop supplier-level credential columns yet.
-- The application code will use a priority chain:
--   community credentials → supplier credentials (legacy fallback) → env vars
-- Once confirmed working, run a future migration to drop:
--   ALTER TABLE suppliers DROP COLUMN cor_api_url;
--   ALTER TABLE suppliers DROP COLUMN cor_username;
--   ALTER TABLE suppliers DROP COLUMN cor_password;
