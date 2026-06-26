// ============================================
// PromoStandards Invoice → EDIInvoiceData mapper
//
// Translates a single PromoStandards Invoice 1.0.0 payload into the
// same 79-field EDI record that the OCR pipeline produces. The
// downstream Corcentric serializer, portal review UI, and CSV
// export all consume EDIInvoiceData unchanged, so emitting the same
// shape means zero additional work on that side.
//
// Mapping decisions confirmed with product (2026-04-16):
//
//   ShipTo  → same as BillTo (PromoStandards Invoice 1.0.0 does not
//             carry ship-to on the invoice itself).
//   TaxArray→ Local/State/Federal buckets per this rule:
//             HST/GST or VAT  → Federal
//             PST             → State
//             SALES           → State when jurisdiction is a 2-char
//                               region code, else Local
//             Amounts for the same bucket sum; the jurisdiction of
//             the first contributor wins the TaxCode slot.
//   Charge line items → emitted as ordinary line-item rows with
//             BuyerPartNumber = chargeId, Description prefixed with
//             "[CHARGE] ". (The EDI format has a single line-item
//             shape; we keep shipping/handling summary totals on the
//             InvoiceTotals block separately, and only surface charge
//             *lines* that don't already flow into those totals.)
// ============================================

import type {
  Invoice,
  Tax,
  InvoiceLineItem,
  AccountInfo,
} from './types';
import type {
  EDIInvoiceData,
  AddressBlock,
  RemitToBlock,
  BillToBlock,
  LineItem,
  InvoiceTotals,
  InvoiceReferences,
  PlaceholderFields,
} from '../../../shared/src/types/invoice';

/**
 * Convert an ISO date `YYYY-MM-DD` (or full ISO datetime) to the
 * compact `YYYYMMDD` form the EDI record uses. Invalid → "".
 */
export function toYYYYMMDD(iso: string | undefined | null): string {
  if (!iso) return '';
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}

/** Format a number to a fixed-2 string, or "" for undefined/null. */
export function money(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '';
  return n.toFixed(2);
}

/** Format a number as-is (no forced decimals). */
function num(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return '';
  return String(n);
}

function accountToAddress(a: AccountInfo | undefined): AddressBlock {
  if (!a) {
    return { Name: '', Code: '', Address1: '', Address2: '', City: '', State: '', Zip: '' };
  }
  return {
    Name:     a.accountName   ?? '',
    Code:     a.accountNumber ?? '',
    Address1: a.address1      ?? '',
    Address2: a.address2      ?? '',
    City:     a.city          ?? '',
    State:    a.region        ?? '',
    Zip:      a.postalCode    ?? '',
  };
}

function accountToBillTo(a: AccountInfo | undefined): BillToBlock {
  if (!a) {
    return { Name: '', Code: '', Address1: '', Address2: '', City: '', State: '' };
  }
  return {
    Name:     a.accountName   ?? '',
    Code:     a.accountNumber ?? '',
    Address1: a.address1      ?? '',
    Address2: a.address2      ?? '',
    City:     a.city          ?? '',
    State:    a.region        ?? '',
  };
}

function accountToRemitTo(a: AccountInfo | undefined): RemitToBlock {
  // PromoStandards Invoice 1.0.0 does not carry a remit-to address.
  // The buyer fills this in separately (or leaves blank) — don't fake it.
  return { Name: '', Code: '', Address1: '', Address2: '', City: '', State: '' };
}

// ── Tax bucketing ───────────────────────────────────────────────

export type TaxBucket = 'local' | 'state' | 'federal';

/**
 * Classify a single Tax entry into Local / State / Federal.
 *
 *   HST/GST, VAT → Federal
 *   PST          → State
 *   SALES        → State  if jurisdiction looks like a 2-char code
 *                  Local  otherwise
 */
export function bucketForTax(t: Tax): TaxBucket {
  switch (t.taxType) {
    case 'HST/GST':
    case 'VAT':
      return 'federal';
    case 'PST':
      return 'state';
    case 'SALES':
    default: {
      const j = (t.taxJurisdiction || '').trim();
      return /^[A-Za-z]{2,3}$/.test(j) ? 'state' : 'local';
    }
  }
}

interface TaxBuckets {
  localCode: string;    localAmount: number;
  stateCode: string;    stateAmount: number;
  federalCode: string;  federalAmount: number;
}

export function bucketTaxes(taxes: Tax[] | undefined): TaxBuckets {
  const buckets: TaxBuckets = {
    localCode: '', localAmount: 0,
    stateCode: '', stateAmount: 0,
    federalCode: '', federalAmount: 0,
  };
  if (!taxes || taxes.length === 0) return buckets;

  for (const t of taxes) {
    const bucket = bucketForTax(t);
    const code = t.taxJurisdiction || t.taxType;
    if (bucket === 'local') {
      buckets.localAmount += t.taxAmount;
      if (!buckets.localCode) buckets.localCode = code;
    } else if (bucket === 'state') {
      buckets.stateAmount += t.taxAmount;
      if (!buckets.stateCode) buckets.stateCode = code;
    } else {
      buckets.federalAmount += t.taxAmount;
      if (!buckets.federalCode) buckets.federalCode = code;
    }
  }
  return buckets;
}

// ── Line item mapping ───────────────────────────────────────────

function lineItemToEdi(li: InvoiceLineItem, idx: number): LineItem {
  const isCharge = !!li.chargeId && !li.productId && !li.partId;
  const description = isCharge
    ? `[CHARGE] ${li.lineItemDescription}`
    : li.lineItemDescription;

  return {
    LineNumber:       li.invoiceLineItemNumber != null ? String(li.invoiceLineItemNumber) : String(idx + 1),
    Quantity:         num(li.invoiceQuantity),
    UOM:              li.quantityUOM || 'EA',
    UnitPrice:        money(li.unitPrice),
    BuyerPartNumber:  li.distributorPartId ?? li.distributorProductId ?? (isCharge ? (li.chargeId ?? '') : ''),
    VendorPartNumber: li.partId ?? li.productId ?? '',
    Description:      description ?? '',
  };
}

// ── Payment terms passthrough ───────────────────────────────────

function deriveNetDays(invoice: Invoice): string {
  if (!invoice.paymentDueDate || !invoice.invoiceDate) return '';
  const due  = Date.parse(invoice.paymentDueDate);
  const inv  = Date.parse(invoice.invoiceDate);
  if (!Number.isFinite(due) || !Number.isFinite(inv)) return '';
  const days = Math.round((due - inv) / 86_400_000);
  return days > 0 ? String(days) : '';
}

// ── Main entry point ────────────────────────────────────────────

export interface MapOptions {
  /**
   * When true, copy BillTo into ShipTo (confirmed behaviour for
   * PromoStandards ingestion — the spec has no ship-to on the
   * invoice itself).
   */
  shipToEqualsBillTo?: boolean;
}

/**
 * Map a single PromoStandards Invoice into the 79-field EDI record
 * the rest of the system consumes.
 */
export function mapPromostandardsInvoiceToEdi(
  inv: Invoice,
  opts: MapOptions = {},
): EDIInvoiceData {
  const shipToEqualsBillTo = opts.shipToEqualsBillTo !== false;

  const billToAddr = accountToAddress(inv.BillTo);     // full AddressBlock (for vendor slot if needed)
  const soldToAddr = accountToAddress(inv.SoldTo);

  // shipTo slot in EDIInvoiceData is an AddressBlock (has Zip);
  // per product decision it mirrors BillTo.
  const shipTo: AddressBlock = shipToEqualsBillTo ? billToAddr : {
    Name: '', Code: '', Address1: '', Address2: '', City: '', State: '', Zip: '',
  };

  // vendor slot: PromoStandards doesn't put vendor on invoice either,
  // but SoldTo on the response is "who we sold to" from the supplier's
  // viewpoint, not the vendor. Leave vendor blank; portal review can fill.
  const vendor: AddressBlock = {
    Name: '', Code: '', Address1: '', Address2: '', City: '', State: '', Zip: '',
  };

  const billTo: BillToBlock = accountToBillTo(inv.BillTo);
  const remitTo: RemitToBlock = accountToRemitTo(undefined);

  const buckets = bucketTaxes(inv.TaxArray);

  const totals: InvoiceTotals = {
    InvoiceTotal:           money(inv.invoiceAmount),
    DiscountableAmount:     money(inv.salesAmount),
    LocalTaxCode:           buckets.localCode,
    LocalTaxAmount:         money(buckets.localAmount),
    StateTaxCode:           buckets.stateCode,
    StateTaxAmount:         money(buckets.stateAmount),
    FederalTaxCode:         buckets.federalCode,
    FederalTaxAmount:       money(buckets.federalAmount),
    TaxExemptCode:          '',
    TaxExemptAmount:        '',
    FreightAmount:          money(inv.shippingAmount),
    FreightDescription:     inv.shippingAmount > 0 ? 'Shipping' : '',
    MiscChargeCode:         inv.handlingAmount > 0 ? 'HANDLING' : '',
    MiscChargeAmount:       money(inv.handlingAmount),
    MiscChargeDescription:  inv.handlingAmount > 0 ? 'Handling' : '',
  };

  const references: InvoiceReferences = {
    BillOfLading:        '',
    PackingSlip:         '',
    // Stash the first sales order number as a general-purpose reference.
    ReferenceNumber1:    inv.SalesOrderNumbersArray?.[0]?.salesOrderNumber ?? '',
    ReferenceQualifier1: inv.SalesOrderNumbersArray?.[0]?.salesOrderNumber ? 'SO' : '',
    ReferenceNumber2:    inv.purchaseOrderVersion ?? '',
    ReferenceQualifier2: inv.purchaseOrderVersion ? 'POV' : '',
  };

  const placeholders: PlaceholderFields = {
    A1Q: '', A1D: '',
    A2Q: '', A2D: '',
    A3Q: '', A3D: '',
    A4Q: '', A4D: '',
    A5Q: '', A5D: '',
  };

  return {
    header: {
      InvoiceDate: toYYYYMMDD(inv.invoiceDate),
      InvoiceNumber: inv.invoiceNumber,
      PODate: '',                        // not carried on PromoStandards Invoice
      PONumber: inv.purchaseOrderNumber ?? '',
      Currency: inv.currency || 'USD',
      ShipDate: '',                      // not carried on PromoStandards Invoice
    },
    shipTo,
    vendor,
    remitTo,
    billTo,
    paymentTerms: {
      DueDate:          toYYYYMMDD(inv.paymentDueDate),
      NetDays:          deriveNetDays(inv),
      Description:      inv.paymentTerms ?? '',
      DiscountPercent:  '',
      DiscountAmount:   '',
      DiscountDueDate:  '',
    },
    lineItems: inv.InvoiceLineItemsArray.map(lineItemToEdi),
    totals,
    references,
    placeholders,
  };
}

// ── Diagnostic helpers (used by the portal admin UI later) ──────

/**
 * Verify that the sum of TaxArray equals the invoice's `taxAmount`
 * header (spec requires this). Returns the delta; callers decide
 * what to do with it (flag / warn / auto-correct).
 */
export function taxArrayMismatch(inv: Invoice): number {
  if (!inv.TaxArray || inv.TaxArray.length === 0) return 0;
  const sum = inv.TaxArray.reduce((acc, t) => acc + (t.taxAmount || 0), 0);
  return Math.round((sum - inv.taxAmount) * 100) / 100;
}

/**
 * Verify invoiceAmountDue = invoiceAmount - advancePaymentAmount
 * (spec says this must hold). Returns the delta.
 */
export function amountDueMismatch(inv: Invoice): number {
  const expected = inv.invoiceAmount - inv.advancePaymentAmount;
  return Math.round((inv.invoiceAmountDue - expected) * 100) / 100;
}
