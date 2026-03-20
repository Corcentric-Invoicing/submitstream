// Local copy of invoice types for portal (avoids rootDir issues with shared/)

export type InvoiceStatus = 'processing' | 'processed' | 'pending' | 'rejected';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type OCRProvider = 'mistral' | 'claude' | 'manual';
export type InvoiceSource = 'email' | 'upload';

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
  created_at: string;
  updated_at: string;
  supplier?: Supplier;
}
