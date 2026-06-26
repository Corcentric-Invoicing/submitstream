-- Migration 007: Communities table
-- Communities represent Corcentric community codes (e.g., IPW, FLAG).
-- Each supplier belongs to one community via dropdown selection.

-- ── Create communities table ──
CREATE TABLE IF NOT EXISTS communities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,                    -- Corcentric community code (e.g., 'IPW', 'FLAG')
  name TEXT NOT NULL,                           -- Display name (e.g., 'IPW Community', 'FLAG Community')
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── RLS policies ──
ALTER TABLE communities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "communities_read_all" ON communities
  FOR SELECT USING (true);

CREATE POLICY "communities_admin_write" ON communities
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ── Add community_id FK to suppliers ──
ALTER TABLE suppliers
  ADD COLUMN IF NOT EXISTS community_id UUID REFERENCES communities(id);

-- Index for FK lookups
CREATE INDEX IF NOT EXISTS idx_suppliers_community_id ON suppliers (community_id) WHERE community_id IS NOT NULL;

-- ── Seed the two known communities ──
INSERT INTO communities (code, name) VALUES
  ('IPW', 'IPW'),
  ('FLAG', 'FLAG')
ON CONFLICT (code) DO NOTHING;

-- ── Backfill: link suppliers that have cor_community_code set ──
-- This maps existing supplier.cor_community_code text to the new community_id FK
UPDATE suppliers s
SET community_id = c.id
FROM communities c
WHERE s.cor_community_code = c.code
  AND s.community_id IS NULL;
