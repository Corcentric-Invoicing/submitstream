// ============================================
// Invoice Validator
//
// Runs a set of pure, composable checks over an EDI invoice record
// plus (optionally) the connector-specific source record, and returns
// an array of ValidationFinding objects for persistence + display.
//
// Design points:
//   - Rules are pure and side-effect-free *except* for the duplicate
//     check, which needs a database lookup. That single rule is
//     factored behind a lookup function so the caller decides how to
//     run it (Supabase client in the worker, in-memory Set in tests).
//   - No PO validation: the system does not have PO visibility by
//     design (product decision 2026-04-17).
//   - New connectors can call `validateEdiInvoice` for the shared
//     rules, then append their own connector-specific findings
//     (e.g. PromoStandards has extendedPrice math that lives on the
//     source record, not the EDI mapping).
// ============================================

import type {
  EDIInvoiceData,
  ValidationFinding,
  ValidationSeverity,
} from '../../../shared/src/types/invoice';
import type { Invoice as PsInvoice } from '../promostandards/types';
import { ISO_4217 } from './iso-4217';
import { ISO_3166_1_ALPHA2 } from './iso-3166';

// ── Core rule helpers ───────────────────────────────────────────

function finding(
  severity: ValidationSeverity,
  code: string,
  message: string,
  field?: string,
): ValidationFinding {
  return field ? { severity, code, message, field } : { severity, code, message };
}

function parseMoney(v: string | undefined): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Round to 2 decimal places, cent-accurate. */
function cents(n: number): number {
  return Math.round(n * 100) / 100;
}

const CENT_TOLERANCE = 0.01; // lenient enough for rounding-order quirks

// ── EDI-level rules (shared by every connector) ─────────────────

/**
 * Check that every required EDI header field is present.
 * Missing fields are an error — they will break CSV/Corcentric output.
 */
export function checkRequiredFields(edi: EDIInvoiceData): ValidationFinding[] {
  const out: ValidationFinding[] = [];
  const h = edi.header;
  if (!h.InvoiceNumber) out.push(finding('error', 'MISSING_INVOICE_NUMBER', 'Invoice number is required.', 'header.InvoiceNumber'));
  if (!h.InvoiceDate)   out.push(finding('error', 'MISSING_INVOICE_DATE',   'Invoice date is required.',   'header.InvoiceDate'));
  if (!h.Currency)      out.push(finding('error', 'MISSING_CURRENCY',       'Currency is required.',       'header.Currency'));
  if (!edi.lineItems || edi.lineItems.length === 0) {
    out.push(finding('error', 'NO_LINE_ITEMS', 'Invoice has no line items.', 'lineItems'));
  }
  return out;
}

/** Currency must be a valid ISO 4217 code. */
export function checkCurrencyIso4217(edi: EDIInvoiceData): ValidationFinding[] {
  const c = (edi.header.Currency || '').toUpperCase();
  if (!c) return []; // covered by required-fields check
  return ISO_4217.has(c)
    ? []
    : [finding('error', 'CURRENCY_NOT_ISO4217', `Currency "${c}" is not a valid ISO 4217 code.`, 'header.Currency')];
}

/**
 * Country codes (bill-to / ship-to) must be ISO 3166-1 alpha-2
 * when present. Blank is fine — we accept missing country rather
 * than force a guess.
 */
export function checkCountryCodes(edi: EDIInvoiceData): ValidationFinding[] {
  // AddressBlock / BillToBlock in EDIInvoiceData don't carry a
  // Country field today (only State), so this rule fires only
  // against the source record in connector-specific checks.
  return [];
}

// ── PromoStandards-specific rules ───────────────────────────────

/**
 * TaxArray sum must equal the header taxAmount (spec-required).
 * Connector-specific because TaxArray only exists on the source
 * record; the EDI bucketing in the mapper already sums correctly.
 */
export function checkPsTaxArraySum(inv: PsInvoice): ValidationFinding[] {
  if (!inv.TaxArray || inv.TaxArray.length === 0) return [];
  const sum = cents(inv.TaxArray.reduce((s, t) => s + (t.taxAmount || 0), 0));
  const declared = cents(inv.taxAmount || 0);
  if (Math.abs(sum - declared) <= CENT_TOLERANCE) return [];
  return [finding(
    'warning',
    'TAX_ARRAY_SUM_MISMATCH',
    `TaxArray totals $${sum.toFixed(2)} but header taxAmount is $${declared.toFixed(2)}.`,
    'taxAmount',
  )];
}

/** invoiceAmountDue must equal invoiceAmount - advancePaymentAmount (spec-required). */
export function checkPsAmountDue(inv: PsInvoice): ValidationFinding[] {
  const expected = cents(inv.invoiceAmount - inv.advancePaymentAmount);
  const actual   = cents(inv.invoiceAmountDue);
  if (Math.abs(expected - actual) <= CENT_TOLERANCE) return [];
  return [finding(
    'warning',
    'AMOUNT_DUE_MISMATCH',
    `invoiceAmountDue is $${actual.toFixed(2)}; expected $${expected.toFixed(2)} (invoiceAmount − advancePaymentAmount).`,
    'invoiceAmountDue',
  )];
}

/**
 * Per-line: extendedPrice must equal (unitPrice × invoiceQuantity) − discountAmount.
 * PromoStandards spec carries this as a hard rule.
 */
export function checkPsLineItemMath(inv: PsInvoice): ValidationFinding[] {
  const out: ValidationFinding[] = [];
  (inv.InvoiceLineItemsArray || []).forEach((li, idx) => {
    const discount = li.discountAmount ?? 0;
    const expected = cents((li.unitPrice * li.invoiceQuantity) - discount);
    const actual   = cents(li.extendedPrice);
    if (Math.abs(expected - actual) > CENT_TOLERANCE) {
      out.push(finding(
        'warning',
        'LINE_EXTENDED_PRICE_MISMATCH',
        `Line ${li.invoiceLineItemNumber ?? idx + 1}: extendedPrice $${actual.toFixed(2)} ≠ expected $${expected.toFixed(2)} (unitPrice × invoiceQuantity − discountAmount).`,
        `InvoiceLineItemsArray[${idx}].extendedPrice`,
      ));
    }
  });
  return out;
}

/** Country code on BillTo/SoldTo must be ISO 3166-1 alpha-2 when present. */
export function checkPsCountryCodes(inv: PsInvoice): ValidationFinding[] {
  const out: ValidationFinding[] = [];
  const check = (cc: string | undefined, where: string) => {
    if (!cc) return;
    if (!ISO_3166_1_ALPHA2.has(cc.toUpperCase())) {
      out.push(finding('warning', 'COUNTRY_NOT_ISO3166', `Country "${cc}" is not a valid ISO 3166-1 alpha-2 code.`, where));
    }
  };
  check(inv.BillTo?.country, 'BillTo.country');
  check(inv.SoldTo?.country, 'SoldTo.country');
  return out;
}

// ── Duplicate check (async — requires caller-supplied lookup) ────

export interface DuplicateLookup {
  /** Returns true if an invoice with this supplier+number is already in the system. */
  hasDuplicate(supplierId: string, invoiceNumber: string): Promise<boolean>;
}

/** Returns a single 'warning' finding when a duplicate is detected. */
export async function checkDuplicate(
  supplierId: string,
  invoiceNumber: string,
  lookup: DuplicateLookup,
): Promise<ValidationFinding[]> {
  if (!invoiceNumber) return [];
  const dupe = await lookup.hasDuplicate(supplierId, invoiceNumber);
  return dupe
    ? [finding('warning', 'DUPLICATE_INVOICE_NUMBER', `Invoice number ${invoiceNumber} already exists for this supplier.`, 'header.InvoiceNumber')]
    : [];
}

// ── Orchestrators ───────────────────────────────────────────────

/** Shared rules runnable against any EDI invoice record. */
export function validateEdiInvoice(edi: EDIInvoiceData): ValidationFinding[] {
  return [
    ...checkRequiredFields(edi),
    ...checkCurrencyIso4217(edi),
    ...checkCountryCodes(edi),
  ];
}

export interface ValidatePromostandardsArgs {
  edi: EDIInvoiceData;
  source: PsInvoice;
  supplierId: string;
  duplicateLookup?: DuplicateLookup;
}

/**
 * Full validation pass for a PromoStandards-sourced invoice.
 * Runs the EDI rules plus the PromoStandards-specific spec rules,
 * then (optionally) the async duplicate check.
 */
export async function validatePromostandardsInvoice(
  args: ValidatePromostandardsArgs,
): Promise<ValidationFinding[]> {
  const findings: ValidationFinding[] = [
    ...validateEdiInvoice(args.edi),
    ...checkPsTaxArraySum(args.source),
    ...checkPsAmountDue(args.source),
    ...checkPsLineItemMath(args.source),
    ...checkPsCountryCodes(args.source),
  ];

  if (args.duplicateLookup) {
    const dupe = await checkDuplicate(
      args.supplierId,
      args.edi.header.InvoiceNumber,
      args.duplicateLookup,
    );
    findings.push(...dupe);
  }

  return findings;
}

/** Summarise findings into a triage bucket — handy for queue filters. */
export function worstSeverity(findings: ValidationFinding[]): ValidationSeverity | 'clean' {
  if (!findings || findings.length === 0) return 'clean';
  if (findings.some(f => f.severity === 'error'))   return 'error';
  if (findings.some(f => f.severity === 'warning')) return 'warning';
  return 'info';
}
