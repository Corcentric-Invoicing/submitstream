// ============================================
// Corcentric Submit Handler
//
// POST /api/invoices/:id/corcentric-submit
//   Validates, maps, serializes, and submits an
//   invoice to the Corcentric DMS Web Service.
//
// POST /api/invoices/:id/corcentric-submit?dry_run=true
//   Same flow but skips the actual HTTP POST.
//
// GET /api/corcentric-submissions
//   List submission history (with optional filters).
//
// POST /api/invoices/:id/corcentric-retry
//   Retry a failed submission.
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { extractPathId } from '../middleware/safeParse';
import {
  getInvoiceWithCorcentricConfig,
  resolveCorCustomerCodeByName,
  resolveCorcentricCredentials,
} from '../db/queries';
import {
  insertSubmission,
  updateSubmission,
  getLatestSubmission,
  listSubmissions,
  countSubmissionAttempts,
} from '../db/submission-queries';
import { mapInvoiceToCorRequest, validateCorRequest } from '../corcentric/mapper';
import { serializeCorRequest } from '../corcentric/serializer';
import { submitToCorcentricApi, corStatusToSubmissionStatus } from '../corcentric/client';
import { resolveMappingConfig, buildConfigFromLegacy } from '../corcentric/mapping-config';
import type { SupplierCorcentricConfig, CorMappingConfig } from '../corcentric/types';

const MAX_RETRY_ATTEMPTS = 3;

/**
 * Extract the authenticated user's ID from the Supabase JWT.
 * Returns null if unauthenticated or on any error (best-effort for audit trail).
 */
async function extractUserId(ctx: RequestContext): Promise<string | null> {
  try {
    const { data: { user } } = await ctx.userClient.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Submit an invoice to Corcentric DMS.
 *
 * Flow:
 * 1. Load invoice + supplier config
 * 2. Validate supplier has Corcentric codes configured
 * 3. Map OCR data → Corcentric ProcessRequest
 * 4. Validate mapped request
 * 5. Serialize to XML
 * 6. Create submission record (status: pending)
 * 7. POST to Corcentric API (unless dry_run)
 * 8. Parse response, update submission record
 * 9. Return result
 */
export async function submitToCorcentricHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid invoice ID', 400);

  const isDryRun = ctx.url.searchParams.get('dry_run') === 'true';

  // ── 1. Load invoice + supplier config ──
  const { data, error } = await getInvoiceWithCorcentricConfig(ctx.serviceClient, id);
  if (error || !data) return errorResponse('Invoice not found', 404);
  if (!data.invoice_data) return errorResponse('Invoice has no extracted data — run OCR first', 400);

  // Only allow submission of processed/pending invoices
  if (!['processed', 'pending'].includes(data.status)) {
    return errorResponse(`Cannot submit invoice with status "${data.status}" — must be processed or pending`, 400);
  }

  // ── 2. Validate supplier Corcentric config ──
  const rawSupplier = data.suppliers;
  const supplier = (Array.isArray(rawSupplier) ? rawSupplier[0] : rawSupplier) as Record<string, unknown> | null;
  if (!supplier) return errorResponse('Invoice has no associated supplier', 400);

  // cor_ingestion_enabled controls automatic ingestion only.
  // Manual submissions (button click) and dry runs are always allowed.

  // ── Pick the community for this submission ──
  // Priority:
  //   1. Primary row in supplier_communities (is_primary=true, active=true)
  //   2. Any active row in supplier_communities
  //   3. Legacy supplier.communities (single-FK fallback during the
  //      SUPPLIER-COMMUNITIES-REFACTOR transition; drop once UI is updated
  //      and all suppliers are migrated)
  // A future change should let the invoice carry an explicit community_id
  // so a supplier on multiple communities can be routed deterministically;
  // for now, primary wins.
  type SupplierCommunityRow = {
    community_id?: string;
    cor_vendor_code?: string | null;
    cor_customer_code?: string | null;
    is_primary?: boolean;
    active?: boolean;
    communities?: Record<string, unknown> | null;
  };
  const joinRowsRaw = (supplier as Record<string, unknown>).supplier_communities;
  const joinRows: SupplierCommunityRow[] = Array.isArray(joinRowsRaw)
    ? (joinRowsRaw as SupplierCommunityRow[]).filter((r) => r?.active !== false)
    : [];
  const primaryJoin =
    joinRows.find((r) => r.is_primary) || joinRows[0] || null;

  // communityRec used downstream for API creds + community code resolution.
  // Prefer the join's nested community; fall back to legacy supplier.communities.
  const communityRec =
    (primaryJoin?.communities as Record<string, unknown> | null) ||
    ((supplier as Record<string, unknown>).communities as Record<string, unknown> | null);

  // Resolve vendor code: prefer join row → legacy supplier column.
  const resolvedVendorCode = String(
    primaryJoin?.cor_vendor_code || supplier.cor_vendor_code || ''
  );
  if (resolvedVendorCode) {
    (supplier as Record<string, unknown>).cor_vendor_code = resolvedVendorCode;
  }

  // Resolve community code: prefer joined communities.code, fall back to
  // legacy supplier.cor_community_code text column.
  const resolvedCommunityCode = String(
    communityRec?.code || supplier.cor_community_code || ''
  );
  if (resolvedCommunityCode) {
    (supplier as Record<string, unknown>).cor_community_code = resolvedCommunityCode;
  }

  if (!supplier.cor_vendor_code || !supplier.cor_community_code) {
    return errorResponse(
      'Supplier is missing Corcentric codes (corVendorCode or corCommunityCode). ' +
        'Add this supplier to a community with the vendor code on the Communities admin screen.',
      400,
    );
  }

  // ── 3. Resolve API credentials (community → supplier legacy → env) ──
  // Credentials live encrypted-at-rest as bytea in cor_username_enc /
  // cor_password_enc. resolveCorcentricCredentials() decrypts via the
  // decrypt_credential RPC (RSK-01). Worker never handles the key.
  const creds = await resolveCorcentricCredentials(ctx.serviceClient, {
    community: communityRec,
    supplier,
    envApiUrl: ctx.env.CORCENTRIC_API_URL,
    envApiUser: ctx.env.CORCENTRIC_USERNAME,
    envApiPass: ctx.env.CORCENTRIC_PASSWORD,
  });
  const apiUrl = creds.apiUrl;
  const apiUser = creds.apiUser;
  const apiPass = creds.apiPass;

  // Credential check. Live submit always requires creds. Dry run with
  // creds = full round-trip ping to Corcentric (path B); without creds
  // = local-only XML preview (legacy fallback).
  const hasCreds = Boolean(apiUrl && apiUser && apiPass);
  if (!isDryRun && !hasCreds) {
    return errorResponse(
      'Corcentric API credentials not configured for this community. Set cor_username, cor_password, and cor_api_url in community settings.',
      400,
    );
  }
  // Dry-run mode flag: when creds exist, we'll actually POST to
  // Corcentric to validate connectivity + auth. When they don't, we
  // skip the POST and return the XML for review only.
  const dryRunWithPing = isDryRun && hasCreds;

  // ── 4. Resolve customer code ──
  // Customer is resolved from the customers table, primarily by name.
  // Priority chain:
  //   1. Name match: ShipToName → customers.name → customers.cor_customer_code
  //   2. Name match: BillToName → customers.name → customers.cor_customer_code
  //   3. Fallback: supplier.cor_customer_code (default for this supplier)
  const invoiceData = data.invoice_data as Record<string, unknown>;
  const ocrShipToName = String(invoiceData?.ShipToName || '').trim();
  const ocrBillToName = String(invoiceData?.BillToName || '').trim();
  let resolvedCustomerCode = '';

  // 1. Try ShipToName → customer name match, scoped to this supplier
  const supplierId = String(supplier.id || '');
  if (!resolvedCustomerCode && ocrShipToName) {
    const looked = await resolveCorCustomerCodeByName(ctx.serviceClient, ocrShipToName, supplierId);
    if (looked) resolvedCustomerCode = looked;
  }

  // 2. Try BillToName → customer name match
  if (!resolvedCustomerCode && ocrBillToName) {
    const looked = await resolveCorCustomerCodeByName(ctx.serviceClient, ocrBillToName, supplierId);
    if (looked) resolvedCustomerCode = looked;
  }

  // 3. Final fallback: per-community default, then legacy supplier default
  if (!resolvedCustomerCode) {
    resolvedCustomerCode = String(
      primaryJoin?.cor_customer_code || supplier.cor_customer_code || '',
    );
  }

  if (resolvedCustomerCode) {
    console.log(`[Submit] Resolved customer code: "${resolvedCustomerCode}" for ShipTo="${ocrShipToName}" BillTo="${ocrBillToName}"`);
  } else {
    console.warn(`[Submit] No customer code resolved for ShipTo="${ocrShipToName}" BillTo="${ocrBillToName}"`);
  }

  // ── 5. Map OCR data → Corcentric request ──
  const corConfig: SupplierCorcentricConfig = {
    corVendorCode: String(supplier.cor_vendor_code),
    corCustomerCode: resolvedCustomerCode,
    corCommunityCode: String(supplier.cor_community_code),
    defaultTransactionType: String(supplier.cor_transaction_type || 'P') as SupplierCorcentricConfig['defaultTransactionType'],
    defaultCurrencyCode: String(supplier.cor_currency_code || 'USD') as SupplierCorcentricConfig['defaultCurrencyCode'],
    corRemitCode: (supplier.cor_remit_code as string) || undefined,
    defaultFreightCode: (supplier.cor_freight_code as string) || undefined,
  };

  // Resolve mapping config: prefer cor_mapping_config, fall back to legacy columns
  const mappingConfig: CorMappingConfig = resolveMappingConfig(
    (supplier.cor_mapping_config as Partial<CorMappingConfig>) || buildConfigFromLegacy(supplier)
  );

  // Use REAL credentials when we have them — dry runs that ping
  // Corcentric need them to validate auth. Falls back to placeholder
  // values only when this is a no-creds dry-run (XML-preview mode).
  const corRequest = mapInvoiceToCorRequest(
    data.invoice_data as Record<string, unknown>,
    {
      username: hasCreds ? apiUser! : 'DRY_RUN_USER',
      password: hasCreds ? apiPass! : 'DRY_RUN_PASS',
      supplierConfig: corConfig,
      mappingConfig,
      requestId: `S${id.split('-')[0]}-${Date.now().toString(36)}`.slice(0, 30),
    },
  );

  // ── 5b. Attach PDF as base64 image ──
  // Fetch the original invoice PDF from R2 and encode as base64 for corBaseImage
  const r2Key = data.r2_object_key as string | null;
  if (r2Key) {
    try {
      const pdfObject = await ctx.env.INVOICE_PDFS.get(r2Key);
      if (pdfObject) {
        const pdfBytes = await pdfObject.arrayBuffer();
        // Convert ArrayBuffer to base64
        const uint8 = new Uint8Array(pdfBytes);
        let binary = '';
        for (let i = 0; i < uint8.length; i++) {
          binary += String.fromCharCode(uint8[i]);
        }
        corRequest.corRequest.corBaseImage = btoa(binary);
        console.log(`[Corcentric Submit] Attached PDF base64 image (${Math.round(pdfBytes.byteLength / 1024)} KB) for invoice ${id}`);
      } else {
        console.warn(`[Corcentric Submit] PDF not found in R2 at key "${r2Key}" — submitting without corBaseImage`);
      }
    } catch (pdfErr) {
      console.warn(`[Corcentric Submit] Failed to fetch PDF for base64 encoding:`, pdfErr);
      // Non-fatal — continue without the image
    }
  }

  // ── 6. Validate ──
  const validation = validateCorRequest(corRequest);
  if (!validation.valid) {
    return jsonResponse({
      submitted: false,
      invoice_id: id,
      validation,
      message: 'Invoice data failed Corcentric validation — fix the errors before submitting.',
    }, 422);
  }

  // ── 6. Serialize to XML ──
  const xml = serializeCorRequest(corRequest, true);

  // ── 7. Determine attempt number + caller identity ──
  const attemptCount = await countSubmissionAttempts(ctx.serviceClient, id);
  const submittedBy = await extractUserId(ctx);

  // ── 8. Create submission record ──
  const { data: submission, error: insertErr } = await insertSubmission(ctx.serviceClient, {
    invoice_id: id,
    supplier_id: data.supplier_id,
    request_xml: xml,
    status: isDryRun ? 'success' : 'pending',
    attempt_number: attemptCount + 1,
    is_dry_run: isDryRun,
    submitted_by: submittedBy,
  });

  if (insertErr || !submission) {
    console.error('[Corcentric Submit] Failed to create submission record:', insertErr);
    return errorResponse('Failed to create submission record', 500);
  }

  // ── 9. Dry run ──
  // Two flavors:
  //   • dryRunWithPing  → actually POST to Corcentric to validate
  //                        connectivity + auth + payload acceptance.
  //                        Treat the response purely as a round-trip
  //                        signal — DO NOT update invoices.status to
  //                        'submitted'. The corcentric_submissions row
  //                        carries is_dry_run=true so the Submissions
  //                        admin page can distinguish ping responses
  //                        from real submissions.
  //   • else (no creds) → return XML for review only, no network call.
  if (isDryRun) {
    if (!dryRunWithPing) {
      return jsonResponse({
        submitted: false,
        dry_run: true,
        ping_attempted: false,
        submission_id: submission.id,
        invoice_id: id,
        supplier_name: supplier.name,
        validation,
        xml,
      });
    }

    // Path B: full round-trip ping. Mark the submission row in-flight.
    const pingSubmittedAt = new Date().toISOString();
    await updateSubmission(ctx.serviceClient, submission.id, {
      status: 'submitted',
      submitted_at: pingSubmittedAt,
    });

    const pingResult = await submitToCorcentricApi(xml, { apiUrl: apiUrl! });
    const pingCompletedAt = new Date().toISOString();

    // Network failure (no response from Corcentric)
    if (!pingResult.httpSuccess && !pingResult.response) {
      await updateSubmission(ctx.serviceClient, submission.id, {
        status: 'failed',
        error_message: pingResult.error || `HTTP ${pingResult.httpStatus}`,
        response_xml: pingResult.responseXml || null,
        completed_at: pingCompletedAt,
      });
      return jsonResponse({
        submitted: false,
        dry_run: true,
        ping_attempted: true,
        ping_ok: false,
        submission_id: submission.id,
        invoice_id: id,
        supplier_name: supplier.name,
        validation,
        xml,
        error: pingResult.error || 'Corcentric API request failed',
        response_xml: pingResult.responseXml || null,
        http_status: pingResult.httpStatus,
        duration_ms: pingResult.durationMs,
      });
    }

    // We got a response. Parse it for cor status + messages.
    const pingCorResponse = pingResult.response;
    const pingSubmissionStatus = pingCorResponse
      ? corStatusToSubmissionStatus(pingCorResponse.corResponseStatusCode)
      : 'failed';

    await updateSubmission(ctx.serviceClient, submission.id, {
      status: pingSubmissionStatus,
      response_xml: pingResult.responseXml,
      cor_status_code: pingCorResponse?.corResponseStatusCode ?? null,
      cor_response_id: pingCorResponse?.corResponseID ?? null,
      cor_messages: pingCorResponse?.corResponseMessages ?? [],
      completed_at: pingCompletedAt,
    });

    // Crucially: do NOT touch invoices.status. Dry runs never promote
    // an invoice to 'submitted' — that's reserved for the live Submit
    // path, which the user explicitly clicks once they've confirmed
    // the ping succeeded.
    return jsonResponse({
      submitted: false,
      dry_run: true,
      ping_attempted: true,
      ping_ok:
        pingResult.httpSuccess &&
        (pingSubmissionStatus === 'success' || pingSubmissionStatus === 'warning'),
      submission_id: submission.id,
      invoice_id: id,
      supplier_name: supplier.name,
      validation,
      xml,
      cor_status_code: pingCorResponse?.corResponseStatusCode ?? null,
      cor_messages: pingCorResponse?.corResponseMessages ?? [],
      response_xml: pingResult.responseXml,
      http_status: pingResult.httpStatus,
      duration_ms: pingResult.durationMs,
    });
  }

  // ── 10. Submit to Corcentric ──
  // Capture timestamps locally so they can be returned to the caller AND
  // written to the DB in a single consistent snapshot. The UI renders them
  // on the immediate post-submit panel AND on the invoice's submission
  // history section, so they must be part of the JSON response, not just
  // the DB row.
  const submittedAt = new Date().toISOString();
  await updateSubmission(ctx.serviceClient, submission.id, {
    status: 'submitted',
    submitted_at: submittedAt,
  });

  const result = await submitToCorcentricApi(xml, { apiUrl: apiUrl! });
  const completedAt = new Date().toISOString();

  // ── 11. Process response ──
  if (!result.httpSuccess && !result.response) {
    // Network/timeout failure
    await updateSubmission(ctx.serviceClient, submission.id, {
      status: 'failed',
      error_message: result.error || `HTTP ${result.httpStatus}`,
      response_xml: result.responseXml || null,
      completed_at: completedAt,
    });

    return jsonResponse({
      submitted: true,
      success: false,
      submission_id: submission.id,
      invoice_id: id,
      error: result.error || 'Corcentric API request failed',
      response_xml: result.responseXml || null,
      submitted_at: submittedAt,
      completed_at: completedAt,
      duration_ms: result.durationMs,
      can_retry: attemptCount + 1 < MAX_RETRY_ATTEMPTS,
    }, 502);
  }

  // We got a response from Corcentric — parse it
  const corResponse = result.response;
  const submissionStatus = corResponse
    ? corStatusToSubmissionStatus(corResponse.corResponseStatusCode)
    : 'failed';

  await updateSubmission(ctx.serviceClient, submission.id, {
    status: submissionStatus,
    response_xml: result.responseXml,
    cor_status_code: corResponse?.corResponseStatusCode ?? null,
    cor_response_id: corResponse?.corResponseID ?? null,
    cor_messages: corResponse?.corResponseMessages ?? [],
    completed_at: completedAt,
  });

  const isSuccess = submissionStatus === 'success' || submissionStatus === 'warning';

  // Auto-update invoice status to 'submitted' on successful transmission
  if (isSuccess) {
    await ctx.serviceClient
      .from('invoices')
      .update({ status: 'submitted' })
      .eq('id', id);
    console.log(`[Corcentric Submit] Invoice ${id} status updated to 'submitted'`);
  }

  return jsonResponse({
    submitted: true,
    success: isSuccess,
    submission_id: submission.id,
    invoice_id: id,
    status: submissionStatus,
    cor_status_code: corResponse?.corResponseStatusCode,
    cor_response_id: corResponse?.corResponseID,
    cor_messages: corResponse?.corResponseMessages,
    response_xml: result.responseXml,      // full body for UI rendering
    submitted_at: submittedAt,             // when we POSTed the request
    completed_at: completedAt,             // when Corcentric responded
    validation,
    duration_ms: result.durationMs,
    can_retry: !isSuccess && attemptCount + 1 < MAX_RETRY_ATTEMPTS,
  });
}

/**
 * Retry a failed Corcentric submission for an invoice.
 * POST /api/invoices/:id/corcentric-retry
 */
export async function retryCorcentricSubmission(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid invoice ID', 400);

  // Check last submission status
  const latest = await getLatestSubmission(ctx.serviceClient, id);
  if (!latest) return errorResponse('No previous submission found for this invoice', 404);

  const latestStatus = String(latest.status || '');
  const latestId = String(latest.id || '');

  if (['success', 'warning'].includes(latestStatus)) {
    return errorResponse('This invoice was already successfully submitted to Corcentric', 400);
  }

  const attemptCount = await countSubmissionAttempts(ctx.serviceClient, id);
  if (attemptCount >= MAX_RETRY_ATTEMPTS) {
    return errorResponse(
      `Maximum retry attempts reached (${MAX_RETRY_ATTEMPTS}). Contact support if this invoice needs resubmission.`,
      429,
    );
  }

  // Mark old submission as retry
  await updateSubmission(ctx.serviceClient, latestId, { status: 'retry' });

  // Re-submit by delegating to the main submit handler
  return submitToCorcentricHandler(request, {
    ...ctx,
    // Override path to point to the submit endpoint (for extractPathId)
    path: ctx.path.replace('/corcentric-retry', '/corcentric-submit'),
  });
}

/**
 * List Corcentric submissions with optional filters.
 * GET /api/corcentric-submissions
 *   ?invoice_id=xxx  — filter by invoice
 *   ?status=success  — filter by status
 *   ?limit=20        — pagination
 *   ?offset=0        — pagination
 */
export async function listCorcentricSubmissions(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const invoiceId = ctx.url.searchParams.get('invoice_id') || undefined;
  const status = ctx.url.searchParams.get('status') || undefined;
  const limit = Math.min(parseInt(ctx.url.searchParams.get('limit') || '20', 10) || 20, 100);
  const offset = parseInt(ctx.url.searchParams.get('offset') || '0', 10) || 0;

  const { data, error, count } = await listSubmissions(ctx.serviceClient, {
    invoiceId,
    status,
    limit,
    offset,
  });

  if (error) return errorResponse('Failed to load submissions', 500);

  return jsonResponse({
    submissions: data || [],
    total: count || 0,
    limit,
    offset,
  });
}
