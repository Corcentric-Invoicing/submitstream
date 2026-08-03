-- ============================================
-- Customer-from-invoice: schema prerequisites
--
-- Enables the "the invoice is the seed for the customer list" flow.
-- When a new invoice arrives, we try to match its BillTo against an
-- existing customer (by supplier_code first, then fuzzy name).  If we
-- find nothing confident, the invoice gets flagged for review and the
-- reviewer creates the customer from the pre-filled invoice data.
--
-- Applied via MCP on 2026-04-18.
-- ============================================

-- Fuzzy string matching for the name-match pass.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Per-invoice flags driving the review-UI banner.
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS needs_customer_review     boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_match_confidence numeric(4,3);

COMMENT ON COLUMN invoices.needs_customer_review IS
  'True when OCR ran but the BillTo did not resolve to an existing customer with sufficient confidence. Drives the "Create customer from this invoice" banner in the review UI.';
COMMENT ON COLUMN invoices.customer_match_confidence IS
  '0.000-1.000 similarity score for the customer match (1.0 = exact code match; 0.85+ = auto-linked name match; <0.85 = needs_customer_review).';

-- Room for the "c/o" line on ship-to addresses — real invoices carry
-- patterns like "Oliver Inc / c/o Disc Graphics Inc / 30 Gilpin Avenue"
-- where the attention line belongs between the name and the street.
ALTER TABLE customer_ship_tos
  ADD COLUMN IF NOT EXISTS attention_to text;

COMMENT ON COLUMN customer_ship_tos.attention_to IS
  'Optional "c/o" or "Attn:" line inserted between the ship-to name and address lines.  For invoices where the ship-to contains two name lines (e.g. primary entity + operating subsidiary).';

-- Fast trigram index for customer-name similarity search.
-- Used by the matcher's fuzzy pass; without this the per-query scan
-- would be O(N) across the whole customers table.
CREATE INDEX IF NOT EXISTS idx_customers_name_trgm
  ON customers USING gin (lower(name) gin_trgm_ops);

-- Also helps when the queue view filters for "unresolved customers".
CREATE INDEX IF NOT EXISTS idx_invoices_needs_customer_review
  ON invoices (needs_customer_review, created_at DESC)
  WHERE needs_customer_review = true;
