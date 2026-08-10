// ============================================
// OCR Invoice Data → Corcentric DMS XML Mapper
//
// Transforms extracted invoice_data JSON into
// the Corcentric ProcessRequest structure.
//
// FULLY CONFIG-DRIVEN: reads a CorMappingConfig
// (per supplier) to bridge supplier-specific OCR
// field names to Corcentric's fixed XML tag names.
// No supplier-specific if/else branches.
// ============================================

import {
  CorProcessRequest,
  CorSection,
  CorLineDetail,
  CorReference,
  CorTax,
  CorLineDetailType,
  CorCurrencyCode,
  CorReferenceType,
  CorUOM,
  SupplierCorcentricConfig,
  CorMappingConfig,
} from './types';

import { CorcentricFieldMapping, DEFAULT_FIELD_MAPPING } from './mapper-legacy';
import { resolveMappingConfig } from './mapping-config';

export type { CorcentricFieldMapping };
export { DEFAULT_FIELD_MAPPING };

// ── Re-export legacy types for backward compatibility ──
// Handlers that haven't been updated yet can still import from mapper.

// ── Utilities ──

/**
 * Safely get a nested value from invoice_data using a field name.
 */
function getField(data: Record<string, unknown>, fieldName: string): unknown {
  return data[fieldName] ?? null;
}

/**
 * Parse a date string in various formats and return yyyymmdd.
 * Handles: MM/DD/YYYY, YYYY-MM-DD, DD-Mon-YYYY, etc.
 */
export function toCorDate(raw: unknown): string {
  if (!raw) return '';
  const str = String(raw).trim();
  if (!str) return '';

  // Already yyyymmdd?
  if (/^\d{8}$/.test(str)) return str;

  // YYYY-MM-DD (ISO date-only) — parse directly to avoid timezone shift
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
  }

  // MM/DD/YYYY or MM-DD-YYYY
  const slashMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (slashMatch) {
    return `${slashMatch[3]}${slashMatch[1].padStart(2, '0')}${slashMatch[2].padStart(2, '0')}`;
  }

  // Try JS Date parser as last resort (use UTC methods to avoid timezone shift)
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}${m}${d}`;
  }

  return str.replace(/\D/g, '').slice(0, 8); // Last resort: strip non-digits
}

/**
 * Normalize a monetary amount to a decimal string (no commas, no $).
 * Returns 4 decimal places for Corcentric Decimal(18,4) fields.
 */
export function toCorAmount(raw: unknown, decimals = 4): string {
  if (raw === null || raw === undefined) return '0.' + '0'.repeat(decimals);
  const str = String(raw).replace(/[$,\s]/g, '').trim();
  const num = parseFloat(str);
  if (isNaN(num)) return '0.' + '0'.repeat(decimals);
  return num.toFixed(decimals);
}

/**
 * Map an OCR line type to a Corcentric line detail type.
 * Falls back to the config's defaultLineDetailType.
 */
function mapLineType(raw: unknown, defaultType: CorLineDetailType): CorLineDetailType {
  if (!raw) return defaultType;
  const str = String(raw).toUpperCase().trim();
  const valid: CorLineDetailType[] = ['B','E','F','G','L','M','N','P','R','S','T','U','V','X'];
  if (valid.includes(str as CorLineDetailType)) return str as CorLineDetailType;

  // Common text-to-code mappings
  const textMap: Record<string, CorLineDetailType> = {
    'parts': 'P', 'part': 'P', 'labor': 'L', 'freight': 'F',
    'tax': 'T', 'misc': 'M', 'miscellaneous': 'M', 'shop': 'S',
    'shop supplies': 'S', 'fuel': 'G', 'rental': 'R', 'expense': 'E',
    'environmental': 'N', 'sublet': 'U', 'fixed': 'X', 'variable': 'V',
  };
  return textMap[str.toLowerCase()] || defaultType;
}

/**
 * Map UOM string to Corcentric UOM code.
 */
function mapUOM(raw: unknown, defaultUOM: CorUOM): CorUOM {
  if (!raw) return defaultUOM;
  const str = String(raw).toUpperCase().trim();
  const valid: CorUOM[] = ['EA', 'HR', 'MI', 'KM', 'CY', 'PL', 'ST', 'LB', 'GA', 'FT'];
  if (valid.includes(str as CorUOM)) return str as CorUOM;

  const textMap: Record<string, CorUOM> = {
    'each': 'EA', 'hour': 'HR', 'hours': 'HR', 'mile': 'MI',
    'miles': 'MI', 'kilometer': 'KM', 'km': 'KM', 'cycle': 'CY', 'cycles': 'CY',
    'pallet': 'PL', 'pallets': 'PL', 'short ton': 'ST', 'short tons': 'ST',
    'ton': 'ST', 'tons': 'ST', 'pound': 'LB', 'pounds': 'LB', 'lbs': 'LB',
    'gallon': 'GA', 'gallons': 'GA', 'gal': 'GA', 'foot': 'FT', 'feet': 'FT',
  };
  return textMap[str.toLowerCase()] || defaultUOM;
}

// ── Main Mapper (Config-Driven) ──

export interface MapperOptions {
  /** Corcentric API credentials */
  username: string;
  password: string;
  /** Supplier's Corcentric identity (from supplier table columns) */
  supplierConfig: SupplierCorcentricConfig;
  /** Resolved mapping config (from resolveMappingConfig) */
  mappingConfig: CorMappingConfig;
  /** Override request ID (for tracking) */
  requestId?: string;
}

/**
 * Legacy mapper options — for handlers not yet updated to use CorMappingConfig.
 * Will be removed once all handlers are migrated.
 */
export interface LegacyMapperOptions {
  username: string;
  password: string;
  supplierConfig: SupplierCorcentricConfig;
  fieldMapping?: CorcentricFieldMapping;
  requestId?: string;
}

/**
 * Transform extracted invoice_data into a Corcentric DMS ProcessRequest.
 * Uses the unified CorMappingConfig — no supplier-specific branches.
 *
 * @param invoiceData - The invoice_data JSON from OCR extraction
 * @param options - Credentials, supplier config, and mapping config
 * @returns A fully populated CorProcessRequest ready for XML serialization
 */
export function mapInvoiceToCorRequest(
  invoiceData: Record<string, unknown>,
  options: MapperOptions | LegacyMapperOptions,
): CorProcessRequest {
  // If called without mappingConfig, delegate to legacy mapper
  if (!('mappingConfig' in options) || !(options as MapperOptions).mappingConfig) {
    return mapInvoiceToCorRequestLegacy(invoiceData, options as LegacyMapperOptions);
  }

  const { username, password, supplierConfig, requestId } = options;
  const cfg = (options as MapperOptions).mappingConfig;
  const fm = cfg.fieldMappings;
  const lm = cfg.lineItemMappings;

  // ── Header fields ──
  const invoiceNumber = String(getField(invoiceData, fm.invoiceNumber) || '');
  const invoiceDate = toCorDate(getField(invoiceData, fm.invoiceDate));
  const totalAmount = toCorAmount(getField(invoiceData, fm.totalAmount));

  const poNumber = fm.purchaseOrderNumber
    ? String(getField(invoiceData, fm.purchaseOrderNumber) || '')
    : undefined;
  const rawPoDate = fm.purchaseOrderDate
    ? toCorDate(getField(invoiceData, fm.purchaseOrderDate))
    : '';
  const poDate = rawPoDate || (poNumber ? invoiceDate : undefined);

  const currencyCode: CorCurrencyCode = cfg.currencyCode;

  // ── References ──
  const references: CorReference[] = [];
  if (cfg.references) {
    for (const [ocrField, corType] of Object.entries(cfg.references)) {
      const value = getField(invoiceData, ocrField);
      if (value && String(value).trim()) {
        references.push({
          corReferenceType: corType,
          corReferenceValue: String(value).trim().slice(0, 80),
        });
      }
    }
  }

  // ── Line items ──
  const rawLines = getField(invoiceData, cfg.lineItemsField);
  const lineItems: CorLineDetail[] = [];

  if (Array.isArray(rawLines)) {
    rawLines.forEach((line: Record<string, unknown>, idx: number) => {
      // Build description (max 80 chars — kept clean, no weight/delivery appended)
      let description: string | undefined;
      if (lm.description) {
        description = String(line[lm.description] || '') || undefined;
      }

      // Build line-level notes for weight/delivery data (no length limit on notes)
      const lineNotes: string[] = [];
      if (cfg.appendWeightToDescription) {
        const netWt = line['NetWeight'] ? String(line['NetWeight']).trim() : '';
        const grossWt = line['GrossWeight'] ? String(line['GrossWeight']).trim() : '';
        const wtUom = line['WeightUOM'] ? String(line['WeightUOM']).trim() : '';
        if (netWt || grossWt) {
          const parts: string[] = [];
          if (netWt) parts.push(`Net: ${netWt}${wtUom ? ' ' + wtUom : ''}`);
          if (grossWt && grossWt !== netWt) parts.push(`Gross: ${grossWt}${wtUom ? ' ' + wtUom : ''}`);
          lineNotes.push(parts.join(' / '));
        }
      }

      const lineDetail: CorLineDetail = {
        corLineDetailSequence: idx + 1,
        corLineDetailType: mapLineType(line[lm.type || 'LineType'], cfg.defaultLineDetailType),
        corLineDetailItem: String(line[lm.partNumber] || `ITEM-${idx + 1}`).slice(0, 50),
        corLineDetailDescription: description?.slice(0, 80) || undefined,
        corLineDetailQuantity: toCorAmount(line[lm.quantity]),
        corLineDetailUnitPrice: toCorAmount(line[lm.unitPrice]),
        corLineDetailUOM: mapUOM(line[lm.uom || 'UOM'], cfg.defaultUOM),
        corLineDetailNotes: lineNotes.length > 0 ? lineNotes : undefined,
      };

      // Optional fields
      if (lm.corePrice && line[lm.corePrice]) {
        lineDetail.corLineDetailCorePrice = toCorAmount(line[lm.corePrice]);
      }

      // Buyer Part # — mirror vendor part if configured
      if (lm.buyerPartNumber && line[lm.buyerPartNumber]) {
        lineDetail.corLineDetailBuyerItem = String(line[lm.buyerPartNumber]).slice(0, 50);
      } else if (cfg.mirrorVendorToBuyerPart && lineDetail.corLineDetailItem) {
        lineDetail.corLineDetailBuyerItem = lineDetail.corLineDetailItem;
      }

      if (lm.manufacturerCode && line[lm.manufacturerCode]) {
        lineDetail.corLineDetailManufacturerCode = String(line[lm.manufacturerCode]).slice(0, 10);
      }
      if (lm.vmrsCode && line[lm.vmrsCode]) {
        lineDetail.corLineDetailVMRSCode = String(line[lm.vmrsCode]).slice(0, 20);
      }

      lineItems.push(lineDetail);
    });
  }

  // Append DeliveryTerms as a note on the last line item (not in description)
  if (cfg.appendDeliveryTerms) {
    const deliveryTerms = String(getField(invoiceData, 'DeliveryTerms') || '').trim();
    if (deliveryTerms && lineItems.length > 0) {
      const lastLine = lineItems[lineItems.length - 1];
      if (!lastLine.corLineDetailNotes) lastLine.corLineDetailNotes = [];
      lastLine.corLineDetailNotes.push(`Delivery Term: ${deliveryTerms}`);
    }
  }

  // ── Taxes ──
  const taxes: CorTax[] = [];
  if (cfg.taxField && cfg.taxMappings) {
    const rawTaxes = getField(invoiceData, cfg.taxField);
    if (Array.isArray(rawTaxes)) {
      rawTaxes.forEach((t: Record<string, unknown>) => {
        taxes.push({
          corTaxType: String(t[cfg.taxMappings!.type] || 'TAX'),
          corTaxAmount: toCorAmount(t[cfg.taxMappings!.amount], 2),
          corTaxID: cfg.taxMappings!.id ? String(t[cfg.taxMappings!.id] || '') || undefined : undefined,
          corTaxDescription: cfg.taxMappings!.description ? String(t[cfg.taxMappings!.description] || '') || undefined : undefined,
        });
      });
    }
  }

  // Fallback: read tax from single-field OR from the split fields our
  // OCR schema produces (StateTaxAmount / LocalTaxAmount / FederalTaxAmount).
  // Emit one corTax entry per non-zero source, using DMS tax type codes
  // per CORCENTRIC-DMS-GUIDE.md §Tax Types (ST=state, LT=local; federal
  // isn't in the code table so falls back to generic SALES if present).
  if (taxes.length === 0) {
    // Legacy single-field path first (some suppliers configure this)
    const taxTotalField = cfg.fieldMappings.taxTotal || 'TaxAmount';
    const singleTax = getField(invoiceData, taxTotalField) || getField(invoiceData, 'SalesTax');
    const singleTaxNum = singleTax ? parseFloat(String(singleTax).replace(/[$,]/g, '')) : 0;

    // OCR-schema split-tax path
    const stateTax = getField(invoiceData, 'StateTaxAmount');
    const localTax = getField(invoiceData, 'LocalTaxAmount');
    const federalTax = getField(invoiceData, 'FederalTaxAmount');
    const stateNum = stateTax ? parseFloat(String(stateTax).replace(/[$,]/g, '')) : 0;
    const localNum = localTax ? parseFloat(String(localTax).replace(/[$,]/g, '')) : 0;
    const federalNum = federalTax ? parseFloat(String(federalTax).replace(/[$,]/g, '')) : 0;

    // Prefer the split-tax fields when any is populated — more granular +
    // matches DMS's per-type tax model. Fall back to single-field when no
    // split values exist.
    if (stateNum + localNum + federalNum > 0) {
      if (stateNum > 0) taxes.push({ corTaxType: 'ST', corTaxAmount: toCorAmount(stateNum, 2) });
      if (localNum > 0) taxes.push({ corTaxType: 'LT', corTaxAmount: toCorAmount(localNum, 2) });
      if (federalNum > 0) taxes.push({ corTaxType: 'SALES', corTaxAmount: toCorAmount(federalNum, 2) });
    } else if (singleTaxNum > 0) {
      taxes.push({ corTaxType: 'SALES', corTaxAmount: toCorAmount(singleTaxNum, 2) });
    }
  }

  // ── Freight as line item ──
  if (cfg.freightHandling === 'line_item' && fm.freightAmount) {
    const rawFreight = getField(invoiceData, fm.freightAmount);
    if (rawFreight && parseFloat(String(rawFreight).replace(/[$,]/g, '')) > 0) {
      lineItems.push({
        corLineDetailSequence: lineItems.length + 1,
        corLineDetailType: 'F',
        corLineDetailItem: cfg.freightItemCode || 'FREIGHT',
        corLineDetailDescription: 'Freight / Shipping',
        corLineDetailQuantity: '1',
        corLineDetailUnitPrice: toCorAmount(rawFreight),
        corLineDetailUOM: 'EA',
      });
    }
  }

  // ── Build the single section ──
  const section: CorSection = {
    corSectionNumber: 1,
    corLineDetails: lineItems,
  };

  // ── Auto-correct cents-vs-dollars OCR mismatch ──
  // Some OCR providers extract amounts without decimal points (e.g., "3463105"
  // instead of "34631.05"). Detect by checking if the line item sum is ~10x, ~100x,
  // or ~1000x the invoice total, and correct by dividing unit prices accordingly.
  const parsedTotal = parseFloat(totalAmount);
  if (parsedTotal > 0 && section.corLineDetails.length > 0) {
    let rawSum = 0;
    section.corLineDetails.forEach((line) => {
      rawSum += parseFloat(line.corLineDetailQuantity || '0') * parseFloat(line.corLineDetailUnitPrice || '0');
    });
    if (rawSum > 0) {
      const ratio = rawSum / parsedTotal;
      // Check for common decimal-shift ratios (10x, 100x, 1000x)
      for (const divisor of [10, 100, 1000]) {
        if (Math.abs(ratio - divisor) / divisor < 0.02) {
          // Correct all unit prices by dividing by the detected divisor
          section.corLineDetails.forEach((line) => {
            const corrected = parseFloat(line.corLineDetailUnitPrice || '0') / divisor;
            line.corLineDetailUnitPrice = corrected.toFixed(4);
          });
          console.warn(`[Mapper] Detected OCR amounts off by ${divisor}x vs invoice total — auto-corrected unit prices`);
          break;
        }
      }
    }
  }

  // ── Assemble the full request ──
  const request: CorProcessRequest = {
    UserName: username,
    Password: password,
    corRequest: {
      corRequestID: requestId || `REQ-${Date.now()}`,
      corRequestType: 'S',
      corVendorCode: supplierConfig.corVendorCode,
      // Customer code is resolved by the submit handler via customer_supplier_codes table
      // (not extracted from OCR — OCR bill-to codes are supplier-specific, not Corcentric codes)
      corCustomerCode: supplierConfig.corCustomerCode,
      corCommunityCode: supplierConfig.corCommunityCode,
      corTransactionType: cfg.transactionType,
      corTransactionNumber: invoiceNumber.slice(0, 80),
      corTransactionDate: invoiceDate,
      corTransactionAmount: totalAmount,
      corAuthorizationAmount: totalAmount,
      corCurrencyCode: currencyCode,
      corSections: [section],
    },
  };

  // Optional fields
  if (poNumber) request.corRequest.corPurchaseOrderNumber = poNumber.slice(0, 22);
  if (poDate) request.corRequest.corPurchaseOrderDate = poDate;
  if (references.length > 0) request.corRequest.corReferences = references;
  if (taxes.length > 0) request.corRequest.corTaxes = taxes;

  return request;
}

// ── Legacy Mapper (backward compat) ──

/**
 * Legacy mapper that uses the old CorcentricFieldMapping interface.
 * Delegates to the new config-driven mapper by converting the old format.
 */
function mapInvoiceToCorRequestLegacy(
  invoiceData: Record<string, unknown>,
  options: LegacyMapperOptions,
): CorProcessRequest {
  const fm = options.fieldMapping || DEFAULT_FIELD_MAPPING;

  // Convert legacy field mapping to new config format
  const mappingConfig = resolveMappingConfig({
    transactionType: options.supplierConfig.defaultTransactionType,
    currencyCode: options.supplierConfig.defaultCurrencyCode,
    freightItemCode: options.supplierConfig.defaultFreightCode,
    fieldMappings: {
      invoiceNumber: fm.invoiceNumber,
      invoiceDate: fm.invoiceDate,
      totalAmount: fm.totalAmount,
      purchaseOrderNumber: fm.purchaseOrderNumber,
      purchaseOrderDate: fm.purchaseOrderDate,
      customerCode: fm.customerCode,
      freightAmount: fm.freightAmountField,
    },
    lineItemsField: fm.lineItemsField,
    lineItemMappings: {
      partNumber: fm.lineItem.partNumber,
      description: fm.lineItem.description,
      quantity: fm.lineItem.quantity,
      unitPrice: fm.lineItem.unitPrice,
      corePrice: fm.lineItem.corePrice,
      type: fm.lineItem.type,
      uom: fm.lineItem.uom,
      buyerPartNumber: fm.lineItem.buyerPartNumber,
      manufacturerCode: fm.lineItem.manufacturerCode,
      vmrsCode: fm.lineItem.vmrsCode,
    },
    references: fm.references,
    taxField: fm.taxField,
    taxMappings: fm.tax,
  });

  return mapInvoiceToCorRequest(invoiceData, {
    ...options,
    mappingConfig,
  });
}

// ── Validation ──

export interface MappingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate that a mapped CorProcessRequest has all required fields
 * for a Transaction Submission before serialization.
 */
export function validateCorRequest(req: CorProcessRequest): MappingValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const r = req.corRequest;

  // Required header fields
  if (!req.UserName) errors.push('Missing UserName (Corcentric API credential)');
  if (!req.Password) errors.push('Missing Password (Corcentric API credential)');
  if (!r.corVendorCode) errors.push('Missing corVendorCode (supplier not configured for Corcentric)');
  if (!r.corCustomerCode) errors.push('Missing corCustomerCode (no matching customer found — add a customer record with a Corcentric customer code)');
  if (!r.corCommunityCode) errors.push('Missing corCommunityCode (supplier not configured for Corcentric)');
  if (!r.corTransactionNumber) errors.push('Missing corTransactionNumber (invoice number not extracted)');
  if (!r.corTransactionDate || r.corTransactionDate.length !== 8) errors.push('Missing or invalid corTransactionDate');
  if (!r.corTransactionAmount || r.corTransactionAmount === '0.0000') warnings.push('corTransactionAmount is zero');
  if (!r.corCurrencyCode) errors.push('Missing corCurrencyCode');

  // Line items
  if (r.corSections.length === 0) errors.push('No sections defined');
  const section = r.corSections[0];
  if (section && section.corLineDetails.length === 0) {
    warnings.push('No line items extracted — XML will have empty section');
  }

  // Check each line item
  section?.corLineDetails.forEach((line, i) => {
    if (!line.corLineDetailItem) warnings.push(`Line ${i + 1}: missing item/part number`);
    if (line.corLineDetailQuantity === '0.0000') warnings.push(`Line ${i + 1}: quantity is zero`);
    if (line.corLineDetailUnitPrice === '0.0000') warnings.push(`Line ${i + 1}: unit price is zero`);
  });

  // Line item total vs invoice total reconciliation
  if (section && section.corLineDetails.length > 0 && r.corTransactionAmount) {
    const invoiceTotal = parseFloat(r.corTransactionAmount);
    let lineItemSum = 0;
    section.corLineDetails.forEach((line) => {
      const qty = parseFloat(line.corLineDetailQuantity || '0');
      const price = parseFloat(line.corLineDetailUnitPrice || '0');
      lineItemSum += qty * price;
    });

    if (r.corTaxes) {
      r.corTaxes.forEach((t) => {
        lineItemSum += parseFloat(t.corTaxAmount || '0');
      });
    }

    const diff = Math.abs(invoiceTotal - lineItemSum);
    if (diff > 0.02) {
      errors.push(
        `Line item total mismatch: lines + freight + tax = $${lineItemSum.toFixed(2)} but invoice total = $${invoiceTotal.toFixed(2)} (difference: $${diff.toFixed(2)})`
      );
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}
