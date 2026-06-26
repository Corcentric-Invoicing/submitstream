-- Migration 010: Supplier-owned customers
-- Each customer record belongs to exactly one supplier (1:1).
-- Suppliers manage their own bill-to/ship-to data via the portal.
-- cor_customer_code is editable by suppliers once they get it from Corcentric.

-- ── Add supplier_id FK to customers ──
ALTER TABLE customers ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
CREATE INDEX IF NOT EXISTS idx_customers_supplier_id ON customers (supplier_id) WHERE supplier_id IS NOT NULL;

-- ── Add optional contact fields ──
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_email TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_phone TEXT;

-- ── Backfill supplier_id from existing customer_supplier_codes mappings ──
UPDATE customers c
SET supplier_id = csc.supplier_id
FROM (
  SELECT DISTINCT ON (customer_id)
    customer_id, supplier_id
  FROM customer_supplier_codes
  WHERE active = true
  ORDER BY customer_id, created_at ASC
) csc
WHERE c.id = csc.customer_id
  AND c.supplier_id IS NULL;

-- ── Update RLS: suppliers can manage their own customers ──
DROP POLICY IF EXISTS "Admin manages customers" ON customers;

CREATE POLICY "admin_manages_customers" ON customers
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "supplier_reads_own_customers" ON customers
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'supplier' AND supplier_id = customers.supplier_id)
  );

CREATE POLICY "supplier_inserts_own_customers" ON customers
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'supplier' AND supplier_id = customers.supplier_id)
  );

CREATE POLICY "supplier_updates_own_customers" ON customers
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'supplier' AND supplier_id = customers.supplier_id)
  );

-- ── Update RLS for ship-tos ──
DROP POLICY IF EXISTS "Admin manages customer_ship_tos" ON customer_ship_tos;

CREATE POLICY "admin_manages_ship_tos" ON customer_ship_tos
  FOR ALL USING (
    EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "supplier_manages_own_ship_tos" ON customer_ship_tos
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles up
      JOIN customers c ON c.supplier_id = up.supplier_id
      WHERE up.id = auth.uid() AND up.role = 'supplier' AND c.id = customer_ship_tos.customer_id
    )
  );
