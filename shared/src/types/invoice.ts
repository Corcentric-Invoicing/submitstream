// ============================================
// Invoice & EDI Field Types
// ============================================

export interface InvoiceHeader {
  InvoiceDate: string;       // YYYYMMDD
  InvoiceNumber: string;
  PODate: string;            // YYYYMMDD
  PONumber: string;
  Currency: string;
  ShipDate: string;          // YYYYMMDD
}

export interface AddressBlock {
  Name: string;
  Code: string;
  Address1: string;
  Address2: string;
  City: string;
  State: string;
  Zip: string;
}

export interface RemitToBlock {
  Name: string;
  Code: string;
  Address1: string;
  Address2: string;
  City: string;
  State: string;
}

export interface BillToBlock {
  Name: string;
  Code: string;
  Address1: string;
  Address2: string;
  City: string;
  State: string;
}

export interface PaymentTerms {
  DueDate: string;           // YYYYMMDD
  NetDays: string;
  Description: string;
  DiscountPercent: string;
  DiscountAmount: string;
  DiscountDueDate: string;   // YYYYMMDD
}

export interface LineItem {
  LineNumber: string;
  Quantity: string;
  UOM: string;
  UnitPrice: string;
  BuyerPartNumber: string;
  VendorPartNumber: string;
  Description: string;
}

export interface InvoiceTotals {
  InvoiceTotal: string;
  DiscountableAmount: string;
  LocalTaxCode: string;
  LocalTaxAmount: string;
  StateTaxCode: string;
  StateTaxAmount: string;
  FederalTaxCode: string;
  FederalTaxAmount: string;
  TaxExemptCode: string;
  TaxExemptAmount: string;
  FreightAmount: string;
  FreightDescription: string;
  MiscChargeCode: string;
  MiscChargeAmount: string;
  MiscChargeDescription: string;
}

export interface InvoiceReferences {
  BillOfLading: string;
  PackingSlip: string;
  ReferenceNumber1: string;
  ReferenceQualifier1: string;
  ReferenceNumber2: string;
  ReferenceQualifier2: string;
}

export interface PlaceholderFields {
  A1Q: string; A1D: string;
  A2Q: string; A2D: string;
  A3Q: string; A3D: string;
  A4Q: string; A4D: string;
  A5Q: string; A5D: string;
}

// Complete 79-field EDI invoice data
export interface EDIInvoiceData {
  header: InvoiceHeader;
  shipTo: AddressBlock;
  vendor: AddressBlock;
  remitTo: RemitToBlock;
  billTo: BillToBlock;
  paymentTerms: PaymentTerms;
  lineItems: LineItem[];
  totals: InvoiceTotals;
  references: InvoiceReferences;
  placeholders: PlaceholderFields;
}

// Flat version for CSV export (one row per line item)
export type FlatEDIRow = Record<string, string>;

// ============================================
// Database Types
// ============================================

export type InvoiceStatus = 'processing' | 'processed' | 'pending' | 'rejected';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type OCRProvider = 'mistral' | 'claude' | 'manual';
export type InvoiceSource = 'email' | 'upload';
export type UserRole = 'team' | 'supplier' | 'admin';

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
  invoice_data: EDIInvoiceData;
  source: InvoiceSource;
  source_email: string | null;
  needs_supplier_review: boolean;
  feedback: string | null;
  feedback_date: string | null;
  feedback_by: string | null;
  original_invoice_id: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  supplier?: Supplier;
}

export interface UserProfile {
  id: string;
  role: UserRole;
  display_name: string;
  supplier_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FeedbackEntry {
  id: string;
  invoice_id: string;
  from_user: string | null;
  action: string;
  feedback_text: string | null;
  created_at: string;
}

export interface ProcessingLogEntry {
  id: string;
  invoice_id: string;
  event: string;
  provider: string | null;
  confidence_score: number | null;
  processing_time_ms: number | null;
  error_message: string | null;
  metadata: unknown;
  created_at: string;
}
