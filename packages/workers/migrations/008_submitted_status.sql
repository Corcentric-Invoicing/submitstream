-- Migration 008: Add 'submitted' invoice status
-- Indicates an invoice has been successfully transmitted to Corcentric DMS.

-- Update the CHECK constraint to include 'submitted'
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check
  CHECK (status IN ('processing', 'processed', 'pending', 'rejected', 'deleted', 'submitted'));

-- Backfill: mark invoices that already have a successful corcentric submission as 'submitted'
UPDATE invoices
SET status = 'submitted'
WHERE id IN (
  SELECT DISTINCT invoice_id
  FROM corcentric_submissions
  WHERE status IN ('success', 'warning')
    AND is_dry_run = false
)
AND status NOT IN ('deleted');
