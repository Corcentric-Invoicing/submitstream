// ============================================
// EDI Schema for Invoice OCR Extraction
// Internal extraction field names + Corcentric CSV mapping
// ============================================

// ─── Extraction Schema (sent to Mistral/Claude) ────────────
// Field names are internal; csv-export.ts maps them to Corcentric column names.
export const EDI_EXTRACTION_SCHEMA = {
  type: "object",
  properties: {
    // Invoice Header (6 fields)
    InvoiceDate: { type: "string", description: "Invoice date in YYYYMMDD format (e.g., 20240215)" },
    InvoiceNumber: { type: "string", description: "Invoice number or ID" },
    PODate: { type: "string", description: "Purchase order date in YYYYMMDD format" },
    PONumber: { type: "string", description: "Purchase order number" },
    Currency: { type: "string", description: "Currency code (e.g., USD, EUR)" },
    ShipDate: { type: "string", description: "Ship date in YYYYMMDD format" },

    // Extended header (not in base Corcentric 79-col spec — mapped to A-slots)
    SalesOrderNumber: { type: "string", description: "Seller's sales order number (S.O. No.)" },
    DeliveryTerms: { type: "string", description: "Delivery/shipping terms or Incoterms (e.g., DDP, FOB, CIF)" },

    // Ship To (7 fields)
    ShipToName: { type: "string", description: "Ship to company/person name" },
    ShipToCode: { type: "string", description: "Ship to location code" },
    ShipToAddress1: { type: "string", description: "Ship to address line 1" },
    ShipToAddress2: { type: "string", description: "Ship to address line 2" },
    ShipToCity: { type: "string", description: "Ship to city" },
    ShipToState: { type: "string", description: "Ship to state/province code" },
    ShipToZip: { type: "string", description: "Ship to postal/zip code" },

    // Vendor (7 fields)
    VendorName: { type: "string", description: "Vendor/supplier company name" },
    VendorCode: { type: "string", description: "Vendor code or ID" },
    VendorAddress1: { type: "string", description: "Vendor address line 1" },
    VendorAddress2: { type: "string", description: "Vendor address line 2" },
    VendorCity: { type: "string", description: "Vendor city" },
    VendorState: { type: "string", description: "Vendor state/province code" },
    VendorZip: { type: "string", description: "Vendor postal/zip code" },

    // Remit To (7 fields — includes RemitZip)
    RemitToName: { type: "string", description: "Remit to company name (where to send payment)" },
    RemitToCode: { type: "string", description: "Remit to code" },
    RemitToAddress1: { type: "string", description: "Remit to address line 1" },
    RemitToAddress2: { type: "string", description: "Remit to address line 2" },
    RemitToCity: { type: "string", description: "Remit to city" },
    RemitToState: { type: "string", description: "Remit to state/province code" },
    RemitToZip: { type: "string", description: "Remit to postal/zip code" },

    // Bill To (7 fields — includes BillToZip)
    BillToName: { type: "string", description: "Bill to company name" },
    BillToCode: { type: "string", description: "Bill to code" },
    BillToAddress1: { type: "string", description: "Bill to address line 1" },
    BillToAddress2: { type: "string", description: "Bill to address line 2" },
    BillToCity: { type: "string", description: "Bill to city" },
    BillToState: { type: "string", description: "Bill to state/province code" },
    BillToZip: { type: "string", description: "Bill to postal/zip code" },

    // Payment Terms (7 fields)
    DueDate: { type: "string", description: "Payment due date in YYYYMMDD format" },
    NetDays: { type: "string", description: "Net payment days (e.g., 30, 60, 90)" },
    TermsDescription: { type: "string", description: "Payment terms description (e.g., Net 30)" },
    DiscountDueDate: { type: "string", description: "Discount due date in YYYYMMDD format" },
    DiscountDueDays: { type: "string", description: "Discount due days (e.g., 10)" },
    DiscountPercent: { type: "string", description: "Early payment discount percentage" },

    // Line Items (array)
    LineItems: {
      type: "array",
      description: "Invoice line items",
      items: {
        type: "object",
        properties: {
          LineNumber: { type: "string", description: "Line item number" },
          Quantity: { type: "string", description: "Invoiced/billing quantity (the quantity used for pricing)" },
          UOM: { type: "string", description: "Unit of measure for invoiced quantity (e.g., EA, BX, CS, ST, LB, KG)" },
          UnitPrice: { type: "string", description: "Price per unit" },
          BuyerPartNumber: { type: "string", description: "Buyer's part/item number" },
          VendorPartNumber: { type: "string", description: "Vendor's part/item number or product grade code" },
          Description: { type: "string", description: "Line item description" },
          // Extended line item fields (mapped to A-slots in CSV)
          LineItemAmount: { type: "string", description: "Extended line total (Quantity x UnitPrice)" },
          ContainerNumber: { type: "string", description: "Shipping container or trailer number (e.g., TGBU9719330)" },
          PackagingQuantity: { type: "string", description: "Number of packages/pallets/rolls in this line" },
          PackagingUOM: { type: "string", description: "Packaging unit of measure (e.g., PALLETS, ROLLS, CARTONS, BOXES)" },
          NetWeight: { type: "string", description: "Net weight for this line item (numeric, no units)" },
          GrossWeight: { type: "string", description: "Gross weight for this line item (numeric, no units)" },
          WeightUOM: { type: "string", description: "Weight unit of measure (e.g., ST, LB, KG, MT)" },
        }
      }
    },

    // Totals (1 base + extended)
    Subtotal: { type: "string", description: "Pre-tax subtotal of line items (commonly labeled 'Subtotal', 'Sub-total', 'Net amount', or 'Net total' on the invoice). Plain number, no currency symbol. Leave empty only if the invoice truly has no subtotal line." },
    InvoiceTotal: { type: "string", description: "Total invoice amount" },
    PaymentsCredits: { type: "string", description: "Payments or credits already applied to this invoice" },
    BalanceDue: { type: "string", description: "Balance due after payments/credits" },
    TotalNetWeight: { type: "string", description: "Total net weight for all line items (numeric, no units)" },
    TotalGrossWeight: { type: "string", description: "Total gross weight for all line items (numeric, no units)" },

    // Tax & Charges
    DiscountableAmount: { type: "string", description: "Amount eligible for an early-payment discount, ONLY when the invoice explicitly labels a 'discountable' line. NOT the same as Subtotal. If the invoice just shows 'Subtotal' (no 'discountable' qualifier), leave this empty and write the value to Subtotal instead." },
    LocalTaxCode: { type: "string", description: "Local tax jurisdiction code" },
    LocalTaxAmount: { type: "string", description: "Local tax amount" },
    StateTaxCode: { type: "string", description: "State tax jurisdiction code" },
    StateTaxAmount: { type: "string", description: "State tax amount" },
    FederalTaxCode: { type: "string", description: "Federal tax code" },
    FederalTaxAmount: { type: "string", description: "Federal tax amount" },
    FreightCode: { type: "string", description: "Freight charge code" },
    FreightAmount: { type: "string", description: "Freight/shipping charges" },
    MiscItemCode: { type: "string", description: "Miscellaneous item-level charge code" },
    MiscItemAmount: { type: "string", description: "Miscellaneous item-level charge amount" },
    MiscItemDescription: { type: "string", description: "Miscellaneous item-level charge description" },
    MiscSumCode: { type: "string", description: "Miscellaneous summary-level charge code" },
    MiscSumAmount: { type: "string", description: "Miscellaneous summary-level charge amount" },
    MiscSumDescription: { type: "string", description: "Miscellaneous summary-level charge description" },

    // References & Tracking
    BillOfLading: { type: "string", description: "Bill of lading number" },
    PackingSlip: { type: "string", description: "Packing slip number" },
    ReferenceZZ: { type: "string", description: "Mutually defined reference number" },
    TrackingNumber: { type: "string", description: "Shipping tracking number (e.g., UPS 1Z..., FedEx, USPS). Look for 'Tracking Number', 'Tracking #', or 'Tracking No' on the invoice." },
  }
};

// ─── Corcentric CSV Column Order (79 columns) ──────────────
// These are the EXACT column headers Corcentric's import system expects.
export const CSV_COLUMN_ORDER = [
  // Header (5)
  'InvoiceDate', 'InvoiceNumber', 'PODate', 'PONumber', 'Currency',
  // Ship To (7)
  'ShipToName', 'ShipToCode', 'ShipToAddress1', 'ShipToAddress2', 'ShipToCity', 'ShipToState', 'ShipToZip',
  // Vendor (7)
  'VendorName', 'VendorCode', 'VendorAddress1', 'VendorAddress2', 'VendorCity', 'VendorState', 'VendorZip',
  // Remit To (7)
  'RemitName', 'RemitCode', 'RemitAddress1', 'RemitAddress2', 'RemitCity', 'RemitState', 'RemitZip',
  // Bill To (7)
  'BillToName', 'BillToCode', 'BillToAddress1', 'BillToAddress2', 'BillToCity', 'BillToState', 'BillToZip',
  // Payment Terms (7)
  'TermsDueDate', 'TermsNetDays', 'TermsDescription', 'TermsDiscountDueDate', 'TermsDiscountDueDays', 'TermsDiscountPercent',
  'ShipDate',
  // Line Items (7)
  'LineNumber', 'Quantity', 'UnitOfMeasure', 'UnitPrice', 'BuyerPartNumber', 'VendorPartNumber', 'ItemDescription',
  // Totals & Tax (19)
  'InvoiceTotal', 'Discountable_Amount_If_Applicable',
  'LocalTaxCode', 'LocalTax', 'StateTaxCode', 'StateTax', 'FederalTaxCode', 'FederalTax',
  'FreightCode', 'FreightCharge',
  'MiscItemCode', 'MiscItemAmount', 'MiscItemDesc',
  'MiscSumCode', 'MiscSummaryAmount', 'MiscSummaryDesc',
  // References (6)
  'RefQualBM', 'RefBillLading', 'RefQualPK', 'RefPackingSlip', 'RefQualZZ', 'RefMutalDef',
  // Placeholders / Extended fields (10)
  'A1Q', 'A1D', 'A2Q', 'A2D', 'A3Q', 'A3D', 'A4Q', 'A4D', 'A5Q', 'A5D',
];

// ─── Mapping: CSV column name → internal extraction field path ──
// For line-item fields, prefix with "line." to indicate they come from the line item object.
// Special values: "static:VALUE" for hardcoded values, "computed:NAME" for computed fields.
export const CSV_FIELD_MAP: Record<string, string> = {
  // Header
  InvoiceDate: 'InvoiceDate',
  InvoiceNumber: 'InvoiceNumber',
  PODate: 'PODate',
  PONumber: 'PONumber',
  Currency: 'Currency',
  // Ship To
  ShipToName: 'ShipToName',
  ShipToCode: 'ShipToCode',
  ShipToAddress1: 'ShipToAddress1',
  ShipToAddress2: 'ShipToAddress2',
  ShipToCity: 'ShipToCity',
  ShipToState: 'ShipToState',
  ShipToZip: 'ShipToZip',
  // Vendor
  VendorName: 'VendorName',
  VendorCode: 'VendorCode',
  VendorAddress1: 'VendorAddress1',
  VendorAddress2: 'VendorAddress2',
  VendorCity: 'VendorCity',
  VendorState: 'VendorState',
  VendorZip: 'VendorZip',
  // Remit To (Corcentric names → internal names)
  RemitName: 'RemitToName',
  RemitCode: 'RemitToCode',
  RemitAddress1: 'RemitToAddress1',
  RemitAddress2: 'RemitToAddress2',
  RemitCity: 'RemitToCity',
  RemitState: 'RemitToState',
  RemitZip: 'RemitToZip',
  // Bill To
  BillToName: 'BillToName',
  BillToCode: 'BillToCode',
  BillToAddress1: 'BillToAddress1',
  BillToAddress2: 'BillToAddress2',
  BillToCity: 'BillToCity',
  BillToState: 'BillToState',
  BillToZip: 'BillToZip',
  // Payment Terms
  TermsDueDate: 'DueDate',
  TermsNetDays: 'NetDays',
  TermsDescription: 'TermsDescription',
  TermsDiscountDueDate: 'DiscountDueDate',
  TermsDiscountDueDays: 'DiscountDueDays',
  TermsDiscountPercent: 'DiscountPercent',
  ShipDate: 'ShipDate',
  // Line Items
  LineNumber: 'line.LineNumber',
  Quantity: 'line.Quantity',
  UnitOfMeasure: 'line.UOM',
  UnitPrice: 'line.UnitPrice',
  BuyerPartNumber: 'line.BuyerPartNumber',
  VendorPartNumber: 'line.VendorPartNumber',
  ItemDescription: 'line.Description',
  // Totals
  InvoiceTotal: 'InvoiceTotal',
  'Discountable_Amount_If_Applicable': 'DiscountableAmount',
  // Tax
  LocalTaxCode: 'LocalTaxCode',
  LocalTax: 'LocalTaxAmount',
  StateTaxCode: 'StateTaxCode',
  StateTax: 'StateTaxAmount',
  FederalTaxCode: 'FederalTaxCode',
  FederalTax: 'FederalTaxAmount',
  // Freight
  FreightCode: 'FreightCode',
  FreightCharge: 'FreightAmount',
  // Misc Item-level
  MiscItemCode: 'MiscItemCode',
  MiscItemAmount: 'MiscItemAmount',
  MiscItemDesc: 'MiscItemDescription',
  // Misc Summary-level
  MiscSumCode: 'MiscSumCode',
  MiscSummaryAmount: 'MiscSumAmount',
  MiscSummaryDesc: 'MiscSumDescription',
  // References — qualifiers are static, values are from extraction
  RefQualBM: 'static:BM',
  RefBillLading: 'BillOfLading',
  RefQualPK: 'static:PK',
  RefPackingSlip: 'PackingSlip',
  RefQualZZ: 'static:ZZ',
  RefMutalDef: 'ReferenceZZ',
  // Extended fields mapped to A-slots (per line item row)
  A1Q: 'computed:A1Q',
  A1D: 'computed:A1D',
  A2Q: 'computed:A2Q',
  A2D: 'computed:A2D',
  A3Q: 'computed:A3Q',
  A3D: 'computed:A3D',
  A4Q: 'computed:A4Q',
  A4D: 'computed:A4D',
  A5Q: 'computed:A5Q',
  A5D: 'computed:A5D',
};

// ─── Mandatory fields (38 fields from Corcentric spec) ──────
// These use INTERNAL extraction field names (not CSV column names).
// "line." prefix means the field is checked per line item.
export const MANDATORY_FIELDS: { csvName: string; internalKey: string; label: string }[] = [
  // Header
  { csvName: 'InvoiceDate', internalKey: 'InvoiceDate', label: 'Invoice Date' },
  { csvName: 'InvoiceNumber', internalKey: 'InvoiceNumber', label: 'Invoice Number' },
  { csvName: 'Currency', internalKey: 'Currency', label: 'Currency' },
  // Ship To
  { csvName: 'ShipToName', internalKey: 'ShipToName', label: 'Ship To Name' },
  { csvName: 'ShipToCode', internalKey: 'ShipToCode', label: 'Ship To Code' },
  { csvName: 'ShipToAddress1', internalKey: 'ShipToAddress1', label: 'Ship To Address' },
  { csvName: 'ShipToCity', internalKey: 'ShipToCity', label: 'Ship To City' },
  { csvName: 'ShipToState', internalKey: 'ShipToState', label: 'Ship To State' },
  { csvName: 'ShipToZip', internalKey: 'ShipToZip', label: 'Ship To Zip' },
  // Vendor
  { csvName: 'VendorName', internalKey: 'VendorName', label: 'Vendor Name' },
  { csvName: 'VendorCode', internalKey: 'VendorCode', label: 'Vendor Code' },
  { csvName: 'VendorAddress1', internalKey: 'VendorAddress1', label: 'Vendor Address' },
  { csvName: 'VendorCity', internalKey: 'VendorCity', label: 'Vendor City' },
  { csvName: 'VendorState', internalKey: 'VendorState', label: 'Vendor State' },
  { csvName: 'VendorZip', internalKey: 'VendorZip', label: 'Vendor Zip' },
  // Remit To
  { csvName: 'RemitName', internalKey: 'RemitToName', label: 'Remit To Name' },
  { csvName: 'RemitCode', internalKey: 'RemitToCode', label: 'Remit To Code' },
  { csvName: 'RemitAddress1', internalKey: 'RemitToAddress1', label: 'Remit To Address' },
  { csvName: 'RemitCity', internalKey: 'RemitToCity', label: 'Remit To City' },
  { csvName: 'RemitState', internalKey: 'RemitToState', label: 'Remit To State' },
  { csvName: 'RemitZip', internalKey: 'RemitToZip', label: 'Remit To Zip' },
  // Bill To
  { csvName: 'BillToName', internalKey: 'BillToName', label: 'Bill To Name' },
  { csvName: 'BillToCode', internalKey: 'BillToCode', label: 'Bill To Code' },
  { csvName: 'BillToAddress1', internalKey: 'BillToAddress1', label: 'Bill To Address' },
  { csvName: 'BillToCity', internalKey: 'BillToCity', label: 'Bill To City' },
  { csvName: 'BillToState', internalKey: 'BillToState', label: 'Bill To State' },
  { csvName: 'BillToZip', internalKey: 'BillToZip', label: 'Bill To Zip' },
  // Payment Terms
  { csvName: 'TermsDueDate', internalKey: 'DueDate', label: 'Due Date' },
  { csvName: 'TermsDescription', internalKey: 'TermsDescription', label: 'Terms Description' },
  // Ship Date
  { csvName: 'ShipDate', internalKey: 'ShipDate', label: 'Ship Date' },
  // Line Items (validated per line)
  { csvName: 'LineNumber', internalKey: 'line.LineNumber', label: 'Line Number' },
  { csvName: 'Quantity', internalKey: 'line.Quantity', label: 'Quantity' },
  { csvName: 'UnitOfMeasure', internalKey: 'line.UOM', label: 'Unit of Measure' },
  { csvName: 'UnitPrice', internalKey: 'line.UnitPrice', label: 'Unit Price' },
  { csvName: 'BuyerPartNumber', internalKey: 'line.BuyerPartNumber', label: 'Buyer Part Number' },
  { csvName: 'VendorPartNumber', internalKey: 'line.VendorPartNumber', label: 'Vendor Part Number' },
  { csvName: 'ItemDescription', internalKey: 'line.Description', label: 'Item Description' },
  // Total
  { csvName: 'InvoiceTotal', internalKey: 'InvoiceTotal', label: 'Invoice Total' },
];
