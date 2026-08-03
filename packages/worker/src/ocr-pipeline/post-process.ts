// ============================================
// Invoice Post-Processing Rules Engine
// Applies systematic field defaults and enrichment
// after OCR extraction, before saving to Supabase
// ============================================

export interface SupplierConfig {
  code: string;
  vendor_code_override?: string;
  remit_to_code?: string;
}

export interface PostProcessContext {
  supplier: SupplierConfig;
}

interface LineItem {
  LineNumber?: string;
  Description?: string;
  Quantity?: string;
  UOM?: string;
  UnitPrice?: string;
  LineItemAmount?: string;
  BuyerPartNumber?: string;
  VendorPartNumber?: string;
  ContainerNumber?: string;
  NetWeight?: string;
  GrossWeight?: string;
  WeightUOM?: string;
  PackagingQuantity?: string;
  PackagingUOM?: string;
  [key: string]: unknown;
}

// Keywords that indicate a shipping/freight line item
const SHIPPING_KEYWORDS = [
  'ups', 'fedex', 'usps', 'freight', 'shipping', 'ground', 'express',
  'overnight', 'delivery', 'carrier', 'transport', 'postage',
];

/**
 * Main post-processing entry point.
 * Applies all rules to the extracted invoice data and returns enriched data.
 *
 * Rules applied (in order):
 * 1. VendorCode: Always set to supplier's assigned code
 * 2. ShipDate: Default to InvoiceDate if missing
 * 3. RemitToCode: Set from supplier config if missing
 * 4. VendorPartNumber/BuyerPartNumber: Mirror if one is missing
 * 5. Shipping lines: Set part numbers to "SHIPPING" if detected
 * 6. TrackingNumber: Strip carrier prefix, keep raw number (CSV mapping TBD per Corcentric)
 *
 * NOTE: ShipToCode/BillToCode are NOT populated during post-processing.
 * Customer resolution happens at submission time via name matching against
 * the customers table. Address codes are not used.
 */
export async function postProcessInvoiceData(
  data: Record<string, unknown>,
  context: PostProcessContext
): Promise<Record<string, unknown>> {
  const enriched = { ...data };
  const appliedRules: string[] = [];

  // ─── Rule 1: VendorCode ───────────────────────────────
  // Always set to the supplier's assigned code, regardless of what OCR extracted.
  // The system-assigned code takes priority over anything on the invoice.
  const vendorCode = context.supplier.vendor_code_override || context.supplier.code;
  if (String(enriched.VendorCode || '').trim() !== vendorCode) {
    enriched.VendorCode = vendorCode;
    appliedRules.push(`VendorCode set to "${vendorCode}" (supplier assigned)`);
  }

  // ─── Rule 2: ShipDate defaults to InvoiceDate ─────────
  if (!String(enriched.ShipDate || '').trim() && String(enriched.InvoiceDate || '').trim()) {
    enriched.ShipDate = enriched.InvoiceDate;
    appliedRules.push(`ShipDate defaulted to InvoiceDate: ${enriched.InvoiceDate}`);
  }

  // ─── Rule 3: RemitToCode ──────────────────────────────
  if (!String(enriched.RemitToCode || '').trim() && context.supplier.remit_to_code) {
    enriched.RemitToCode = context.supplier.remit_to_code;
    appliedRules.push(`RemitToCode set to "${context.supplier.remit_to_code}" (supplier assigned)`);
  }

  // ─── Rule 4 & 5: Line Item Part Number Rules ──────────
  if (Array.isArray(enriched.LineItems)) {
    enriched.LineItems = (enriched.LineItems as LineItem[]).map((item, index) => {
      const processedItem = { ...item };
      const description = String(processedItem.Description || '').toLowerCase();
      const buyerPart = String(processedItem.BuyerPartNumber || '').trim();
      const vendorPart = String(processedItem.VendorPartNumber || '').trim();

      // Rule 6: Detect shipping/freight line items
      const isShippingLine = SHIPPING_KEYWORDS.some(kw => description.includes(kw));

      if (isShippingLine && !buyerPart && !vendorPart) {
        // Shipping line with no part numbers — set both to "SHIPPING"
        processedItem.BuyerPartNumber = 'SHIPPING';
        processedItem.VendorPartNumber = 'SHIPPING';
        appliedRules.push(`Line ${index + 1}: shipping detected, part numbers set to "SHIPPING"`);
      } else {
        // Rule 5: Mirror part numbers if one is missing
        if (buyerPart && !vendorPart) {
          processedItem.VendorPartNumber = buyerPart;
          appliedRules.push(`Line ${index + 1}: VendorPartNumber mirrored from BuyerPartNumber "${buyerPart}"`);
        } else if (vendorPart && !buyerPart) {
          processedItem.BuyerPartNumber = vendorPart;
          appliedRules.push(`Line ${index + 1}: BuyerPartNumber mirrored from VendorPartNumber "${vendorPart}"`);
        }
      }

      return processedItem;
    });
  }

  // ─── Rule 7: TrackingNumber cleanup ──────────────────
  // OCR may extract tracking numbers with line breaks (text wraps on PDF),
  // extra whitespace, or carrier prefixes. Clean all of that up.
  // CSV mapping TBD — waiting on Corcentric to specify which column/slot
  const rawTracking = String(enriched.TrackingNumber || '').trim();
  if (rawTracking) {
    let cleaned = rawTracking
      // Remove newlines, carriage returns, tabs — OCR wrapping artifacts
      .replace(/[\r\n\t]+/g, '')
      // Collapse any remaining whitespace sequences to nothing
      // (tracking numbers are continuous alphanumeric strings)
      .replace(/\s+/g, '')
      // Strip carrier prefixes: "UPS1Z..." or "UPS 1Z..." → "1Z..."
      .replace(/^(UPS|FedEx|USPS|DHL|TNT)/i, '')
      .trim();
    if (cleaned !== rawTracking) {
      enriched.TrackingNumber = cleaned;
      appliedRules.push(`TrackingNumber cleaned: "${rawTracking}" → "${cleaned}"`);
    }
  }

  // Store applied rules in metadata for auditability
  enriched._postProcessRules = appliedRules;

  console.log(`[PostProcess] Applied ${appliedRules.length} rules: ${appliedRules.join('; ')}`);

  return enriched;
}


