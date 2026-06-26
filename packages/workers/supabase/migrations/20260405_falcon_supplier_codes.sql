-- Migration 20260405: Set Falcon Paper supplier Corcentric codes
-- Previously these were hardcoded in corcentric-submit.ts; now they live in the database.

UPDATE suppliers
SET
  cor_vendor_code = 'IPWS-FALCON1',
  cor_community_code = 'IPW'
WHERE name ILIKE '%falcon%'
  AND (cor_vendor_code IS NULL OR cor_vendor_code = '');

-- Verify
SELECT id, name, cor_vendor_code, cor_customer_code, cor_community_code
FROM suppliers
WHERE name ILIKE '%falcon%';
