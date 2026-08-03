// Local copy of invoice types for portal (avoids rootDir issues with shared/)

/**
 * Invoice lifecycle:
 *   processing → OCR is in flight
 *   pending    → OCR done, needs human review
 *   processed  → Reviewed/approved by a human, ready to submit to DMS
 *   submitted  → Successfully posted to Corcentric DMS
 *   rejected   → Sent back to supplier (won't be submitted)
 */
export type InvoiceStatus = 'processing' | 'pending' | 'processed' | 'submitted' | 'rejected';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type OCRProvider = 'mistral' | 'pixtral' | 'claude' | 'manual';
export type InvoiceSource = 'email' | 'upload';

// ════════════════════════════════════════════════════════════════════
// Canonical maps for InvoiceStatus presentation.
//
// Single source of truth for the user-visible label, the Pill variant
// to use, and the row-action verb. Multiple files used to define their
// own copies of these maps and they drifted — `processed` rendered as
// "Ready to submit" in InvoicesPage and "Submitted" in
// PromoStandardsPage, which is a real user-visible bug. Keeping these
// here means future status additions are one-line changes.
//
// Pill variants are kept as string literals (rather than importing the
// Pill component's type) to avoid pulling a UI dependency into the
// types module. Consumers cast at the use site.
// ════════════════════════════════════════════════════════════════════

export const STATUS_LABELS: Record<InvoiceStatus, string> = {
  processing: 'OCR running',
  pending:    'Needs review',
  processed:  'Ready to submit',
  submitted:  'Submitted',
  rejected:   'Rejected',
};

export type StatusPillVariant =
  | 'ocr'
  | 'review'
  | 'submitted'
  | 'rejected'
  | 'neutral';

export const STATUS_VARIANTS: Record<InvoiceStatus, StatusPillVariant> = {
  processing: 'ocr',
  pending:    'review',
  processed:  'review',
  submitted:  'submitted',
  rejected:   'rejected',
};

/** Verb shown on the row action button per status. "Submit" prompts the
 *  reviewer to send to DMS once a row reaches `processed`. */
export const STATUS_ACTIONS: Record<InvoiceStatus, string> = {
  processing: '—',
  pending:    'Review',
  processed:  'Submit',
  submitted:  'View',
  rejected:   'Fix',
};

/** Helper for cases where the data layer hands us an unexpected value
 *  (e.g. a status we haven't migrated yet). Falls back to the raw
 *  string so it's visible in the UI rather than rendering blank. */
export function statusLabel(s: string): string {
  return (STATUS_LABELS as Record<string, string>)[s] ?? s;
}

export interface Supplier {
  id: string;
  name: string;
  code: string;
  email_prefix: string;
  contact_email: string | null;
  contact_name: string | null;
  created_at: string;
  updated_at: string;
  active: boolean;
  /** When true, the live "Submit to Corcentric" path is disabled. The portal
   *  also forces dry_run=true on any /corcentric-submit request as a
   *  belt-and-suspenders safeguard so a stale UI cannot post a real
   *  invoice to Corcentric DMS for a test-mode supplier. */
  test_mode?: boolean;
  community_id?: string | null;
}

export interface Invoice {
  id: string;
  supplier_id: string | null;
  file_name: string;
  r2_object_key: string;
  status: InvoiceStatus;
  confidence: ConfidenceLevel | null;
  ocr_provider: OCRProvider;
  ocr_raw_response: unknown;
  invoice_data: Record<string, unknown>;
  source: InvoiceSource;
  source_email: string | null;
  needs_supplier_review: boolean;
  feedback: string | null;
  feedback_date: string | null;
  feedback_by: string | null;
  original_invoice_id: string | null;
  // Customer-from-invoice resolution flags (added by waves 30-40).
  // Set by the post-OCR matcher when the OCR'd Bill To doesn't
  // confidently match an existing customer.
  customer_id?: string | null;
  needs_customer_review?: boolean;
  customer_match_confidence?: number | null;
  attention_to?: string | null;
  // Ship-to resolution (mirror of customer-from-invoice flags). When the
  // OCR'd ShipTo on an invoice doesn't match an existing customer_ship_tos
  // row for the matched customer, needs_ship_to_review is set so the
  // review screen surfaces a banner. ship_to_id holds the linked row once
  // resolved; null + needs_ship_to_review=false means "use one-time only".
  ship_to_id?: string | null;
  needs_ship_to_review?: boolean;
  created_at: string;
  updated_at: string;
  supplier?: Supplier;
}
