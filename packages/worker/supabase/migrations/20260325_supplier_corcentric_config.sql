-- ============================================
-- Add Corcentric DMS integration fields to suppliers
-- Stores per-supplier codes needed for XML submission.
-- ============================================

-- Corcentric-assigned codes for the DMS web service
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_vendor_code VARCHAR(30);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_customer_code VARCHAR(30);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_community_code VARCHAR(3);

-- Defaults for transaction generation
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_transaction_type CHAR(1) DEFAULT 'P';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_currency_code CHAR(3) DEFAULT 'USD';

-- Per-supplier field mapping (OCR field names → Corcentric XML field names)
-- NULL = use default mapping defined in code
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_field_mapping JSONB;

-- Whether Corcentric ingestion is enabled for this supplier
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_ingestion_enabled BOOLEAN DEFAULT false;

-- Index for quick lookup of Corcentric-enabled suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_cor_enabled
  ON suppliers (cor_ingestion_enabled) WHERE cor_ingestion_enabled = true;

COMMENT ON COLUMN suppliers.cor_vendor_code IS 'Corcentric-assigned vendor/dealer code for this supplier';
COMMENT ON COLUMN suppliers.cor_customer_code IS 'Corcentric-assigned customer/fleet code for the buyer';
COMMENT ON COLUMN suppliers.cor_community_code IS 'Corcentric-assigned community code (e.g. fleet program)';
COMMENT ON COLUMN suppliers.cor_field_mapping IS 'JSON mapping of OCR field names to Corcentric XML tag names. NULL = use defaults.';
COMMENT ON COLUMN suppliers.cor_ingestion_enabled IS 'When true, processed invoices are eligible for Corcentric XML submission';
