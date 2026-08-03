// ============================================
// PromoStandards Puller — Orchestration
//
// One call pulls every "new since last watermark" invoice for a
// single supplier:
//
//   1. Read the supplier's ps_* config.
//   2. Call getInvoices(queryType=4, availableTimeStamp=last_pulled).
//   3. Dedup against existing invoices (supplier_id + InvoiceNumber).
//   4. Insert a row per new invoice, in the same shape the OCR
//      pipeline produces, so the portal review flow + Corcentric
//      auto-submit handle it with no code changes.
//   5. Advance ps_last_pulled_at and log the attempt.
//
// The puller is invoked from:
//   - Admin-triggered HTTP route `/api/promostandards/pull/:id`
//   - Scheduled cron (future: wire via wrangler triggers)
//   - Node test harness (scripts/promostandards-pull.mjs)
// ============================================

import { SupabaseClient } from '@supabase/supabase-js';
import { callGetInvoices, bucketServiceMessages, extractSoapFault } from './client';
import { mapPromostandardsInvoiceToEdi } from './mapper';
import {
  InvoiceQueryType,
  type GetInvoiceRequest,
  type Invoice as PsInvoice,
  type ServiceMessage,
  type SupplierPromostandardsConfig,
} from './types';
import {
  validatePromostandardsInvoice,
  type DuplicateLookup,
} from '../validation/invoice-validator';

export interface PullerSupplier {
  id: string;
  code: string;
  name: string;
  ps_endpoint_url: string | null;
  ps_ws_version: string | null;
  ps_auth_id: string | null;
  ps_auth_password: string | null;
  ps_ingestion_enabled: boolean | null;
  ps_poll_interval_hours: number | null;
  ps_last_pulled_at: string | null;
}

export interface PullResult {
  ok: boolean;
  supplierId: string;
  httpStatus: number;
  durationMs: number;
  invoicesFound: number;
  invoicesStored: number;
  serviceMessages: ServiceMessage[];
  error?: string;
  pullLogId?: string;
}

// Truncate raw_response so we don't blow up the audit log with megabytes.
const MAX_RAW_RESPONSE_CHARS = 65_536;

/**
 * Pull new invoices from one supplier's PromoStandards endpoint.
 *
 * `availableSinceOverride` lets the caller force an availableTimeStamp
 * (e.g. when backfilling). When omitted we use ps_last_pulled_at or
 * fall back to "30 days ago" for suppliers that have never been pulled.
 */
export async function pullInvoicesForSupplier(
  supplier: PullerSupplier,
  serviceClient: SupabaseClient,
  options: { availableSinceOverride?: string; timeoutMs?: number } = {},
): Promise<PullResult> {
  // ── Config sanity ──
  if (!supplier.ps_endpoint_url) {
    return failEarly(supplier, 'Missing ps_endpoint_url');
  }
  if (!supplier.ps_auth_id) {
    return failEarly(supplier, 'Missing ps_auth_id');
  }

  const availableSince =
    options.availableSinceOverride ||
    supplier.ps_last_pulled_at ||
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const req: GetInvoiceRequest = {
    wsVersion: supplier.ps_ws_version || '1.0.0',
    id: supplier.ps_auth_id,
    password: supplier.ps_auth_password || '',
    queryType: InvoiceQueryType.AvailableTimestamp,
    availableTimeStamp: availableSince,
  };

  // ── SOAP call ──
  const pullStartedAt = new Date().toISOString();
  const call = await callGetInvoices(req, {
    endpointUrl: supplier.ps_endpoint_url,
    timeoutMs: options.timeoutMs,
  });

  const messages = call.response?.ServiceMessageArray ?? [];
  const { errors } = bucketServiceMessages(messages);
  const fault = extractSoapFault(call.responseXml);
  const hardFail = !call.httpSuccess || !!fault || errors.length > 0 || !call.response;

  // ── Log the attempt (always) ──
  const rawResponse = (call.responseXml || '').slice(0, MAX_RAW_RESPONSE_CHARS);
  const { data: logRow } = await serviceClient
    .from('promostandards_pulls')
    .insert({
      supplier_id: supplier.id,
      operation: 'getInvoices',
      query_type: InvoiceQueryType.AvailableTimestamp,
      available_since: availableSince,
      http_status: call.httpStatus,
      duration_ms: call.durationMs,
      invoices_found: call.response?.InvoiceArray?.length ?? 0,
      invoices_stored: 0, // updated after dedup
      service_messages: messages.length ? messages : null,
      error_message: call.error ?? fault ?? (errors[0]?.description ?? null),
      raw_response: hardFail ? rawResponse : rawResponse.slice(0, 2048), // keep only head on success
    })
    .select('id')
    .single();

  const pullLogId = logRow?.id as string | undefined;

  if (hardFail) {
    return {
      ok: false,
      supplierId: supplier.id,
      httpStatus: call.httpStatus,
      durationMs: call.durationMs,
      invoicesFound: call.response?.InvoiceArray?.length ?? 0,
      invoicesStored: 0,
      serviceMessages: messages,
      error: call.error ?? fault ?? errors[0]?.description ?? 'Unknown error',
      pullLogId,
    };
  }

  const invoices: PsInvoice[] = call.response?.InvoiceArray ?? [];

  // ── Dedup: skip invoices we've already stored (by supplier + invoice #) ──
  // Query once, then reuse the set for both the skip-check here AND the
  // duplicate-check feed into the validator.
  let alreadyStored = new Set<string>();
  const invoiceNumbers = invoices.map(i => i.invoiceNumber).filter(Boolean);
  if (invoiceNumbers.length) {
    const { data } = await serviceClient
      .from('invoices')
      .select('invoice_data')
      .eq('supplier_id', supplier.id);
    alreadyStored = new Set(
      (data ?? [])
        .map(r => (r.invoice_data as any)?.header?.InvoiceNumber)
        .filter(Boolean),
    );
  }

  // Duplicate-lookup feeds the validator — surfaces a warning without
  // blocking the insert, so humans can decide whether to rekey.
  const duplicateLookup: DuplicateLookup = {
    async hasDuplicate(_sup, invoiceNumber) { return alreadyStored.has(invoiceNumber); },
  };

  // ── Map + validate + insert new invoices ──
  const newRows: Array<Record<string, unknown>> = [];
  for (const psInv of invoices) {
    if (!psInv.invoiceNumber || alreadyStored.has(psInv.invoiceNumber)) continue;

    const ediData = mapPromostandardsInvoiceToEdi(psInv, { shipToEqualsBillTo: true });

    // Validation runs BEFORE the insert so findings land on the same
    // row in a single write. Errors still insert (the queue wants to
    // surface them for review, not silently drop the invoice).
    const findings = await validatePromostandardsInvoice({
      edi: ediData,
      source: psInv,
      supplierId: supplier.id,
      duplicateLookup,
    });

    newRows.push({
      supplier_id: supplier.id,
      file_name: `promostandards-${psInv.invoiceNumber}.xml`,
      r2_object_key: '',                           // no PDF for PromoStandards-sourced invoices
      status: 'pending',                           // enters review queue like OCR invoices
      confidence: 'high',                          // structured source → high confidence
      ocr_provider: 'manual',                      // not OCR'd
      ocr_raw_response: psInv,                     // stash the full PromoStandards payload for provenance
      invoice_data: ediData,
      source: 'upload',                            // legacy column — keep populated during transition
      ingestion_source: 'promostandards',          // new canonical source field
      validation_findings: findings.length ? findings : null,
      promostandards_pull_id: pullLogId,
      needs_supplier_review: false,
    });
  }

  let inserted = 0;
  if (newRows.length) {
    const { error: insertErr, count } = await serviceClient
      .from('invoices')
      .insert(newRows, { count: 'exact' });

    if (insertErr) {
      // Update the pull log with the partial failure; keep the raw response on disk for debugging.
      await serviceClient
        .from('promostandards_pulls')
        .update({
          error_message: `insert failed: ${insertErr.message}`,
          raw_response: rawResponse,
        })
        .eq('id', pullLogId ?? '');
      return {
        ok: false,
        supplierId: supplier.id,
        httpStatus: call.httpStatus,
        durationMs: call.durationMs,
        invoicesFound: invoices.length,
        invoicesStored: 0,
        serviceMessages: messages,
        error: `Insert failed: ${insertErr.message}`,
        pullLogId,
      };
    }
    inserted = count ?? newRows.length;
  }

  // ── Advance watermark + log count ──
  await Promise.all([
    serviceClient
      .from('suppliers')
      .update({ ps_last_pulled_at: pullStartedAt })
      .eq('id', supplier.id),
    serviceClient
      .from('promostandards_pulls')
      .update({ invoices_stored: inserted })
      .eq('id', pullLogId ?? ''),
  ]);

  return {
    ok: true,
    supplierId: supplier.id,
    httpStatus: call.httpStatus,
    durationMs: call.durationMs,
    invoicesFound: invoices.length,
    invoicesStored: inserted,
    serviceMessages: messages,
    pullLogId,
  };
}

function failEarly(supplier: PullerSupplier, reason: string): PullResult {
  return {
    ok: false,
    supplierId: supplier.id,
    httpStatus: 0,
    durationMs: 0,
    invoicesFound: 0,
    invoicesStored: 0,
    serviceMessages: [],
    error: reason,
  };
}

/**
 * Loop over every PromoStandards-enabled supplier whose
 * poll interval has elapsed and pull each in sequence.
 *
 * Designed to be called from a scheduled worker.
 */
export async function pullAllDueSuppliers(
  serviceClient: SupabaseClient,
): Promise<{ attempted: number; results: PullResult[] }> {
  const { data: suppliers, error } = await serviceClient
    .from('suppliers')
    .select('id, code, name, ps_endpoint_url, ps_ws_version, ps_auth_id, ps_auth_password, ps_ingestion_enabled, ps_poll_interval_hours, ps_last_pulled_at')
    .eq('ps_ingestion_enabled', true);

  if (error || !suppliers) {
    return { attempted: 0, results: [] };
  }

  const now = Date.now();
  const due: PullerSupplier[] = [];
  for (const s of suppliers as PullerSupplier[]) {
    const intervalMs = (s.ps_poll_interval_hours ?? 6) * 60 * 60 * 1000;
    const lastMs = s.ps_last_pulled_at ? Date.parse(s.ps_last_pulled_at) : 0;
    if (!Number.isFinite(lastMs) || now - lastMs >= intervalMs) due.push(s);
  }

  const results: PullResult[] = [];
  for (const s of due) {
    try {
      results.push(await pullInvoicesForSupplier(s, serviceClient));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      results.push({
        ok: false,
        supplierId: s.id,
        httpStatus: 0,
        durationMs: 0,
        invoicesFound: 0,
        invoicesStored: 0,
        serviceMessages: [],
        error: `Uncaught: ${msg}`,
      });
    }
  }

  return { attempted: due.length, results };
}

/** Exported for the test harness. */
export type { SupplierPromostandardsConfig };
