-- ============================================
-- Corcentric Submission Tracking Table
-- Tracks every attempt to submit an invoice
-- to Corcentric's DMS Web Service.
-- ============================================

-- Submission status: tracks lifecycle of each attempt
-- pending    → queued but not yet sent
-- submitted  → HTTP POST sent, awaiting response
-- success    → Corcentric returned status code 2 (accepted)
-- warning    → Corcentric returned status code 3 (accepted with warnings)
-- denied     → Corcentric returned status code 1 (business rule rejection)
-- invalid    → Corcentric returned status code 0 (malformed XML / invalid data)
-- failed     → Network error, timeout, or parse failure (our side)
-- retry      → Marked for retry after a transient failure

CREATE TABLE IF NOT EXISTS corcentric_submissions (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  invoice_id      uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  supplier_id     uuid REFERENCES suppliers(id) ON DELETE SET NULL,

  -- Submission payload & response
  request_xml     text,                          -- The XML we sent
  response_xml    text,                          -- The XML Corcentric returned
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','submitted','success','warning','denied','invalid','failed','retry')),

  -- Corcentric response details
  cor_status_code smallint,                      -- 0=Invalid, 1=Denied, 2=Success, 3=Warning
  cor_response_id text,                          -- Corcentric-assigned response ID
  cor_messages    jsonb DEFAULT '[]'::jsonb,      -- Array of { type, code, message }

  -- Tracking
  attempt_number  smallint NOT NULL DEFAULT 1,
  submitted_at    timestamptz,                   -- When HTTP POST was sent
  completed_at    timestamptz,                   -- When response was received
  submitted_by    uuid,                          -- Auth user who triggered it (null = auto-submit)
  error_message   text,                          -- Internal error details (network, parse, etc.)

  -- Dry-run vs live
  is_dry_run      boolean NOT NULL DEFAULT false,

  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

-- Index: find submissions for a specific invoice
CREATE INDEX idx_cor_submissions_invoice ON corcentric_submissions(invoice_id);

-- Index: find failed/retry submissions for retry processing
CREATE INDEX idx_cor_submissions_status ON corcentric_submissions(status) WHERE status IN ('failed', 'retry', 'pending');

-- Index: recent submissions for dashboard
CREATE INDEX idx_cor_submissions_created ON corcentric_submissions(created_at DESC);

-- RLS: team members can view submissions for invoices they can see
ALTER TABLE corcentric_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view submissions"
  ON corcentric_submissions FOR SELECT
  USING (true);

CREATE POLICY "Service role can insert submissions"
  ON corcentric_submissions FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Service role can update submissions"
  ON corcentric_submissions FOR UPDATE
  USING (true);

-- Helpful comments
COMMENT ON TABLE corcentric_submissions IS 'Tracks every submission attempt to the Corcentric DMS Web Service';
COMMENT ON COLUMN corcentric_submissions.cor_status_code IS '0=Invalid, 1=Denied, 2=Success, 3=Success with warnings';
COMMENT ON COLUMN corcentric_submissions.attempt_number IS 'Increments on each retry of the same invoice';
COMMENT ON COLUMN corcentric_submissions.is_dry_run IS 'True if this was a preview/test submission, not sent to Corcentric';
