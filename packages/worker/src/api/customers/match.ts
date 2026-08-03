// ============================================
// Customer matcher
//
// Resolves an invoice's BillTo block against the customers table,
// using two passes:
//
//   1. Exact match on (supplier_id, supplier_code) via
//      customer_supplier_codes.  When an invoice carries the
//      supplier's own customer-account code, this is the reliable
//      identity join — "Acme Corp" on one invoice and "ACME CORP."
//      on the next both share account #A-1273 on that supplier,
//      and once we've recorded it, no more fuzzy matching needed.
//
//   2. Fuzzy name match using pg_trgm similarity, with a light
//      normalization (lowercase, strip common legal-suffix noise,
//      collapse whitespace) applied on both sides.  Optionally
//      boosted when the invoice's BillTo zip matches a candidate's
//      stored bill_to_zip — address agreement is a strong signal
//      that a near-miss name is the same entity.
//
// Returns a candidate list with similarity scores so the review UI
// can present "did you mean?" suggestions, and a single best
// customerId-or-null with a confidence score so the post-OCR hook
// can decide auto-link vs. needs_customer_review.
// ============================================

import { SupabaseClient } from '@supabase/supabase-js';

export interface MatchInput {
  supplierId: string;
  billToName: string;
  /** Supplier-specific customer code if the invoice carried one (rare but decisive). */
  billToCode?: string | null;
  /** Zip code from invoice BillTo; used as a tie-breaker signal. */
  billToZip?: string | null;
}

/**
 * Normalized BillTo fields pulled from an invoice_data JSONB.
 *
 * The OCR pipeline writes flat top-level keys (`BillToName`,
 * `BillToAddress1`, `BillToZip`, …) that track the EDI CSV column
 * names.  The PromoStandards puller writes a nested object
 * (`billTo.Name`, `billTo.Address1`, …) that matches the TypeScript
 * `EDIInvoiceData` type.  Consumers shouldn't have to know which path
 * produced a given row — they call this helper and get a consistent
 * shape back regardless.
 */
export interface ExtractedBillTo {
  name: string;
  code: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
}

export function extractBillTo(invoiceData: unknown): ExtractedBillTo {
  var empty = { name: '', code: '', address1: '', address2: '', city: '', state: '', zip: '' };
  if (!invoiceData || typeof invoiceData !== 'object') return empty;
  const data = invoiceData as Record<string, any>;

  // Nested shape (PromoStandards / EDIInvoiceData type).
  const nested = data.billTo;
  if (nested && typeof nested === 'object') {
    return {
      name:     String(nested.Name     ?? nested.name     ?? ''),
      code:     String(nested.Code     ?? nested.code     ?? ''),
      address1: String(nested.Address1 ?? nested.address1 ?? ''),
      address2: String(nested.Address2 ?? nested.address2 ?? ''),
      city:     String(nested.City     ?? nested.city     ?? ''),
      state:    String(nested.State    ?? nested.state    ?? ''),
      zip:      String(nested.Zip      ?? nested.zip      ?? ''),
    };
  }

  // Flat shape (OCR pipeline output, matches EDI CSV column names).
  return {
    name:     String(data.BillToName     ?? ''),
    code:     String(data.BillToCode     ?? ''),
    address1: String(data.BillToAddress1 ?? ''),
    address2: String(data.BillToAddress2 ?? ''),
    city:     String(data.BillToCity     ?? ''),
    state:    String(data.BillToState    ?? ''),
    zip:      String(data.BillToZip      ?? ''),
  };
}

export interface MatchCandidate {
  id: string;
  name: string;
  code: string;
  bill_to_zip: string | null;
  /** 0.0-1.0 trigram similarity after normalization. */
  similarity: number;
}

export interface MatchResult {
  /** The resolved customer, if confidence >= AUTO_LINK_THRESHOLD. */
  customerId: string | null;
  /** 1.0 = exact code match; 0.0-1.0 = fuzzy score (boosted for zip match). */
  confidence: number;
  /** Top N candidates sorted desc, for UI "did you mean" lists. */
  candidates: MatchCandidate[];
  /** Explanation of which pass matched, for debugging. */
  method: 'code' | 'name' | 'none';
}

/**
 * Confidence threshold above which we auto-link the customer to the
 * invoice without review.  Chosen conservatively — better to ask the
 * reviewer once than to create a silent wrong link.  Raise toward
 * 0.90+ if false positives show up in practice; lower if the name-
 * normalization leaves too many true matches below threshold.
 */
export const AUTO_LINK_THRESHOLD = 0.85;

/** Zip-match boost applied to the top fuzzy candidate.  Capped at 1.0. */
const ZIP_MATCH_BOOST = 0.10;

/** How many fuzzy candidates to return in the UI. */
const MAX_CANDIDATES = 5;

/**
 * Light name normalization.  Lowercases, strips common legal-suffix
 * noise ("Inc", "LLC", "Co", etc.), removes punctuation, collapses
 * whitespace.  Applied identically on both sides of the comparison
 * so the similarity score reflects the *semantic* name rather than
 * formatting differences.
 */
export function normalizeCustomerName(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\b(incorporated|corporation|company|limited|llc|inc|corp|co|ltd)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Main entry point.  Tries code-match first, then fuzzy name match.
 */
export async function matchCustomer(
  client: SupabaseClient,
  input: MatchInput,
): Promise<MatchResult> {
  const empty: MatchResult = { customerId: null, confidence: 0, candidates: [], method: 'none' };
  if (!input.billToName?.trim() && !input.billToCode?.trim()) return empty;

  // ── Pass 1: code match ────────────────────────────────────────
  if (input.billToCode?.trim()) {
    const { data, error } = await client
      .from('customer_supplier_codes')
      .select('customer_id, customers:customer_id(id, name, code, bill_to_zip)')
      .eq('supplier_id', input.supplierId)
      .eq('supplier_code', input.billToCode.trim())
      .eq('active', true)
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      const cust = (data.customers as unknown) as {
        id: string; name: string; code: string; bill_to_zip: string | null;
      } | null;
      if (cust?.id) {
        return {
          customerId: cust.id,
          confidence: 1.0,
          candidates: [{ ...cust, similarity: 1.0 }],
          method: 'code',
        };
      }
    }
  }

  // ── Pass 2: fuzzy name match ──────────────────────────────────
  const normalized = normalizeCustomerName(input.billToName);
  if (!normalized) return empty;

  // Run a trigram-similarity query against active customers.  The
  // gin_trgm_ops index on lower(name) makes this fast; ordering by
  // similarity DESC + LIMIT keeps it O(k) even as the customer list
  // grows.  Regex normalization is applied on both sides so that
  // "Acme Corp." and "Acme Corporation" score near-1.0 instead of
  // ~0.6.
  const { data: rows, error } = await client.rpc('fuzzy_match_customers', {
    query_text: normalized,
    max_results: MAX_CANDIDATES,
  });

  let candidates: MatchCandidate[] = [];
  if (!error && Array.isArray(rows)) {
    candidates = rows
      .filter((r: any) => r && typeof r.sim === 'number')
      .map((r: any) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        bill_to_zip: r.bill_to_zip ?? null,
        similarity: Number(r.sim),
      }));
  } else {
    // RPC not deployed yet (first-run) — fall back to a client-side fetch
    // and JS similarity calc against whatever's there.  Not ideal at
    // scale but adequate for low-volume bootstraps.
    const { data: allActive } = await client
      .from('customers')
      .select('id, name, code, bill_to_zip')
      .eq('active', true)
      .limit(500);

    if (Array.isArray(allActive)) {
      candidates = allActive
        .map(c => ({
          id: c.id as string,
          name: c.name as string,
          code: c.code as string,
          bill_to_zip: (c.bill_to_zip as string | null) ?? null,
          similarity: jsTrigramSimilarity(normalizeCustomerName(c.name as string), normalized),
        }))
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, MAX_CANDIDATES);
    }
  }

  if (candidates.length === 0) return empty;

  // Apply zip boost to the top candidate if zip is non-empty and matches.
  const top = candidates[0];
  let topConfidence = top.similarity;
  if (input.billToZip && top.bill_to_zip && input.billToZip.trim() === top.bill_to_zip.trim()) {
    topConfidence = Math.min(1.0, topConfidence + ZIP_MATCH_BOOST);
  }

  return {
    customerId: topConfidence >= AUTO_LINK_THRESHOLD ? top.id : null,
    confidence: topConfidence,
    candidates,
    method: 'name',
  };
}

// ── JS fallback trigram similarity ───────────────────────────────

/**
 * Very-approximate trigram similarity in JS.  Only used as a fallback
 * if the SQL RPC is unavailable.  Produces numbers in [0, 1] that are
 * broadly comparable to pg_trgm's similarity() for short strings.
 */
function jsTrigramSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const ta = trigramsOf(a);
  const tb = trigramsOf(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const t of ta) if (tb.has(t)) overlap++;
  return (2 * overlap) / (ta.size + tb.size);
}

function trigramsOf(s: string): Set<string> {
  const padded = '  ' + s + ' ';
  const set = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) set.add(padded.slice(i, i + 3));
  return set;
}

// ════════════════════════════════════════════════════════════════════
// SHIP-TO MATCHER
//
// After the customer has been resolved (invoice.customer_id set), the
// next question is "which of this customer's saved ship-to addresses
// does the OCR'd ShipTo correspond to?"  Mirrors the BillTo matcher but
// scoped to a single customer's customer_ship_tos rows.
//
// Why field-weighted similarity instead of single-string trigrams: the
// signal is spread across name + address1 + city + zip, and zip + state
// agreement carry near-deterministic weight when present. Weights:
//   name     0.25  (forgiving — abbreviations, typos)
//   address1 0.30  (strongest single signal)
//   city     0.15
//   state    0.10  (boolean exact-match)
//   zip      0.20  (boolean exact-match)
//
// Above SHIP_TO_AUTO_LINK_THRESHOLD: link silently (set ship_to_id, do
// not flag for review). Below: set needs_ship_to_review=true so the
// portal's ShipToMatchBanner surfaces the candidates.
// ════════════════════════════════════════════════════════════════════

export interface ExtractedShipTo {
  name: string;
  address1: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
}

/**
 * Extract ShipTo* fields from an invoice_data JSONB. Same nested-vs-flat
 * handling as extractBillTo.
 */
export function extractShipTo(invoiceData: unknown): ExtractedShipTo {
  const empty = { name: '', address1: '', address2: '', city: '', state: '', zip: '' };
  if (!invoiceData || typeof invoiceData !== 'object') return empty;
  const data = invoiceData as Record<string, any>;

  const nested = data.shipTo;
  if (nested && typeof nested === 'object') {
    return {
      name:     String(nested.Name     ?? nested.name     ?? ''),
      address1: String(nested.Address1 ?? nested.address1 ?? ''),
      address2: String(nested.Address2 ?? nested.address2 ?? ''),
      city:     String(nested.City     ?? nested.city     ?? ''),
      state:    String(nested.State    ?? nested.state    ?? ''),
      zip:      String(nested.Zip      ?? nested.zip      ?? ''),
    };
  }

  return {
    name:     String(data.ShipToName     ?? ''),
    address1: String(data.ShipToAddress1 ?? ''),
    address2: String(data.ShipToAddress2 ?? ''),
    city:     String(data.ShipToCity     ?? ''),
    state:    String(data.ShipToState    ?? ''),
    zip:      String(data.ShipToZip      ?? ''),
  };
}

export interface ShipToMatchCandidate {
  id: string;
  code: string;
  name: string | null;
  address1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  similarity: number;
}

export interface ShipToMatchResult {
  /** The resolved ship-to row id, if confidence >= SHIP_TO_AUTO_LINK_THRESHOLD. */
  shipToId: string | null;
  /** 0.0-1.0 best score across the customer's ship-tos. */
  confidence: number;
  /** Top N candidates sorted desc, for the UI banner. */
  candidates: ShipToMatchCandidate[];
  /** True when no extracted ShipTo content is present at all (skip review). */
  empty: boolean;
}

/** Auto-link threshold for ship-to. A bit lower than customer because
 *  per-customer ship-tos are a smaller pool with less ambiguity once
 *  the customer is locked. */
export const SHIP_TO_AUTO_LINK_THRESHOLD = 0.70;

export async function matchShipTo(
  supabase: SupabaseClient,
  customerId: string,
  extracted: ExtractedShipTo,
): Promise<ShipToMatchResult> {
  // No extracted ship-to at all — skip review entirely.
  const hasContent =
    extracted.name.trim() ||
    extracted.address1.trim() ||
    extracted.city.trim() ||
    extracted.zip.trim();
  if (!hasContent) {
    return { shipToId: null, confidence: 0, candidates: [], empty: true };
  }

  const { data, error } = await supabase
    .from('customer_ship_tos')
    .select('id, code, name, address1, city, state, zip')
    .eq('customer_id', customerId)
    .eq('active', true);

  if (error || !data || data.length === 0) {
    return { shipToId: null, confidence: 0, candidates: [], empty: false };
  }

  const candidates: ShipToMatchCandidate[] = (data as any[])
    .map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      address1: row.address1,
      city: row.city,
      state: row.state,
      zip: row.zip,
      similarity: shipToSimilarity(row, extracted),
    }))
    .sort((a, b) => b.similarity - a.similarity);

  const top = candidates[0];
  const shipToId = top && top.similarity >= SHIP_TO_AUTO_LINK_THRESHOLD ? top.id : null;
  return {
    shipToId,
    confidence: top ? top.similarity : 0,
    candidates: candidates.slice(0, 4),
    empty: false,
  };
}

function shipToNorm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

function shipToSimilarity(
  row: { name: string | null; address1: string | null; city: string | null; state: string | null; zip: string | null },
  extracted: ExtractedShipTo,
): number {
  const rName = shipToNorm(row.name);
  const rAddr = shipToNorm(row.address1);
  const rCity = shipToNorm(row.city);
  const rState = shipToNorm(row.state);
  const rZip = shipToNorm(row.zip);

  const eName = shipToNorm(extracted.name);
  const eAddr = shipToNorm(extracted.address1);
  const eCity = shipToNorm(extracted.city);
  const eState = shipToNorm(extracted.state);
  const eZip = shipToNorm(extracted.zip);

  const nameSim = rName && eName ? jsTrigramSimilarity(rName, eName) : 0;
  const addrSim = rAddr && eAddr ? jsTrigramSimilarity(rAddr, eAddr) : 0;
  const citySim = rCity && eCity ? jsTrigramSimilarity(rCity, eCity) : 0;
  const stateMatch = rState && eState && rState === eState ? 1 : 0;
  const zipMatch = rZip && eZip && rZip === eZip ? 1 : 0;

  return (
    0.25 * nameSim +
    0.30 * addrSim +
    0.15 * citySim +
    0.10 * stateMatch +
    0.20 * zipMatch
  );
}
