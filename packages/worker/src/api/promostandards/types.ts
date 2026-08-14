// ============================================
// PromoStandards Invoice 1.0.0 — Type Definitions
//
// Source: "Promotional Products Data Interface Specification for
// Web services — Invoice 1.0.0" (released 2020-01-27).
// https://services.promostandards.org/webserviceValidator/home
//
// Only the fields actually defined by the spec live here. Every
// "Required" column in the spec is reflected as a non-optional
// TypeScript field; optional fields use `?`.
// ============================================

/** Supported `queryType` values for getInvoices / getVoidedInvoices. */
export enum InvoiceQueryType {
  PurchaseOrderNumber = 1,
  InvoiceNumber = 2,
  Date = 3,
  AvailableTimestamp = 4,
}

/** GetInvoiceRequest — the request object for getInvoices(). */
export interface GetInvoiceRequest {
  wsVersion: string;                  // required; currently '1.0.0'
  id: string;                         // required; customerId
  password?: string;                  // optional per spec; in practice required
  queryType: InvoiceQueryType;        // required
  referenceNumber?: string;           // PO# (qt=1) or invoice# (qt=2)
  requestedDate?: string;             // YYYY-MM-DD (qt=3)
  availableTimeStamp?: string;        // ISO-8601 UTC datetime (qt=4)
}

/** Same shape as GetInvoiceRequest — used for getVoidedInvoices(). */
export type GetVoidedInvoiceRequest = GetInvoiceRequest;

// ── Response payload objects ────────────────────────────────────

export interface AccountInfo {
  accountName?: string;
  accountNumber?: string;
  attentionTo?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  city?: string;
  region?: string;       // 2-char US state or 2–3 char non-US region
  postalCode?: string;
  country?: string;      // ISO 3166-2 (2 char)
  email?: string;
  phone?: string;
}

export type QuantityUOM =
  | 'BX' | 'CA' | 'DZ' | 'EA' | 'KT' | 'PR'
  | 'PK' | 'RL' | 'ST' | 'SL' | 'TH';

export type TaxType = 'SALES' | 'HST/GST' | 'PST' | 'VAT';

export interface Tax {
  taxType: TaxType;           // required
  taxJurisdiction: string;    // required
  taxAmount: number;          // required
}

export interface InvoiceLineItem {
  invoiceLineItemNumber?: number;
  productId?: string;
  partId?: string;
  chargeId?: string;                       // required when line is a charge (freight/setup/etc.)
  purchaseOrderLineItemNumber?: string;
  orderedQuantity?: number;
  invoiceQuantity: number;                 // required
  backOrderedQuantity?: number;
  quantityUOM: QuantityUOM;                // required
  lineItemDescription: string;             // required
  unitPrice: number;                       // required
  discountAmount?: number;
  extendedPrice: number;                   // required
  distributorProductId?: string;
  distributorPartId?: string;
}

export interface SalesOrderNumber {
  salesOrderNumber: string;                // required
}

export type InvoiceType = 'INVOICE' | 'CREDIT MEMO';

export interface Invoice {
  invoiceNumber: string;                   // required
  invoiceType: InvoiceType;                // required
  invoiceDate: string;                     // YYYY-MM-DD (required)
  purchaseOrderNumber?: string;
  purchaseOrderVersion?: string;
  BillTo?: AccountInfo;
  SoldTo?: AccountInfo;
  invoiceComments?: string;
  paymentTerms?: string;
  paymentDueDate: string;                  // YYYY-MM-DD (required)
  currency: string;                        // ISO4217 (required)
  fobId?: string;
  salesAmount: number;                     // required
  shippingAmount: number;                  // required
  handlingAmount: number;                  // required
  taxAmount: number;                       // required (total of TaxArray)
  invoiceAmount: number;                   // required
  advancePaymentAmount: number;            // required (0 if unsupported)
  invoiceAmountDue: number;                // required
  invoiceDocumentUrl?: string;
  InvoiceLineItemsArray: InvoiceLineItem[];// required
  SalesOrderNumbersArray?: SalesOrderNumber[];
  TaxArray?: Tax[];
  invoicePaymentUrl?: string;
}

export interface VoidedInvoice {
  invoiceNumber: string;   // required
  voidDate: string;        // YYYY-MM-DD (required)
}

export type ServiceMessageSeverity = 'Error' | 'Information' | 'Warning';

export interface ServiceMessage {
  code: number;                            // required
  description: string;                     // required
  severity: ServiceMessageSeverity;        // required
}

export interface GetInvoiceResponse {
  InvoiceArray?: Invoice[];
  ServiceMessageArray?: ServiceMessage[];
}

export interface GetVoidedInvoiceResponse {
  VoidedInvoiceArray?: VoidedInvoice[];
  ServiceMessageArray?: ServiceMessage[];
}

// ── Supabase row shape for `suppliers.ps_*` columns ─────────────

export interface SupplierPromostandardsConfig {
  ps_endpoint_url: string | null;
  ps_ws_version: string | null;        // defaults to '1.0.0'
  /** RSK-01: bytea, decrypted via decrypt_credential RPC before use. */
  ps_auth_id_enc: unknown;
  ps_auth_password_enc: unknown;
  ps_ingestion_enabled: boolean;
  ps_poll_interval_hours: number | null;
  ps_last_pulled_at: string | null;    // ISO string from Postgres
}

/** Merged view: config plus derived readiness flag. */
export function isPromostandardsReady(
  cfg: Partial<SupplierPromostandardsConfig>,
): boolean {
  return (
    cfg.ps_ingestion_enabled === true &&
    !!cfg.ps_endpoint_url &&
    !!cfg.ps_auth_id_enc
  );
}
