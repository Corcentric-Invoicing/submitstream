// ============================================
// EDI 79-Field JSON Schema for Mistral OCR
// Used as the annotation schema for structured extraction
// ============================================

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

    // Remit To (6 fields)
    RemitToName: { type: "string", description: "Remit to company name (where to send payment)" },
    RemitToCode: { type: "string", description: "Remit to code" },
    RemitToAddress1: { type: "string", description: "Remit to address line 1" },
    RemitToAddress2: { type: "string", description: "Remit to address line 2" },
    RemitToCity: { type: "string", description: "Remit to city" },
    RemitToState: { type: "string", description: "Remit to state/province code" },

    // Bill To (6 fields)
    BillToName: { type: "string", description: "Bill to company name" },
    BillToCode: { type: "string", description: "Bill to code" },
    BillToAddress1: { type: "string", description: "Bill to address line 1" },
    BillToAddress2: { type: "string", description: "Bill to address line 2" },
    BillToCity: { type: "string", description: "Bill to city" },
    BillToState: { type: "string", description: "Bill to state/province code" },

    // Payment Terms (6 fields)
    DueDate: { type: "string", description: "Payment due date in YYYYMMDD format" },
    NetDays: { type: "string", description: "Net payment days (e.g., 30, 60, 90)" },
    TermsDescription: { type: "string", description: "Payment terms description (e.g., Net 30)" },
    DiscountPercent: { type: "string", description: "Early payment discount percentage" },
    DiscountAmount: { type: "string", description: "Early payment discount amount" },
    DiscountDueDate: { type: "string", description: "Discount due date in YYYYMMDD format" },

    // Line Items (array)
    LineItems: {
      type: "array",
      description: "Invoice line items",
      items: {
        type: "object",
        properties: {
          LineNumber: { type: "string", description: "Line item number" },
          Quantity: { type: "string", description: "Quantity ordered/shipped" },
          UOM: { type: "string", description: "Unit of measure (e.g., EA, BX, CS)" },
          UnitPrice: { type: "string", description: "Price per unit" },
          BuyerPartNumber: { type: "string", description: "Buyer's part/item number" },
          VendorPartNumber: { type: "string", description: "Vendor's part/item number" },
          Description: { type: "string", description: "Line item description" },
        }
      }
    },

    // Totals (15 fields)
    InvoiceTotal: { type: "string", description: "Total invoice amount" },
    DiscountableAmount: { type: "string", description: "Amount eligible for discount" },
    LocalTaxCode: { type: "string", description: "Local tax jurisdiction code" },
    LocalTaxAmount: { type: "string", description: "Local tax amount" },
    StateTaxCode: { type: "string", description: "State tax jurisdiction code" },
    StateTaxAmount: { type: "string", description: "State tax amount" },
    FederalTaxCode: { type: "string", description: "Federal tax code" },
    FederalTaxAmount: { type: "string", description: "Federal tax amount" },
    TaxExemptCode: { type: "string", description: "Tax exempt code if applicable" },
    TaxExemptAmount: { type: "string", description: "Tax exempt amount" },
    FreightAmount: { type: "string", description: "Freight/shipping charges" },
    FreightDescription: { type: "string", description: "Freight description" },
    MiscChargeCode: { type: "string", description: "Miscellaneous charge code" },
    MiscChargeAmount: { type: "string", description: "Miscellaneous charge amount" },
    MiscChargeDescription: { type: "string", description: "Miscellaneous charge description" },

    // References (6 fields)
    BillOfLading: { type: "string", description: "Bill of lading number" },
    PackingSlip: { type: "string", description: "Packing slip number" },
    ReferenceNumber1: { type: "string", description: "Additional reference number 1" },
    ReferenceQualifier1: { type: "string", description: "Reference qualifier 1" },
    ReferenceNumber2: { type: "string", description: "Additional reference number 2" },
    ReferenceQualifier2: { type: "string", description: "Reference qualifier 2" },

    // Placeholders (10 fields)
    A1Q: { type: "string", description: "Placeholder field A1Q" },
    A1D: { type: "string", description: "Placeholder field A1D" },
    A2Q: { type: "string", description: "Placeholder field A2Q" },
    A2D: { type: "string", description: "Placeholder field A2D" },
    A3Q: { type: "string", description: "Placeholder field A3Q" },
    A3D: { type: "string", description: "Placeholder field A3D" },
    A4Q: { type: "string", description: "Placeholder field A4Q" },
    A4D: { type: "string", description: "Placeholder field A4D" },
    A5Q: { type: "string", description: "Placeholder field A5Q" },
    A5D: { type: "string", description: "Placeholder field A5D" },
  }
};

// CSV column order (79 columns)
export const CSV_COLUMN_ORDER = [
  // Header (6)
  'InvoiceDate', 'InvoiceNumber', 'PODate', 'PONumber', 'Currency', 'ShipDate',
  // Ship To (7)
  'ShipToName', 'ShipToCode', 'ShipToAddress1', 'ShipToAddress2', 'ShipToCity', 'ShipToState', 'ShipToZip',
  // Vendor (7)
  'VendorName', 'VendorCode', 'VendorAddress1', 'VendorAddress2', 'VendorCity', 'VendorState', 'VendorZip',
  // Remit To (6)
  'RemitToName', 'RemitToCode', 'RemitToAddress1', 'RemitToAddress2', 'RemitToCity', 'RemitToState',
  // Bill To (6)
  'BillToName', 'BillToCode', 'BillToAddress1', 'BillToAddress2', 'BillToCity', 'BillToState',
  // Payment Terms (6)
  'DueDate', 'NetDays', 'TermsDescription', 'DiscountPercent', 'DiscountAmount', 'DiscountDueDate',
  // Line Items (7)
  'LineNumber', 'Quantity', 'UOM', 'UnitPrice', 'BuyerPartNumber', 'VendorPartNumber', 'LineDescription',
  // Totals (15)
  'InvoiceTotal', 'DiscountableAmount',
  'LocalTaxCode', 'LocalTaxAmount', 'StateTaxCode', 'StateTaxAmount',
  'FederalTaxCode', 'FederalTaxAmount', 'TaxExemptCode', 'TaxExemptAmount',
  'FreightAmount', 'FreightDescription',
  'MiscChargeCode', 'MiscChargeAmount', 'MiscChargeDescription',
  // References (6)
  'BillOfLading', 'PackingSlip', 'ReferenceNumber1', 'ReferenceQualifier1', 'ReferenceNumber2', 'ReferenceQualifier2',
  // Placeholders (10)
  'A1Q', 'A1D', 'A2Q', 'A2D', 'A3Q', 'A3D', 'A4Q', 'A4D', 'A5Q', 'A5D',
];
