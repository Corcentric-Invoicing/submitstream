-- ============================================
-- Generalize invoices.source → ingestion_source
--
-- The existing `source` column only distinguishes "email" vs "upload"
-- (both PDF paths). As we add structured-data connectors like
-- PromoStandards (and eventually QuickBooks, NetSuite, etc.), we
-- need a vocabulary that covers how the invoice data got to us, not
-- just which human action triggered it.
--
-- Strategy:
--   - Add `ingestion_source` as a new TEXT column with a wider
--     CHECK constraint (adds 'promostandards' today; room to grow).
--   - Backfill from the existing `source` column (email/upload 1:1)
--     and override to 'promostandards' where promostandards_pull_id
--     is set.
--   - Keep `source` in place for back-compat; new code writes both
--     until a follow-up migration drops the legacy column.
--
-- Also: add `validation_findings` JSONB to hold the array of
-- ValidationFinding objects produced by the validator so the portal
-- can surface flags without re-running rules on every render.
-- ============================================

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ingestion_source TEXT;

-- Widen the allowed values. Using a CHECK constraint (rather than a
-- Postgres enum) so future connectors only need a DDL touch here.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_ingestion_source_check'
  ) THEN
    ALTER TABLE invoices
      ADD CONSTRAINT invoices_ingestion_source_check
      CHECK (ingestion_source IS NULL OR ingestion_source IN (
        'email',
        'upload',
        'promostandards'
      ));
  END IF;
END $$;

-- Backfill from existing data.
UPDATE invoices
   SET ingestion_source = 'promostandards'
 WHERE promostandards_pull_id IS NOT NULL
   AND (ingestion_source IS NULL OR ingestion_source <> 'promostandards');

UPDATE invoices
   SET ingestion_source = source
 WHERE ingestion_source IS NULL
   AND source IN ('email', 'upload');

-- Any remaining unclassified rows default to 'upload' so the column
-- becomes safely queryable without a NULL check.
UPDATE invoices SET ingestion_source = 'upload' WHERE ingestion_source IS NULL;

-- Cheap lookups for per-source filtered views (the PromoStandards
-- admin queue hits this index on every render).
CREATE INDEX IF NOT EXISTS idx_invoices_ingestion_source
  ON invoices (ingestion_source, created_at DESC);

COMMENT ON COLUMN invoices.ingestion_source IS
  'How this invoice entered the system: email, upload, promostandards (extensible). Supersedes the legacy `source` column, which is retained during the transition.';


-- ============================================
-- validation_findings: JSONB array of ValidationFinding objects
--   [{ severity: 'error' | 'warning' | 'info',
--      code:     string,
--      message:  string,
--      field?:   string }]
-- Populated by the puller at pull time for PromoStandards invoices;
-- OCR invoices may populate this later as OCR-specific rules are
-- added.
-- ============================================

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS validation_findings JSONB;

COMMENT ON COLUMN invoices.validation_findings IS
  'Cached validator output. Array of {severity, code, message, field?} objects. Recomputed on every write; portal reads directly.';

-- Lookup helpers for the admin queue "show me everything with errors" view.
CREATE INDEX IF NOT EXISTS idx_invoices_has_validation_findings
  ON invoices ((validation_findings IS NOT NULL))
  WHERE validation_findings IS NOT NULL;
