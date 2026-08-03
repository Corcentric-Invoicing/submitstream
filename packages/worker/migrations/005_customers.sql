-- ============================================
-- Migration 005: Customers & Supplier Code Mapping
--
-- Creates:
--   1. customers — global customer/buyer records (admin-managed)
--   2. customer_supplier_codes — maps supplier-specific codes to global customers
--   3. Adds customer_id FK to invoices
--   4. RLS policies for both tables
-- ============================================

-- ── 1. Customers table (global, admin-managed) ──
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,                          -- "Case Paper Company, Inc."
  code TEXT NOT NULL UNIQUE,                   -- canonical internal code (e.g. "CASEPAPER")
  cor_customer_code TEXT,                      -- Corcentric DMS customer code for XML

  -- Bill-to address (global/canonical)
  bill_to_name TEXT,
  bill_to_address1 TEXT,
  bill_to_address2 TEXT,
  bill_to_city TEXT,
  bill_to_state TEXT,
  bill_to_zip TEXT,

  -- Ship-to address (optional, not all customers have one)
  ship_to_name TEXT,
  ship_to_address1 TEXT,
  ship_to_address2 TEXT,
  ship_to_city TEXT,
  ship_to_state TEXT,
  ship_to_zip TEXT,

  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Index on cor_customer_code for DMS lookups
CREATE INDEX IF NOT EXISTS idx_customers_cor_code ON customers (cor_customer_code) WHERE cor_customer_code IS NOT NULL;

-- ── 2. Customer-supplier code translation table ──
-- Maps supplier-specific bill-to codes to global customer records.
-- When OCR extracts "BILL-002" from a Falcon invoice, we look up:
--   supplier_code = 'BILL-002' AND supplier_id = <Falcon's ID>
--   → find the customer → get cor_customer_code
CREATE TABLE IF NOT EXISTS customer_supplier_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  supplier_code TEXT NOT NULL,                 -- what the supplier puts on invoices (e.g. "BILL-002")
  description TEXT,                            -- optional note ("Case Paper - Harrison NY location")
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),

  -- Each supplier can only map a given code to one customer
  UNIQUE (supplier_id, supplier_code)
);

-- Index for the lookup: given a supplier + their code, find the customer
CREATE INDEX IF NOT EXISTS idx_csc_lookup ON customer_supplier_codes (supplier_id, supplier_code) WHERE active = true;
-- Reverse lookup: given a customer, find all supplier codes
CREATE INDEX IF NOT EXISTS idx_csc_customer ON customer_supplier_codes (customer_id);

-- ── 3. Add customer_id to invoices (optional FK — may be NULL for unmatched invoices) ──
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices (customer_id) WHERE customer_id IS NOT NULL;

-- ── 4. RLS Policies ──

-- Enable RLS on both tables
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_supplier_codes ENABLE ROW LEVEL SECURITY;

-- Customers: everyone authenticated can read, only admin can write
CREATE POLICY "Everyone reads customers" ON customers
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin manages customers" ON customers
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  );

-- Customer supplier codes: everyone can read, only admin can write
CREATE POLICY "Everyone reads customer_supplier_codes" ON customer_supplier_codes
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin manages customer_supplier_codes" ON customer_supplier_codes
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
        AND user_profiles.role = 'admin'
    )
  );
