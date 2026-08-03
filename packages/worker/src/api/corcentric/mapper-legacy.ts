// ============================================
// Legacy Field Mapping Types
//
// Preserved for backward compatibility with handlers
// that import CorcentricFieldMapping or DEFAULT_FIELD_MAPPING
// from the mapper. New code should use CorMappingConfig instead.
// ============================================

import { CorReferenceType } from './types';

/**
 * @deprecated Use CorMappingConfig from types.ts instead.
 * Per-supplier mapping that tells the transformer which OCR field
 * names correspond to which Corcentric XML fields.
 */
export interface CorcentricFieldMapping {
  invoiceNumber: string;
  invoiceDate: string;
  totalAmount: string;
  purchaseOrderNumber?: string;
  purchaseOrderDate?: string;
  customerCode?: string;
  currencyCode?: string;
  billingReference?: string;
  freightAmountField?: string;
  lineItemsField: string;
  lineItem: {
    partNumber: string;
    description?: string;
    quantity: string;
    unitPrice: string;
    corePrice?: string;
    type?: string;
    uom?: string;
    buyerPartNumber?: string;
    vendorPartNumber?: string;
    manufacturerCode?: string;
    vmrsCode?: string;
  };
  references?: Record<string, CorReferenceType>;
  taxField?: string;
  tax?: {
    type: string;
    amount: string;
    id?: string;
    description?: string;
  };
}

/** @deprecated Use DEFAULT_MAPPING_CONFIG from mapping-config.ts instead. */
export const DEFAULT_FIELD_MAPPING: CorcentricFieldMapping = {
  invoiceNumber: 'InvoiceNumber',
  invoiceDate: 'InvoiceDate',
  totalAmount: 'InvoiceTotal',
  customerCode: 'BillToCode',
  purchaseOrderNumber: 'PONumber',
  purchaseOrderDate: 'PODate',
  freightAmountField: 'FreightAmount',
  lineItemsField: 'LineItems',
  lineItem: {
    partNumber: 'VendorPartNumber',
    description: 'Description',
    quantity: 'Quantity',
    unitPrice: 'UnitPrice',
    corePrice: 'CoreCharge',
    type: 'LineType',
    uom: 'UOM',
    buyerPartNumber: 'BuyerPartNumber',
    vendorPartNumber: 'VendorPartNumber',
    manufacturerCode: 'ManufacturerCode',
    vmrsCode: 'VMRSCode',
  },
  references: {
    TrackingNumber: 'BM',
    BillOfLading: 'BM',
    UnitNumber: 'UN',
    PackingSlip: 'PK',
    ReferenceZZ: 'ZZ',
    SalesOrderNumber: 'RF',
  },
  taxField: 'Taxes',
  tax: {
    type: 'TaxType',
    amount: 'TaxAmount',
    id: 'TaxID',
    description: 'TaxDescription',
  },
};
