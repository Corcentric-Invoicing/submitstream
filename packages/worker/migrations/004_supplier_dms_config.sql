-- ============================================
-- Migration 004: Add per-supplier DMS API credentials
-- Moves username/password/URL from global Worker secrets to per-supplier config.
-- Existing columns: cor_vendor_code, cor_customer_code, cor_community_code,
--   cor_transaction_type, cor_currency_code, cor_field_mapping, cor_ingestion_enabled
-- ============================================

-- Per-supplier DMS API credentials
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_api_url TEXT DEFAULT 'https://corconnect.corcentric.com/corconnect/api/processRequest';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_username TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_password TEXT;

-- Connection health tracking
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_last_submission_at TIMESTAMPTZ;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_last_status TEXT;  -- 'success', 'denied', 'warning', 'invalid', 'error'
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_last_error TEXT;

COMMENT ON COLUMN suppliers.cor_api_url IS 'Corcentric DMS API endpoint (per-supplier, defaults to production)';
COMMENT ON COLUMN suppliers.cor_username IS 'Corcentric DMS API username for this supplier';
COMMENT ON COLUMN suppliers.cor_password IS 'Corcentric DMS API password for this supplier';
COMMENT ON COLUMN suppliers.cor_last_submission_at IS 'Timestamp of last DMS submission attempt';
COMMENT ON COLUMN suppliers.cor_last_status IS 'Status of last DMS submission';
