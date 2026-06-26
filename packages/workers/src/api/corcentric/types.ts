// ============================================
// Corcentric DMS Web Service — TypeScript Types
// Based on Corcentric_DMS_Specification.docx v2.2
// ============================================

// ── Request Types ──

/** Corcentric DMS request type codes */
export type CorRequestType =
  | 'C'  // Credit Check
  | 'P'  // Price Check
  | 'T'  // Transaction Authorization
  | 'A'  // Transaction Authorization (alternate)
  | 'S'  // Invoice Submission ← our primary use case
  | 'I'  // Index Submission
  | 'L'  // Lookup/Retrieve Invoice
  | 'R'  // Purchase Order Request
  | 'O'  // Close Loop Request
  | 'D'  // Delivery Receipt Submission
  | 'W'; // Workorder Submission

/** Corcentric transaction type codes */
export type CorTransactionType =
  | 'P'  // Parts
  | 'R'  // Repair
  | 'S'  // Repair (alternate)
  | 'E'  // Estimate
  | 'V'  // Void
  | 'M'  // Miscellaneous
  | 'T'  // Rental
  | 'X'  // Fixed
  | 'B'  // Variable
  | 'L'; // Fuel

/** Corcentric line detail type codes */
export type CorLineDetailType =
  | 'B'  // Sublet Part
  | 'E'  // Expense
  | 'F'  // Freight
  | 'G'  // Fuel
  | 'L'  // Labor
  | 'M'  // Miscellaneous
  | 'N'  // Environmental
  | 'P'  // Parts
  | 'R'  // Rental
  | 'S'  // Shop Supplies
  | 'T'  // Tax
  | 'U'  // Sublet Labor
  | 'V'  // Variable
  | 'X'; // Fixed

/** Corcentric reference type codes */
export type CorReferenceType =
  | 'UN'  // Unit Number
  | 'VU'  // Vendor Unit Number
  | 'DN'  // Driver Number
  | 'MI'  // Miles
  | 'KM'  // Kilometers
  | 'HR'  // Hours
  | 'VN'  // VIN/Serial Number
  | 'RF'  // Reference Number
  | 'RN'  // Original Billed Transaction Number
  | 'CN'  // Tracking Number
  | 'BM'  // Bill of Lading
  | 'PK'  // Packing Slip
  | 'ZZ'  // Mutually Defined
  | 'DR'  // Delivery Receipt Number
  | 'TX'  // Corcentric Transaction ID
  | 'DD'  // Delivery Date
  | 'DT'  // Delivery Ticket
  | 'ZC'  // Carrier
  | 'IV'; // Packing List

/** Currency codes supported by Corcentric */
export type CorCurrencyCode = 'USD' | 'CAD' | 'MXN';

/** UOM codes */
export type CorUOM = 'EA' | 'HR' | 'MI' | 'KM' | 'CY' | 'PL' | 'ST' | 'LB' | 'GA' | 'FT';

// ── Request Structures ──

export interface CorReference {
  corReferenceType: CorReferenceType;
  corReferenceValue: string;
}

export interface CorTax {
  corTaxType: string;
  corTaxAmount: string;    // Decimal(18,2) as string
  corTaxID?: string;
  corTaxDescription?: string;
}

export interface CorLineDetail {
  corLineDetailSequence: number;
  corLineDetailType: CorLineDetailType;
  corLineDetailItem: string;         // Part number, labor code, etc.
  corLineDetailBuyerItem?: string;
  corLineDetailManufacturerCode?: string;
  corLineDetailDescription?: string;
  corLineDetailVMRSCode?: string;
  corLineDetailQuantity: string;     // Decimal(18,4) as string
  corLineDetailUnitPrice: string;    // Decimal(18,4) as string
  corLineDetailCorePrice?: string;   // Decimal(18,4) as string
  corLineDetailFET?: string;
  corLineDetailUOM: CorUOM;
  corLineDetailNotes?: string[];
  corTaxes?: CorTax[];
}

export interface CorSectionComment {
  corSectionCommentSequence: number;
  corSectionCommentType: 'Not' | 'Cau' | 'Com' | 'Cor' | 'Pri' | 'Rea';
  corSectionComment: string;
}

export interface CorSection {
  corSectionNumber: number;
  corSectionInfo?: {
    corSectionInfoRepairReasonCode?: string;
    corSectionInfoRepairReason?: string;
    corSectionInfoWorkAccomplishedCode?: string;
    corSectionInfoWorkAccomplished?: string;
  };
  corComments?: CorSectionComment[];
  corLineDetails: CorLineDetail[];
}

export interface CorPointOfSale {
  corPointOfSaleName?: string;
  corPointOfSaleAddress1?: string;
  corPointOfSaleAddress2?: string;
  corPointOfSaleCity?: string;
  corPointOfSaleStateProvince?: string;
  corPointOfSalePostalCode?: string;
  corPointOfSaleCountryCode?: string;
}

export interface CorAsset {
  corAssetSerialNumber?: string;       // VIN
  corAssetCustomerUnitNumber?: string;
  corAssetVendorUnitNumber?: string;
  corAssetYear?: number;
  corAssetMake?: string;
  corAssetModel?: string;
  corAssetType?: string;
  corAssetDescription?: string;
}

export interface CorTransactionInfo {
  corTransactionInfoBeginDate?: string;  // yyyymmdd
  corTransactionInfoEndDate?: string;    // yyyymmdd
  corTransactionInfoReferenceNumber?: string;
  corTransactionInfoRepairOrder?: string;
}

/** Full Corcentric DMS ProcessRequest for Invoice Submission */
export interface CorProcessRequest {
  UserName: string;
  Password: string;
  corRequest: {
    corRequestID?: string;
    corRequestType: CorRequestType;
    corVendorCode: string;
    corCustomerCode: string;
    corCommunityCode: string;
    corAuthorizationCode?: string;
    corTransactionType: CorTransactionType;
    corTransactionNumber: string;
    corOriginatingDocumentNumber?: string;
    corTransactionDate: string;           // yyyymmdd
    corPurchaseOrderNumber?: string;
    corPurchaseOrderDate?: string;        // yyyymmdd
    corTransactionAmount: string;         // Decimal(18,4) as string
    corAuthorizationAmount: string;       // Decimal(18,4) as string
    corCurrencyCode: CorCurrencyCode;
    corBillingReference?: string;
    corPaymentTerms?: string;          // nvarchar(50) e.g. 'NET30'
    corAccelerationTerms?: string;     // nvarchar(50) e.g. '2/10 NET30'
    corFreightCode?: string;           // e.g. 'D240'
    corFreightAmount?: string;         // Decimal(18,4) as string
    corRemitName?: string;
    corRemitCode?: string;
    corRemitAddress1?: string;
    corRemitAddress2?: string;
    corRemitCity?: string;
    corRemitState?: string;
    corRemitZip?: string;
    corPointOfSale?: CorPointOfSale;
    corReferences?: CorReference[];
    corTransactionInfo?: CorTransactionInfo;
    corAsset?: CorAsset;
    corSections: CorSection[];
    corTaxes?: CorTax[];
    /** Base64-encoded PDF image of the invoice (optional for submissions, mandatory for delivery receipts) */
    corBaseImage?: string;
  };
}

// ── Response Structures ──

/** Response status codes from Corcentric */
export type CorResponseStatusCode = 0 | 1 | 2 | 3;
// 0 = Invalid Invoice, 1 = Denied, 2 = Success, 3 = Success w/ warning

export interface CorResponseMessage {
  corResponseMessageType: string;
  corResponseMessageCode: string;
  corResponseMessage: string;
}

export interface CorResponse {
  corRequestID?: string;
  corResponseID: string;
  corResponseStatusCode: CorResponseStatusCode;
  corVendorCode?: string;
  corCustomerCode?: string;
  corTransactionNumber?: string;
  corAuthorizationCode?: string;
  corTransactionAmount?: string;
  corResponseMessages?: CorResponseMessage[];
}

// ── Supplier Corcentric Config ──

/** Corcentric-specific fields stored per supplier */
export interface SupplierCorcentricConfig {
  corVendorCode: string;
  corCustomerCode: string;
  corCommunityCode: string;
  defaultTransactionType: CorTransactionType;
  defaultCurrencyCode: CorCurrencyCode;
  /** Remit-to code — defaults to corVendorCode if not set */
  corRemitCode?: string;
  /** Default freight code for this supplier (e.g. 'D240') */
  defaultFreightCode?: string;
}

// ── Unified Mapping Config (stored as JSONB in cor_mapping_config) ──

/**
 * Per-supplier mapping config that drives the entire OCR → Corcentric XML pipeline.
 * Stored as a single JSONB column in the suppliers table.
 *
 * The mapper reads this config instead of using hardcoded field names or branching
 * per supplier. Falcon gets transactionType:"P", BBB gets transactionType:"S",
 * and the mapper code stays the same for both.
 *
 * Any field not specified falls back to DEFAULT_MAPPING_CONFIG.
 */
export interface CorMappingConfig {
  // ── Corcentric defaults ──
  /** Transaction type for this supplier's invoices: P=Parts, S=Repair, M=Misc, etc. */
  transactionType: CorTransactionType;
  /** Default currency code */
  currencyCode: CorCurrencyCode;
  /** Default line detail type when OCR doesn't specify */
  defaultLineDetailType: CorLineDetailType;
  /** Default UOM when OCR doesn't specify */
  defaultUOM: CorUOM;

  // ── Freight handling ──
  /** How freight is submitted: "line_item" (type F line), "ignore" (skip), or "include_in_total" */
  freightHandling: 'line_item' | 'ignore' | 'include_in_total';
  /** Freight item code (e.g. "FREIGHT", "D240") when freightHandling = "line_item" */
  freightItemCode?: string;

  // ── OCR field → Corcentric field mappings ──
  /** Maps OCR field names to Corcentric header fields */
  fieldMappings: {
    /** OCR field for invoice number → corTransactionNumber */
    invoiceNumber: string;
    /** OCR field for invoice date → corTransactionDate */
    invoiceDate: string;
    /** OCR field for total amount → corTransactionAmount & corAuthorizationAmount */
    totalAmount: string;
    /** OCR field for PO number → corPurchaseOrderNumber (optional) */
    purchaseOrderNumber?: string;
    /** OCR field for PO date → corPurchaseOrderDate (optional) */
    purchaseOrderDate?: string;
    /** OCR field for per-invoice customer code → corCustomerCode override (optional) */
    customerCode?: string;
    /** OCR field for billing reference → corBillingReference (optional) */
    billingReference?: string;
    /** OCR field for freight amount (optional) */
    freightAmount?: string;
    /** OCR field for tax amount when no detailed tax breakdown exists */
    taxTotal?: string;
  };

  // ── Line item field mapping ──
  /** The key in invoice_data that holds the array of line items */
  lineItemsField: string;
  /** Maps OCR line item fields to Corcentric line detail fields */
  lineItemMappings: {
    partNumber: string;
    description?: string;
    quantity: string;
    unitPrice: string;
    corePrice?: string;
    type?: string;
    uom?: string;
    buyerPartNumber?: string;
    manufacturerCode?: string;
    vmrsCode?: string;
  };

  // ── Reference mapping ──
  /** Maps OCR field names to Corcentric reference type codes.
   *  e.g. { "TrackingNumber": "BM", "UnitNumber": "UN" }
   *  Only populated references are included in the XML. */
  references?: Record<string, CorReferenceType>;

  // ── Tax mapping ──
  /** OCR field name for the tax array (if supplier provides itemized taxes) */
  taxField?: string;
  /** Maps OCR tax entry fields to Corcentric tax fields */
  taxMappings?: {
    type: string;
    amount: string;
    id?: string;
    description?: string;
  };

  // ── Validation ──
  /** Fields that must be non-empty or submission is rejected.
   *  Uses OCR field names from fieldMappings. */
  requiredFields: string[];

  // ── Description enrichment ──
  /** Whether to append weight data (NetWeight/GrossWeight) to line descriptions */
  appendWeightToDescription?: boolean;
  /** Whether to append DeliveryTerms to the last line item description */
  appendDeliveryTerms?: boolean;
  /** Whether to mirror vendor part # into buyer part # when buyer part # is missing */
  mirrorVendorToBuyerPart?: boolean;
}
