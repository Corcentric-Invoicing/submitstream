-- ============================================
-- Migration 006: Customer Ship-To Locations
--
-- Adds hierarchical ship-to addresses under Bill-To customers.
-- Bill-To (customers table) = master billing entity with cor_customer_code
-- Ship-To (customer_ship_tos) = delivery locations under each bill-to
--
-- Ship-To codes are auto-generated if not provided on the invoice.
-- ============================================

-- ── 1. Customer Ship-To locations table ──
CREATE TABLE IF NOT EXISTS customer_ship_tos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  code TEXT NOT NULL,                            -- ship-to code (from invoice or auto-generated)
  name TEXT,                                     -- location name (e.g. "Parts Authority - American Fork")
  address1 TEXT,
  address2 TEXT,
  city TEXT,
  state TEXT,
  zip TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Each customer can only have one ship-to with a given code
  UNIQUE (customer_id, code)
);

-- Index for lookup by customer
CREATE INDEX IF NOT EXISTS idx_ship_tos_customer ON customer_ship_tos (customer_id) WHERE active = true;

-- ── 2. Auto-number sequence for ship-to codes ──
-- When an invoice has no ship-to code, we auto-generate one like "ST-0001"
CREATE SEQUENCE IF NOT EXISTS ship_to_code_seq START 1;

-- ── 3. Add ship_to_id to invoices (optional FK) ──
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS ship_to_id UUID REFERENCES customer_ship_tos(id);
CREATE INDEX IF NOT EXISTS idx_invoices_ship_to ON invoices (ship_to_id) WHERE ship_to_id IS NOT NULL;

-- ── 4. RLS Policies ──
ALTER TABLE customer_ship_tos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Everyone reads customer_ship_tos" ON customer_ship_tos
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY "Admin manages customer_ship_tos" ON customer_ship_tos
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

-- ── 5. Seed initial customer data from known invoices ──

-- Parts Authority (BBB Industries supplier, Corcentric code from their system)
INSERT INTO customers (name, code, cor_customer_code, bill_to_name, bill_to_city, bill_to_state)
VALUES ('Parts Authority', 'PARTSAUTH', 'P1742', 'PARTS AUTHORITY', 'NEW HYDE PARK', 'NY')
ON CONFLICT (code) DO NOTHING;

-- Case Paper Company (Falcon Paper supplier)
INSERT INTO customers (name, code, cor_customer_code, bill_to_name, bill_to_city, bill_to_state)
VALUES ('Case Paper Company', 'CASEPAPER', NULL, 'Case Paper Company, Inc.', 'Harrison', 'NY')
ON CONFLICT (code) DO NOTHING;

-- Bill Nault (Magnet Group supplier)
INSERT INTO customers (name, code, cor_customer_code, bill_to_name, bill_to_city, bill_to_state)
VALUES ('Bill Nault', 'BILLNAULT', NULL, 'Bill Nault', 'Washington', 'MO')
ON CONFLICT (code) DO NOTHING;

-- ── 6. Seed ship-to locations ──

-- Parts Authority - American Fork location
INSERT INTO customer_ship_tos (customer_id, code, name, city, state)
SELECT c.id, 'P1742-43831', 'Parts Authority American Fork', 'AMERICAN FORK', 'UT'
FROM customers c WHERE c.code = 'PARTSAUTH'
ON CONFLICT (customer_id, code) DO NOTHING;

-- Case Paper - Harrison NY
INSERT INTO customer_ship_tos (customer_id, code, name, city, state)
SELECT c.id, 'SHIP-002', 'Case Paper Company - Harrison', 'Harrison', 'NY'
FROM customers c WHERE c.code = 'CASEPAPER'
ON CONFLICT (customer_id, code) DO NOTHING;

-- Bill Nault - Cumberland RI
INSERT INTO customer_ship_tos (customer_id, code, name, city, state)
SELECT c.id, 'SHIP-001', 'Bill Nault - Cumberland', 'Cumberland', 'RI'
FROM customers c WHERE c.code = 'BILLNAULT'
ON CONFLICT (customer_id, code) DO NOTHING;

-- ── 7. Seed customer_supplier_codes (map supplier bill-to codes → customers) ──

-- Falcon Paper → Case Paper (BILL-002)
INSERT INTO customer_supplier_codes (customer_id, supplier_id, supplier_code, description)
SELECT c.id, s.id, 'BILL-002', 'Case Paper Company - Falcon Paper invoices'
FROM customers c, suppliers s
WHERE c.code = 'CASEPAPER' AND s.code = 'FALCON'
ON CONFLICT (supplier_id, supplier_code) DO NOTHING;

-- Magnet Group → Bill Nault (BILL-001)
INSERT INTO customer_supplier_codes (customer_id, supplier_id, supplier_code, description)
SELECT c.id, s.id, 'BILL-001', 'Bill Nault - Magnet Group invoices'
FROM customers c, suppliers s
WHERE c.code = 'BILLNAULT' AND s.code = 'MAGNET'
ON CONFLICT (supplier_id, supplier_code) DO NOTHING;

-- BBB Industries → Parts Authority (P1742)
INSERT INTO customer_supplier_codes (customer_id, supplier_id, supplier_code, description)
SELECT c.id, s.id, 'P1742', 'Parts Authority - BBB Industries invoices'
FROM customers c, suppliers s
WHERE c.code = 'PARTSAUTH' AND s.code = 'BBB'
ON CONFLICT (supplier_id, supplier_code) DO NOTHING;
