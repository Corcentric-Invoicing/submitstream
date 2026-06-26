// ============================================
// Corcentric Mapping Config — Defaults & Merge
//
// Provides DEFAULT_MAPPING_CONFIG and a helper
// to merge a partial per-supplier config with
// the defaults. Any field not specified by the
// supplier falls back to the default.
// ============================================

import { CorMappingConfig } from './types';

/**
 * Default mapping config — matches the current OCR extraction template.
 * Used when a supplier has no cor_mapping_config or for any fields
 * not overridden in the supplier's config.
 */
export const DEFAULT_MAPPING_CONFIG: CorMappingConfig = {
  // Corcentric defaults
  transactionType: 'P',
  currencyCode: 'USD',
  defaultLineDetailType: 'P',
  defaultUOM: 'EA',

  // Freight
  freightHandling: 'line_item',
  freightItemCode: 'FREIGHT',

  // Header field mappings (OCR field names)
  fieldMappings: {
    invoiceNumber: 'InvoiceNumber',
    invoiceDate: 'InvoiceDate',
    totalAmount: 'InvoiceTotal',
    purchaseOrderNumber: 'PONumber',
    purchaseOrderDate: 'PODate',
    customerCode: 'BillToCode',
    billingReference: undefined,
    freightAmount: 'FreightAmount',
    taxTotal: 'TaxAmount',
  },

  // Line items
  lineItemsField: 'LineItems',
  lineItemMappings: {
    partNumber: 'VendorPartNumber',
    description: 'Description',
    quantity: 'Quantity',
    unitPrice: 'UnitPrice',
    corePrice: 'CoreCharge',
    type: 'LineType',
    uom: 'UOM',
    buyerPartNumber: 'BuyerPartNumber',
    manufacturerCode: 'ManufacturerCode',
    vmrsCode: 'VMRSCode',
  },

  // References
  references: {
    TrackingNumber: 'BM',
    BillOfLading: 'BM',
    UnitNumber: 'UN',
    PackingSlip: 'PK',
    ReferenceZZ: 'ZZ',
    SalesOrderNumber: 'RF',
  },

  // Taxes
  taxField: 'Taxes',
  taxMappings: {
    type: 'TaxType',
    amount: 'TaxAmount',
    id: 'TaxID',
    description: 'TaxDescription',
  },

  // Validation
  requiredFields: ['invoiceNumber', 'invoiceDate', 'totalAmount'],

  // Description enrichment
  appendWeightToDescription: true,
  appendDeliveryTerms: true,
  mirrorVendorToBuyerPart: true,
};

/**
 * Merge a partial supplier config with the defaults.
 * Handles nested objects (fieldMappings, lineItemMappings, taxMappings).
 *
 * @param partial - Supplier's stored cor_mapping_config (may be null/undefined/partial)
 * @returns Fully populated CorMappingConfig with all defaults filled in
 */
export function resolveMappingConfig(partial?: Partial<CorMappingConfig> | null): CorMappingConfig {
  if (!partial) return { ...DEFAULT_MAPPING_CONFIG };

  return {
    // Top-level scalars — supplier overrides or default
    transactionType: partial.transactionType ?? DEFAULT_MAPPING_CONFIG.transactionType,
    currencyCode: partial.currencyCode ?? DEFAULT_MAPPING_CONFIG.currencyCode,
    defaultLineDetailType: partial.defaultLineDetailType ?? DEFAULT_MAPPING_CONFIG.defaultLineDetailType,
    defaultUOM: partial.defaultUOM ?? DEFAULT_MAPPING_CONFIG.defaultUOM,

    freightHandling: partial.freightHandling ?? DEFAULT_MAPPING_CONFIG.freightHandling,
    freightItemCode: partial.freightItemCode ?? DEFAULT_MAPPING_CONFIG.freightItemCode,

    // Nested objects — shallow merge each
    fieldMappings: {
      ...DEFAULT_MAPPING_CONFIG.fieldMappings,
      ...(partial.fieldMappings || {}),
    },

    lineItemsField: partial.lineItemsField ?? DEFAULT_MAPPING_CONFIG.lineItemsField,
    lineItemMappings: {
      ...DEFAULT_MAPPING_CONFIG.lineItemMappings,
      ...(partial.lineItemMappings || {}),
    },

    // References — supplier replaces entirely if provided, else default
    references: partial.references !== undefined ? partial.references : DEFAULT_MAPPING_CONFIG.references,

    taxField: partial.taxField !== undefined ? partial.taxField : DEFAULT_MAPPING_CONFIG.taxField,
    taxMappings: partial.taxMappings
      ? { ...DEFAULT_MAPPING_CONFIG.taxMappings, ...partial.taxMappings }
      : DEFAULT_MAPPING_CONFIG.taxMappings,

    requiredFields: partial.requiredFields ?? DEFAULT_MAPPING_CONFIG.requiredFields,

    appendWeightToDescription: partial.appendWeightToDescription ?? DEFAULT_MAPPING_CONFIG.appendWeightToDescription,
    appendDeliveryTerms: partial.appendDeliveryTerms ?? DEFAULT_MAPPING_CONFIG.appendDeliveryTerms,
    mirrorVendorToBuyerPart: partial.mirrorVendorToBuyerPart ?? DEFAULT_MAPPING_CONFIG.mirrorVendorToBuyerPart,
  };
}

/**
 * Build a CorMappingConfig from legacy separate columns.
 * Used during migration period — reads cor_transaction_type, cor_currency_code,
 * and cor_field_mapping and produces a unified config.
 */
export function buildConfigFromLegacy(supplier: Record<string, unknown>): Partial<CorMappingConfig> {
  const config: Partial<CorMappingConfig> = {};

  if (supplier.cor_transaction_type) {
    config.transactionType = String(supplier.cor_transaction_type) as CorMappingConfig['transactionType'];
  }
  if (supplier.cor_currency_code) {
    config.currencyCode = String(supplier.cor_currency_code) as CorMappingConfig['currencyCode'];
  }

  // If there's a legacy cor_field_mapping JSON, translate it
  if (supplier.cor_field_mapping && typeof supplier.cor_field_mapping === 'object') {
    const fm = supplier.cor_field_mapping as Record<string, unknown>;
    config.fieldMappings = {
      invoiceNumber: String(fm.invoiceNumber || 'InvoiceNumber'),
      invoiceDate: String(fm.invoiceDate || 'InvoiceDate'),
      totalAmount: String(fm.totalAmount || 'InvoiceTotal'),
      purchaseOrderNumber: fm.purchaseOrderNumber ? String(fm.purchaseOrderNumber) : undefined,
      purchaseOrderDate: fm.purchaseOrderDate ? String(fm.purchaseOrderDate) : undefined,
      customerCode: fm.customerCode ? String(fm.customerCode) : undefined,
      freightAmount: fm.freightAmountField ? String(fm.freightAmountField) : undefined,
    };

    if (fm.lineItemsField) config.lineItemsField = String(fm.lineItemsField);

    const li = fm.lineItem as Record<string, unknown> | undefined;
    if (li) {
      config.lineItemMappings = {
        partNumber: String(li.partNumber || 'VendorPartNumber'),
        description: li.description ? String(li.description) : undefined,
        quantity: String(li.quantity || 'Quantity'),
        unitPrice: String(li.unitPrice || 'UnitPrice'),
        corePrice: li.corePrice ? String(li.corePrice) : undefined,
        type: li.type ? String(li.type) : undefined,
        uom: li.uom ? String(li.uom) : undefined,
        buyerPartNumber: li.buyerPartNumber ? String(li.buyerPartNumber) : undefined,
        manufacturerCode: li.manufacturerCode ? String(li.manufacturerCode) : undefined,
        vmrsCode: li.vmrsCode ? String(li.vmrsCode) : undefined,
      };
    }

    if (fm.references) {
      config.references = fm.references as Record<string, CorMappingConfig['references'] extends Record<string, infer V> ? V : never>;
    }
  }

  return config;
}
