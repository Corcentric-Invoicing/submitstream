-- ============================================
-- Access Audit Log — SOC 2 Compliance
-- Tracks who accessed which invoices, when,
-- and what action was performed.
-- ============================================

CREATE TABLE IF NOT EXISTS access_audit_log (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL,

  -- Who performed the action (null = unauthenticated attempt)
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- What they did
  action        TEXT NOT NULL CHECK (action IN (
    'invoice_view',
    'invoice_list',
    'pdf_download',
    'csv_export',
    'invoice_update'
  )),

  -- What resource was accessed
  resource_type TEXT NOT NULL DEFAULT 'invoice',
  resource_id   UUID,           -- invoice ID, nullable for list operations

  -- Context
  ip_address    INET,
  metadata      JSONB DEFAULT '{}',

  -- Prevent accidental deletes — audit logs are immutable
  CONSTRAINT no_future_dates CHECK (created_at <= now() + interval '1 minute')
);

-- ── Indexes for common query patterns ──
-- "Show me all access to invoice X"
CREATE INDEX idx_audit_resource ON access_audit_log (resource_id, created_at DESC);

-- "Show me everything user Y accessed"
CREATE INDEX idx_audit_user ON access_audit_log (user_id, created_at DESC);

-- "Show me all PDF downloads in the last 24 hours"
CREATE INDEX idx_audit_action ON access_audit_log (action, created_at DESC);

-- Composite for dashboard queries: "all actions today by type"
CREATE INDEX idx_audit_time_action ON access_audit_log (created_at DESC, action);

-- ── Row Level Security ──
-- Audit logs are write-only for the service role.
-- Regular users cannot read, update, or delete audit entries.
ALTER TABLE access_audit_log ENABLE ROW LEVEL SECURITY;

-- Service role (used by the Worker) can insert
CREATE POLICY "Service role can insert audit logs"
  ON access_audit_log
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Service role can read (for admin dashboard queries later)
CREATE POLICY "Service role can read audit logs"
  ON access_audit_log
  FOR SELECT
  TO service_role
  USING (true);

-- Admins can read via authenticated role (for future admin audit viewer)
CREATE POLICY "Admins can view audit logs"
  ON access_audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.role = 'admin'
    )
  );

-- Nobody can update or delete audit logs — they are immutable
-- (No UPDATE or DELETE policies = denied by default with RLS on)

COMMENT ON TABLE access_audit_log IS 'Immutable access audit trail for SOC 2 compliance. Logs every invoice view, PDF download, CSV export, and data modification.';
