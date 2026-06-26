-- ============================================
-- Add PromoStandards Invoice 1.0.0 ingestion config to suppliers
--
-- Per-supplier settings used by the PromoStandards puller to fetch
-- structured invoice data directly from a supplier's SOAP endpoint
-- (https://services.promostandards.org/webserviceValidator/home for spec).
--
-- When enabled, the scheduled puller calls getInvoices() with
-- queryType=4 (availableTimestamp) and hydrates the invoices table
-- with the same shape that OCR produces, so the downstream
-- Corcentric serializer + review flow require no changes.
-- ============================================

-- Endpoint + auth (PromoStandards auth is plain wsVersion/id/password in the body)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ps_endpoint_url       TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ps_ws_version         VARCHAR(16) DEFAULT '1.0.0';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ps_auth_id            VARCHAR(64);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ps_auth_password      VARCHAR(255);

-- Ingestion controls
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ps_ingestion_enabled  BOOLEAN     DEFAULT false;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ps_poll_interval_hours INTEGER    DEFAULT 6;

-- Incremental-pull watermark (UTC; used as availableTimestamp in queryType=4)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ps_last_pulled_at     TIMESTAMPTZ;

-- Index for quick lookup of PromoStandards-enabled suppliers
CREATE INDEX IF NOT EXISTS idx_suppliers_ps_enabled
  ON suppliers (ps_ingestion_enabled) WHERE ps_ingestion_enabled = true;

COMMENT ON COLUMN suppliers.ps_endpoint_url IS 'HTTPS URL for the supplier''s PromoStandards Invoice 1.0.0 SOAP endpoint';
COMMENT ON COLUMN suppliers.ps_ws_version IS 'PromoStandards wsVersion, currently fixed at 1.0.0';
COMMENT ON COLUMN suppliers.ps_auth_id IS 'customerId (or agreed-upon id) that the supplier assigned to us';
COMMENT ON COLUMN suppliers.ps_auth_password IS 'Password paired with ps_auth_id. Optional per spec but in practice required.';
COMMENT ON COLUMN suppliers.ps_ingestion_enabled IS 'When true, scheduled puller fetches invoices from this supplier';
COMMENT ON COLUMN suppliers.ps_poll_interval_hours IS 'Minimum hours between polls; scheduler skips suppliers polled more recently';
COMMENT ON COLUMN suppliers.ps_last_pulled_at IS 'UTC timestamp of the last successful getInvoices poll (watermark for queryType=4)';


-- ============================================
-- Pull-attempt audit log
-- One row per getInvoices / getVoidedInvoices call.
-- Used to diagnose onboarding issues and track throughput.
-- ============================================

CREATE TABLE IF NOT EXISTS promostandards_pulls (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id     UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  operation       VARCHAR(32) NOT NULL,            -- 'getInvoices' | 'getVoidedInvoices'
  query_type      INTEGER NOT NULL,                -- 1=PO, 2=InvoiceNumber, 3=Date, 4=AvailableTimestamp
  available_since TIMESTAMPTZ,                     -- value we sent as availableTimestamp
  reference       TEXT,                            -- value we sent as referenceNumber (for queryTypes 1/2)

  http_status     INTEGER,
  duration_ms     INTEGER,
  invoices_found  INTEGER DEFAULT 0,
  invoices_stored INTEGER DEFAULT 0,               -- how many new rows were inserted (deduped by invoice_number)

  -- Service-level errors / warnings returned by the supplier
  service_messages JSONB,                          -- array of ServiceMessage objects (code/description/severity)

  error_message   TEXT,                            -- null on success
  raw_response    TEXT,                            -- full response body, trimmed to ~64KB, for debugging

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ps_pulls_supplier_created
  ON promostandards_pulls (supplier_id, created_at DESC);

COMMENT ON TABLE promostandards_pulls IS 'Audit log: one row per PromoStandards SOAP call';
COMMENT ON COLUMN promostandards_pulls.service_messages IS 'Parsed ServiceMessageArray from the response body';
COMMENT ON COLUMN promostandards_pulls.raw_response IS 'Trimmed response body for debugging; cleared on success after N days by retention job';


-- ============================================
-- invoices: mark rows that came in via PromoStandards
-- Stored alongside the existing source = email|upload so the portal
-- can display provenance and the dedup logic can check the key.
-- ============================================

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS promostandards_pull_id UUID REFERENCES promostandards_pulls(id) ON DELETE SET NULL;

COMMENT ON COLUMN invoices.promostandards_pull_id IS 'When set, this invoice was pulled from a PromoStandards endpoint rather than OCR''d';

-- Dedup guard: a given supplier should not produce two rows for the same invoice number
-- (only when it originated from PromoStandards — OCR paths can legitimately produce duplicates during correction).
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_ps_supplier_invnum
  ON invoices (supplier_id, ((invoice_data->'header'->>'InvoiceNumber')))
  WHERE promostandards_pull_id IS NOT NULL;
