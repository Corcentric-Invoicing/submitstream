// ============================================
// PromoStandards API handlers
//
// Admin-only HTTP surface for the PromoStandards pipeline.
//
//   POST /api/promostandards/pull/:supplierId
//     Kick off an immediate pull for one supplier.
//     Body (optional): { availableSince?: ISO8601, timeoutMs?: number }
//
//   POST /api/promostandards/pull-all
//     Pull every enabled supplier whose poll interval has elapsed.
//     (Intended for cron and manual "flush queue" actions.)
//
//   POST /api/promostandards/test-connection
//     Body: { endpointUrl, wsVersion?, id, password?, sample? }
//     One-shot probe used on the supplier-onboarding screen to
//     confirm credentials work before flipping the enabled flag.
//
//   GET  /api/promostandards/pulls?supplierId=...
//     Last 50 pull attempts, for the admin debug panel.
// ============================================

import { RequestContext } from '../types';
import { errorResponse, jsonResponse } from '../middleware/response';
import { requireAdmin } from '../middleware/auth';
import { pullInvoicesForSupplier, pullAllDueSuppliers, type PullerSupplier } from '../promostandards/puller';
import { callGetInvoices, bucketServiceMessages, extractSoapFault } from '../promostandards/client';
import { InvoiceQueryType } from '../promostandards/types';

// Select clause we reuse for the supplier row the puller needs.
const SUPPLIER_SELECT =
  'id, code, name, ps_endpoint_url, ps_ws_version, ps_auth_id, ps_auth_password, ps_ingestion_enabled, ps_poll_interval_hours, ps_last_pulled_at';

/** POST /api/promostandards/pull/:supplierId */
export async function pullOneSupplierHandler(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const match = ctx.path.match(/\/api\/promostandards\/pull\/([\w-]+)$/);
  if (!match) return errorResponse('Invalid path', 400);
  const supplierId = match[1];

  let body: { availableSince?: string; timeoutMs?: number } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // empty body is fine
  }

  const { data: supplier, error } = await ctx.serviceClient
    .from('suppliers')
    .select(SUPPLIER_SELECT)
    .eq('id', supplierId)
    .single();

  if (error || !supplier) return errorResponse('Supplier not found', 404);

  const result = await pullInvoicesForSupplier(
    supplier as PullerSupplier,
    ctx.serviceClient,
    { availableSinceOverride: body.availableSince, timeoutMs: body.timeoutMs },
  );

  return jsonResponse(result, result.ok ? 200 : 502);
}

/** POST /api/promostandards/pull-all — run the scheduled sweep on demand. */
export async function pullAllSuppliersHandler(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const summary = await pullAllDueSuppliers(ctx.serviceClient);
  return jsonResponse(summary);
}

/**
 * POST /api/promostandards/test-connection
 *
 * Stateless probe — does NOT touch the database. Used by the
 * supplier-onboarding screen to validate creds and endpoint before
 * the admin flips ps_ingestion_enabled to true.
 */
export async function testConnectionHandler(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  let body: {
    endpointUrl?: string;
    wsVersion?: string;
    id?: string;
    password?: string;
    sample?: {
      queryType?: 1 | 2 | 3 | 4;
      referenceNumber?: string;
      requestedDate?: string;
      availableTimeStamp?: string;
    };
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.endpointUrl) return errorResponse('endpointUrl is required', 400);
  if (!body.id)          return errorResponse('id is required', 400);

  // Default probe: last 7 days. Non-destructive for the supplier.
  const defaultAvailable = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const qt = (body.sample?.queryType ?? 4) as InvoiceQueryType;
  const call = await callGetInvoices(
    {
      wsVersion: body.wsVersion || '1.0.0',
      id: body.id,
      password: body.password || '',
      queryType: qt,
      referenceNumber:    body.sample?.referenceNumber,
      requestedDate:      body.sample?.requestedDate,
      availableTimeStamp: body.sample?.availableTimeStamp || (qt === 4 ? defaultAvailable : undefined),
    },
    { endpointUrl: body.endpointUrl, timeoutMs: 20000 },
  );

  const messages = call.response?.ServiceMessageArray ?? [];
  const { errors, warnings } = bucketServiceMessages(messages);
  const fault = extractSoapFault(call.responseXml);
  const ok = call.httpSuccess && !fault && errors.length === 0 && !!call.response;

  return jsonResponse({
    ok,
    httpStatus: call.httpStatus,
    durationMs: call.durationMs,
    invoicesSeen: call.response?.InvoiceArray?.length ?? 0,
    serviceMessages: messages,
    errors,
    warnings,
    soapFault: fault ?? null,
    transportError: call.error ?? null,
    // Trim the raw response so the UI can surface it without being huge.
    responseExcerpt: (call.responseXml || '').slice(0, 4096),
  });
}

/**
 * GET /api/promostandards/health
 *
 * Returns one summary row per PromoStandards-enabled supplier, for the
 * admin dashboard's health cards. Each row includes:
 *
 *   - supplier identity (id, name, code)
 *   - ps_last_pulled_at + next_scheduled_pull (derived from poll interval)
 *   - status: 'green' | 'yellow' | 'red' | 'idle' based on the most
 *     recent pull in the audit log
 *   - invoices pulled in the last 7 and 30 days (from invoices table)
 *   - the most recent error_message / service_messages (if any) from
 *     promostandards_pulls
 *
 * Admin-only. Runs three queries in parallel: suppliers, recent pulls,
 * invoice counts per supplier.
 */
export async function healthSummaryHandler(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const { data: suppliers, error: supErr } = await ctx.serviceClient
    .from('suppliers')
    .select('id, name, code, ps_endpoint_url, ps_auth_id, ps_ingestion_enabled, ps_poll_interval_hours, ps_last_pulled_at')
    .eq('ps_ingestion_enabled', true)
    .order('name', { ascending: true });

  if (supErr) return errorResponse(`Query failed: ${supErr.message}`, 500);
  if (!suppliers || suppliers.length === 0) {
    return jsonResponse({ data: [], generatedAt: new Date().toISOString() });
  }

  const supplierIds = suppliers.map(s => s.id);
  const now = Date.now();
  const cutoff7  = new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
  const cutoff30 = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Pull each supplier's most recent pull, plus counts in last 7/30d,
  // plus invoice counts in last 7/30d — in parallel.
  const [latestPulls, recentInvoices] = await Promise.all([
    ctx.serviceClient
      .from('promostandards_pulls')
      .select('supplier_id, http_status, duration_ms, invoices_found, invoices_stored, service_messages, error_message, created_at')
      .in('supplier_id', supplierIds)
      .gte('created_at', cutoff30)
      .order('created_at', { ascending: false }),
    ctx.serviceClient
      .from('invoices')
      .select('supplier_id, created_at, validation_findings')
      .in('supplier_id', supplierIds)
      .eq('ingestion_source', 'promostandards')
      .gte('created_at', cutoff30),
  ]);

  // Fold pulls into per-supplier buckets: latest pull + 7d/30d counts.
  const pullsBySupplier = new Map<string, { latest: any; pulls7d: number; pulls30d: number }>();
  for (const row of (latestPulls.data ?? [])) {
    const sid = row.supplier_id as string;
    let bucket = pullsBySupplier.get(sid);
    if (!bucket) { bucket = { latest: row, pulls7d: 0, pulls30d: 0 }; pullsBySupplier.set(sid, bucket); }
    bucket.pulls30d += 1;
    if (row.created_at >= cutoff7) bucket.pulls7d += 1;
    // `latest` is set to first row because query is ordered DESC
  }

  const invoicesBySupplier = new Map<string, { stored7d: number; stored30d: number; withErrors: number; withWarnings: number }>();
  for (const row of (recentInvoices.data ?? [])) {
    const sid = row.supplier_id as string;
    let bucket = invoicesBySupplier.get(sid);
    if (!bucket) { bucket = { stored7d: 0, stored30d: 0, withErrors: 0, withWarnings: 0 }; invoicesBySupplier.set(sid, bucket); }
    bucket.stored30d += 1;
    if (row.created_at >= cutoff7) bucket.stored7d += 1;
    const findings = (row.validation_findings ?? []) as Array<{ severity: string }>;
    if (findings.some(f => f.severity === 'error'))   bucket.withErrors += 1;
    if (findings.some(f => f.severity === 'warning')) bucket.withWarnings += 1;
  }

  const data = suppliers.map(s => {
    const pulls = pullsBySupplier.get(s.id);
    const invs  = invoicesBySupplier.get(s.id);
    const intervalMs = ((s.ps_poll_interval_hours ?? 6) * 60 * 60 * 1000);
    const nextScheduledPull = s.ps_last_pulled_at
      ? new Date(Date.parse(s.ps_last_pulled_at) + intervalMs).toISOString()
      : null;

    // Status light: green (recent success, no errors), yellow (warnings or
    // stale), red (recent error), idle (never pulled).
    let status: 'green' | 'yellow' | 'red' | 'idle' = 'idle';
    if (pulls?.latest) {
      const hadError = !!pulls.latest.error_message || (pulls.latest.http_status >= 400);
      const hadWarn  = Array.isArray(pulls.latest.service_messages)
        && pulls.latest.service_messages.some((m: any) => m.severity === 'Warning');
      const stale = s.ps_last_pulled_at
        ? (Date.now() - Date.parse(s.ps_last_pulled_at)) > 2 * intervalMs
        : true;
      if (hadError) status = 'red';
      else if (hadWarn || stale) status = 'yellow';
      else status = 'green';
    }

    return {
      supplier_id: s.id,
      name: s.name,
      code: s.code,
      endpoint_url: s.ps_endpoint_url,
      poll_interval_hours: s.ps_poll_interval_hours ?? 6,
      last_pulled_at: s.ps_last_pulled_at,
      next_scheduled_pull: nextScheduledPull,
      status,
      pulls_7d: pulls?.pulls7d ?? 0,
      pulls_30d: pulls?.pulls30d ?? 0,
      invoices_7d: invs?.stored7d ?? 0,
      invoices_30d: invs?.stored30d ?? 0,
      invoices_with_errors_30d: invs?.withErrors ?? 0,
      invoices_with_warnings_30d: invs?.withWarnings ?? 0,
      latest_pull: pulls?.latest
        ? {
            created_at: pulls.latest.created_at,
            http_status: pulls.latest.http_status,
            duration_ms: pulls.latest.duration_ms,
            invoices_found: pulls.latest.invoices_found,
            invoices_stored: pulls.latest.invoices_stored,
            error_message: pulls.latest.error_message,
            service_messages: pulls.latest.service_messages,
          }
        : null,
    };
  });

  return jsonResponse({ data, generatedAt: new Date().toISOString() });
}

/** GET /api/promostandards/pulls?supplierId=... */
export async function listPullsHandler(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const supplierId = ctx.url.searchParams.get('supplierId');
  let q = ctx.serviceClient
    .from('promostandards_pulls')
    .select('id, supplier_id, operation, query_type, available_since, reference, http_status, duration_ms, invoices_found, invoices_stored, service_messages, error_message, created_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (supplierId) q = q.eq('supplier_id', supplierId);

  const { data, error } = await q;
  if (error) return errorResponse(`Query failed: ${error.message}`, 500);
  return jsonResponse({ data });
}
