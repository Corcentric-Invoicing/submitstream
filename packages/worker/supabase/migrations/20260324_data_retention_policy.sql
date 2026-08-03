-- ============================================
-- Data Retention Policy — GDPR Compliance
-- Automated cleanup of old data based on
-- configurable retention periods.
-- ============================================

-- ── Retention settings (added to system_settings) ──
-- These define how long different data types are kept before
-- automatic cleanup. Values are in days. Set to 0 to disable.

INSERT INTO system_settings (key, value, updated_at)
VALUES
  ('retention_invoices_days', '730'::jsonb, now()),      -- 2 years for processed invoices
  ('retention_audit_log_days', '1095'::jsonb, now()),    -- 3 years for audit logs (SOC 2 minimum)
  ('retention_ocr_raw_days', '90'::jsonb, now()),        -- 90 days for raw OCR response metadata
  ('retention_pdf_storage_days', '730'::jsonb, now()),   -- 2 years for stored PDFs in R2
  ('retention_feedback_days', '730'::jsonb, now())       -- 2 years for feedback history
ON CONFLICT (key) DO NOTHING;  -- Don't overwrite if already set

-- ── Cleanup function: invoices ──
-- Soft-deletes old invoices by setting status to 'archived'.
-- Hard delete of invoice_data (PII) after retention period.
-- PDF files in R2 must be cleaned separately (Worker cron job).
CREATE OR REPLACE FUNCTION cleanup_expired_invoices(retention_days int)
RETURNS int AS $$
DECLARE
  affected int;
BEGIN
  -- Null out extracted invoice data (may contain PII: names, addresses, etc.)
  UPDATE invoices
  SET
    invoice_data = '{"_redacted": true, "_redacted_at": "' || now()::text || '"}'::jsonb,
    ocr_raw_response = NULL,
    status = 'archived'
  WHERE
    status NOT IN ('archived', 'processing')
    AND created_at < now() - (retention_days || ' days')::interval
    AND invoice_data IS NOT NULL
    AND (invoice_data->>'_redacted') IS NULL;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Cleanup function: feedback history ──
CREATE OR REPLACE FUNCTION cleanup_expired_feedback(retention_days int)
RETURNS int AS $$
DECLARE
  affected int;
BEGIN
  DELETE FROM feedback_history
  WHERE created_at < now() - (retention_days || ' days')::interval;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Cleanup function: audit logs ──
-- Audit logs are kept longer (SOC 2 requires minimum 1 year, we default to 3).
-- This only cleans logs older than the retention period.
CREATE OR REPLACE FUNCTION cleanup_expired_audit_logs(retention_days int)
RETURNS int AS $$
DECLARE
  affected int;
BEGIN
  DELETE FROM access_audit_log
  WHERE created_at < now() - (retention_days || ' days')::interval;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Master cleanup function ──
-- Reads retention periods from system_settings and runs all cleanup functions.
-- Designed to be called from a Cloudflare Worker cron trigger or Supabase Edge Function.
CREATE OR REPLACE FUNCTION run_data_retention_cleanup()
RETURNS jsonb AS $$
DECLARE
  inv_days int;
  audit_days int;
  feedback_days int;
  inv_cleaned int;
  audit_cleaned int;
  feedback_cleaned int;
BEGIN
  -- Read retention settings
  SELECT (value)::int INTO inv_days
    FROM system_settings WHERE key = 'retention_invoices_days';
  SELECT (value)::int INTO audit_days
    FROM system_settings WHERE key = 'retention_audit_log_days';
  SELECT (value)::int INTO feedback_days
    FROM system_settings WHERE key = 'retention_feedback_days';

  -- Default to safe values if settings missing
  inv_days := COALESCE(inv_days, 730);
  audit_days := COALESCE(audit_days, 1095);
  feedback_days := COALESCE(feedback_days, 730);

  -- Run cleanup for each data type (skip if retention is 0 = disabled)
  IF inv_days > 0 THEN
    inv_cleaned := cleanup_expired_invoices(inv_days);
  ELSE
    inv_cleaned := 0;
  END IF;

  IF audit_days > 0 THEN
    audit_cleaned := cleanup_expired_audit_logs(audit_days);
  ELSE
    audit_cleaned := 0;
  END IF;

  IF feedback_days > 0 THEN
    feedback_cleaned := cleanup_expired_feedback(feedback_days);
  ELSE
    feedback_cleaned := 0;
  END IF;

  -- Return summary
  RETURN jsonb_build_object(
    'run_at', now(),
    'invoices_archived', inv_cleaned,
    'audit_logs_deleted', audit_cleaned,
    'feedback_deleted', feedback_cleaned,
    'retention_config', jsonb_build_object(
      'invoices_days', inv_days,
      'audit_logs_days', audit_days,
      'feedback_days', feedback_days
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Usage ──
-- To run manually:   SELECT run_data_retention_cleanup();
-- To run on a cron:  Set up a Supabase Edge Function or Worker cron trigger
--                    that calls: SELECT run_data_retention_cleanup();
--
-- To adjust retention periods:
--   UPDATE system_settings SET value = 365 WHERE key = 'retention_invoices_days';
--
-- To disable cleanup for a data type:
--   UPDATE system_settings SET value = 0 WHERE key = 'retention_audit_log_days';

COMMENT ON FUNCTION run_data_retention_cleanup() IS
  'Master data retention cleanup — reads retention periods from system_settings, '
  'archives expired invoices (redacts PII), deletes old audit logs and feedback. '
  'Call from a scheduled Worker cron or Supabase Edge Function.';
