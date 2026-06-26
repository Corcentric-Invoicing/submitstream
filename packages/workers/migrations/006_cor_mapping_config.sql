-- ============================================
-- Migration 006: Unified Corcentric mapping config
--
-- Adds cor_mapping_config JSONB column that consolidates
-- all per-supplier OCR→Corcentric mapping behavior into
-- one config object. Replaces the need for separate
-- cor_transaction_type, cor_currency_code, and cor_field_mapping
-- columns (those are kept for backward compatibility but
-- cor_mapping_config takes precedence when present).
--
-- The mapper reads this config to drive the entire pipeline:
-- field names, transaction type, line detail defaults, freight
-- handling, reference mappings, validation rules, etc.
-- ============================================

-- Add the unified mapping config column
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS cor_mapping_config JSONB;

COMMENT ON COLUMN suppliers.cor_mapping_config IS 'Unified per-supplier mapping config (JSONB). Controls how OCR invoice data maps to Corcentric DMS XML. Takes precedence over cor_transaction_type, cor_currency_code, cor_field_mapping when present. NULL = use global defaults.';

-- Migrate existing data: if a supplier has cor_transaction_type or cor_currency_code set,
-- seed cor_mapping_config with those values so nothing changes for existing suppliers.
UPDATE suppliers
SET cor_mapping_config = jsonb_build_object(
  'transactionType', COALESCE(cor_transaction_type, 'P'),
  'currencyCode', COALESCE(cor_currency_code, 'USD')
)
WHERE cor_mapping_config IS NULL
  AND (cor_transaction_type IS NOT NULL OR cor_currency_code IS NOT NULL);
