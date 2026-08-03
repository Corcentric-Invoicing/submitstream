// ============================================
// Invoice Handlers — list, get, patch
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { logAccess } from '../middleware/audit';
import { getCachedScope } from '../middleware/auth';
import { validate, patchInvoiceSchema } from '../middleware/validate';
import { safeJsonBody, extractPathId, parsePagination, sanitizeDbError } from '../middleware/safeParse';
import {
  listInvoicesQuery,
  getInvoiceById,
  updateInvoice,
  insertFeedbackEntry,
  getSupplierIdByCode,
  deleteInvoiceById,
} from '../db/queries';
import { replyInvoiceRejected } from '../../email-worker/reply';
import { processInvoicePDF } from '../../ocr-pipeline';
import { postProcessInvoiceData } from '../../ocr-pipeline/post-process';
import { validateFlatInvoice } from '../validation/invoice-validator';
import { validateExtractionTemplate, sanitizeRawResponse } from './upload';

/**
 * List invoices with optional status and supplier filters.
 * Supports pagination via limit and offset query parameters (max 100 per page).
 *
 * @param request - HTTP request object
 * @param ctx - Shared RequestContext with database clients and environment config
 * @returns JSON response with array of invoices and total count
 * @throws 500 if database query fails
 */
export async function listInvoices(request: Request, ctx: RequestContext): Promise<Response> {
  const status = ctx.url.searchParams.get('status');
  let supplierId = ctx.url.searchParams.get('supplier_id');
  const search = ctx.url.searchParams.get('search');
  const ingestionSource = ctx.url.searchParams.get('ingestion_source');
  const flagSeverityRaw = ctx.url.searchParams.get('flag_severity');
  const flagSeverity: 'clean' | 'warnings' | 'errors' | null =
    flagSeverityRaw === 'clean' || flagSeverityRaw === 'warnings' || flagSeverityRaw === 'errors'
      ? flagSeverityRaw
      : null;
  const createdAfter = ctx.url.searchParams.get('created_after');
  const createdBefore = ctx.url.searchParams.get('created_before');
  const { limit, offset } = parsePagination(ctx.url);

  // Resolve caller's data scope — admins see all, team sees assigned suppliers only
  const scope = await getCachedScope(ctx);

  // If on a supplier page (cookie set by Worker), resolve code → ID to scope results.
  // This ensures admins viewing /supplier/bbb only see BBB's invoices.
  if (!supplierId && ctx.supplierContextCode) {
    const resolvedId = await getSupplierIdByCode(ctx.serviceClient, ctx.supplierContextCode);
    if (resolvedId) supplierId = resolvedId;
  }

  const { data, error, count } = await listInvoicesQuery(ctx.serviceClient, {
    status,
    supplierId,
    supplierIds: scope.supplierIds,  // null for admin (no filter), string[] for team
    search,
    ingestionSource,
    flagSeverity,
    createdAfter,
    createdBefore,
    limit,
    offset,
  });
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  // Audit: log list access (fire-and-forget)
  logAccess(ctx.serviceClient, ctx.userClient, request, 'invoice_list', null, {
    filters: { status, supplierId, ingestionSource, flagSeverity, scoped_to: scope.role },
    result_count: count,
  });

  return jsonResponse({ invoices: data, total: count });
}

/**
 * Retrieve a single invoice by ID with its supplier details.
 *
 * @param request - HTTP request object
 * @param ctx - Shared RequestContext with database clients and environment config
 * @returns JSON response with invoice object including nested supplier information
 * @throws 404 if invoice not found
 */
export async function getInvoice(request: Request, ctx: RequestContext): Promise<Response> {
  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid invoice ID', 400);

  const { data, error } = await getInvoiceById(ctx.serviceClient, id);
  if (error || !data) return errorResponse('Invoice not found', 404);

  // Scope check: team members can only view invoices from their assigned suppliers
  const scope = await getCachedScope(ctx);
  if (scope.supplierIds !== null && !scope.supplierIds.includes(data.supplier_id)) {
    return errorResponse('Invoice not found', 404);
  }

  // Audit: log single invoice view (fire-and-forget)
  logAccess(ctx.serviceClient, ctx.userClient, request, 'invoice_view', id);

  return jsonResponse(data);
}

/**
 * Update an invoice's status, feedback, extracted data, or review flag.
 * Setting status to 'rejected' automatically flags for supplier review.
 * All status changes are recorded in the feedback_history table for audit trails.
 *
 * @param request - HTTP request with JSON body containing fields to update
 *                  Allowed fields: status, feedback, needs_supplier_review, invoice_data
 * @param ctx - Shared RequestContext with database clients and environment config
 * @returns JSON response with updated invoice object
 * @throws 400 if JSON is malformed or validation fails
 * @throws 500 if database update fails
 */
export async function patchInvoice(request: Request, ctx: RequestContext): Promise<Response> {
  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid invoice ID', 400);

  // CRITICAL-2 fix: Always verify invoice exists before proceeding
  const { data: existingInvoice, error: existError } = await getInvoiceById(ctx.serviceClient, id);
  if (existError || !existingInvoice) return errorResponse('Invoice not found', 404);

  // Scope check: non-admin users can only edit invoices from their assigned suppliers
  const scope = await getCachedScope(ctx);
  if (scope.supplierIds !== null && !scope.supplierIds.includes(existingInvoice.supplier_id)) {
    return errorResponse('Invoice not found', 404);
  }

  const parsed = await safeJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const validation = validate(body, patchInvoiceSchema);
  if (!validation.ok) return errorResponse(validation.errors.map(e => `${e.field}: ${e.message}`).join('; '), 400);

  const allowedFields = [
    'status', 'feedback', 'needs_supplier_review', 'invoice_data',
    // Customer-from-invoice resolution: the review UI PATCHes these
    // when the reviewer links an existing customer to the invoice
    // (or when create-from-invoice produces a new one).
    'customer_id', 'needs_customer_review', 'customer_match_confidence',
    'ship_to_id',
  ];
  const updateData: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updateData[field] = body[field];
    }
  }

  // Rejections automatically flag for supplier review
  if (updateData.status === 'rejected') {
    updateData.needs_supplier_review = true;
    updateData.feedback_date = new Date().toISOString();
  }

  const { data, error } = await updateInvoice(ctx.serviceClient, id, updateData);
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  // Log status changes to feedback_history for audit trail
  if (updateData.status) {
    await insertFeedbackEntry(
      ctx.serviceClient,
      id,
      updateData.status as string,
      (updateData.feedback as string) || null,
    );
  }

  // Audit: log invoice update with changed fields (fire-and-forget)
  logAccess(ctx.serviceClient, ctx.userClient, request, 'invoice_update', id, {
    fields_changed: Object.keys(updateData),
    new_status: updateData.status || null,
  });

  // Send rejection notification to the original sender
  if (updateData.status === 'rejected' && ctx.env.RESEND_API_KEY) {
    const sourceEmail = (data as Record<string, unknown>).source_email as string | undefined;
    const invoiceData = (data as Record<string, unknown>).invoice_data as Record<string, unknown> | undefined;
    const invoiceNumber = String(
      invoiceData?.invoice_number || invoiceData?.invoiceNumber || (data as Record<string, unknown>).file_name || 'Unknown',
    );

    // Reuse existingInvoice from the existence check (avoids redundant DB query)
    const supplierInfo = existingInvoice.supplier as Record<string, unknown> | undefined;
    const supplierName = String(supplierInfo?.name || 'Supplier');

    if (sourceEmail) {
      replyInvoiceRejected(ctx.env.RESEND_API_KEY, sourceEmail, {
        invoiceNumber,
        supplierName,
        feedback: (updateData.feedback as string) || undefined,
      }).catch(err => console.warn('[API] Rejection notification failed:', err));
    }
  }

  return jsonResponse(data);
}

/**
 * Delete an invoice. Hard-delete the row (cascades to corcentric_submissions,
 * feedback_history, processing_log) AND fire-and-forget delete the PDF from R2.
 *
 * Business rule: cannot delete invoices that have been submitted to Corcentric
 * DMS (status='submitted'). Submitted invoices are permanent for audit / record-
 * of-truth reasons — if they need to be marked dead, change the status to
 * 'deleted' via PATCH instead (soft delete).
 *
 * Authorization:
 *   - Admin: any invoice (RLS grants full access)
 *   - Team:   invoices for their assigned suppliers (team_supplier_assignments)
 *   - Supplier: invoices for their own supplier_id
 *
 * Returns 204 on success, 404 if not found / outside caller's scope,
 * 400 if the invoice is in a non-deletable state.
 */
export async function deleteInvoice(request: Request, ctx: RequestContext): Promise<Response> {
  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid invoice ID', 400);

  // Verify the invoice exists (and grab status + r2 key for downstream work)
  const { data: existingInvoice, error: existError } = await getInvoiceById(ctx.serviceClient, id);
  if (existError || !existingInvoice) return errorResponse('Invoice not found', 404);

  // Scope check: non-admin users can only delete invoices from their assigned suppliers
  const scope = await getCachedScope(ctx);
  if (scope.supplierIds !== null && !scope.supplierIds.includes(existingInvoice.supplier_id)) {
    // Mirror the "not found" response to avoid leaking that the invoice exists
    return errorResponse('Invoice not found', 404);
  }

  // Business rule: submitted invoices are immutable for audit
  if (existingInvoice.status === 'submitted') {
    return errorResponse(
      'Cannot delete invoices that have been submitted to Corcentric DMS. ' +
      'Submitted invoices are permanent for audit purposes.',
      400,
    );
  }

  // Hard-delete the row
  const { error } = await deleteInvoiceById(ctx.serviceClient, id);
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  // Fire-and-forget: drop the PDF from R2 too (orphan otherwise)
  const r2Key = (existingInvoice as Record<string, unknown>).r2_object_key as string | undefined;
  if (r2Key) {
    ctx.env.INVOICE_PDFS.delete(r2Key).catch(err =>
      console.warn('[API] R2 delete failed for', r2Key, ':', err)
    );
  }

  // Audit (fire-and-forget). Uses 'invoice_update' enum since the
  // access_audit_log.action CHECK constraint doesn't include 'invoice_delete';
  // metadata carries the explicit deletion marker.
  logAccess(ctx.serviceClient, ctx.userClient, request, 'invoice_update', id, {
    action: 'deleted',
    file_name: (existingInvoice as Record<string, unknown>).file_name,
    supplier_id: existingInvoice.supplier_id,
    status_at_deletion: existingInvoice.status,
  });

  return new Response(null, { status: 204 });
}

const MAX_RETRY_ATTEMPTS = 5;

/**
 * Re-run OCR on an existing invoice's stored PDF. Used when the original
 * extraction failed (Mistral 5xx + Claude error, image-only PDF, etc.) and
 * the user wants to recover without having to delete + re-upload.
 *
 * Authorization mirrors deleteInvoice:
 *   - Admin: any invoice
 *   - Team:   invoices for their assigned suppliers
 *   - Supplier: invoices for their own supplier_id
 *
 * Business rules:
 *   - 400 if invoice has status='submitted' (immutable for audit; resubmit
 *     would need a fresh upload as a new row)
 *   - 400 if the invoice has no r2_object_key (nothing to re-OCR)
 *   - 429 if invoice has already been retried MAX_RETRY_ATTEMPTS times
 *     (count from processing_log entries with event='retry_ocr')
 *
 * Side effects on success:
 *   - Updates invoices row with fresh invoice_data, status, confidence,
 *     ocr_raw_response, validation_findings
 *   - Writes a processing_log entry (event='retry_ocr') with attempt number
 *   - Writes an access_audit_log entry
 */
export async function retryOcrInvoice(request: Request, ctx: RequestContext): Promise<Response> {
  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid invoice ID', 400);

  // Verify invoice exists + grab r2 key, status, supplier_id
  const { data: existingInvoice, error: existError } = await getInvoiceById(ctx.serviceClient, id);
  if (existError || !existingInvoice) return errorResponse('Invoice not found', 404);

  // Scope check — same pattern as deleteInvoice
  const scope = await getCachedScope(ctx);
  if (scope.supplierIds !== null && !scope.supplierIds.includes(existingInvoice.supplier_id)) {
    return errorResponse('Invoice not found', 404);
  }

  // Submitted invoices are immutable
  if (existingInvoice.status === 'submitted') {
    return errorResponse(
      'Cannot re-run OCR on invoices that have been submitted to Corcentric DMS. ' +
      'Submitted invoices are permanent for audit purposes.',
      400,
    );
  }

  const r2Key = (existingInvoice as Record<string, unknown>).r2_object_key as string | undefined;
  if (!r2Key) {
    return errorResponse(
      'No PDF available to re-OCR. This invoice came from a non-PDF source (e.g. PromoStandards) and has no stored file.',
      400,
    );
  }

  // Rate-limit retries by counting processing_log entries
  const { count: retryCount } = await ctx.serviceClient
    .from('processing_log')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', id)
    .eq('event', 'retry_ocr');
  const attemptsSoFar = retryCount ?? 0;
  if (attemptsSoFar >= MAX_RETRY_ATTEMPTS) {
    return errorResponse(
      `This invoice has already been retried ${attemptsSoFar} times (max ${MAX_RETRY_ATTEMPTS}). ` +
      `If OCR still isn't working, the PDF likely isn't extractable — consider manual entry.`,
      429,
    );
  }

  // ── Fetch the original PDF bytes from R2 ──
  const pdfObject = await ctx.env.INVOICE_PDFS.get(r2Key);
  if (!pdfObject) {
    return errorResponse(
      `PDF not found in storage at "${r2Key}". The original upload may have been deleted from R2.`,
      404,
    );
  }
  const pdfBytes = await pdfObject.arrayBuffer();

  // ── Look up supplier config (extraction_template + test_mode + post-process inputs) ──
  let extractionTemplate: string | undefined;
  const supplierId = existingInvoice.supplier_id as string | null;
  let supplierForPostProcess: { code: string; vendor_code_override?: string; remit_to_code?: string } | null = null;
  if (supplierId) {
    const { data: supplierData } = await ctx.serviceClient
      .from('suppliers')
      .select('code, vendor_code_override, remit_to_code, extraction_template')
      .eq('id', supplierId)
      .single();
    if (supplierData) {
      try {
        extractionTemplate = validateExtractionTemplate(supplierData.extraction_template || undefined);
      } catch (err) {
        return errorResponse(err instanceof Error ? err.message : 'Invalid extraction template', 400);
      }
      supplierForPostProcess = {
        code: supplierData.code,
        vendor_code_override: supplierData.vendor_code_override || undefined,
        remit_to_code: supplierData.remit_to_code || undefined,
      };
    }
  }

  // ── Run OCR pipeline (same code path as upload) ──
  const ocrResult = await processInvoicePDF(
    pdfBytes,
    {
      MISTRAL_API_KEY: ctx.env.MISTRAL_API_KEY,
      ANTHROPIC_API_KEY: ctx.env.ANTHROPIC_API_KEY,
    },
    { extractionTemplate },
  );

  // ── Apply per-supplier post-processing rules ──
  let invoiceData = ocrResult.data;
  if (supplierForPostProcess && ocrResult.success) {
    invoiceData = await postProcessInvoiceData(
      ocrResult.data as Record<string, unknown>,
      { supplier: supplierForPostProcess },
    );
  }

  // ── Validate against Corcentric DMS mandatory-field list ──
  const validationFindings = validateFlatInvoice(invoiceData as Record<string, unknown>);
  const hasErrors = validationFindings.some((f) => f.severity === 'error');

  // ── Persist results ──
  await ctx.serviceClient
    .from('invoices')
    .update({
      status: hasErrors ? 'pending' : ocrResult.status,
      confidence: ocrResult.confidence,
      ocr_provider: ocrResult.provider,
      invoice_data: invoiceData,
      ocr_raw_response: sanitizeRawResponse(ocrResult.rawResponses as Record<string, unknown>),
      validation_findings: validationFindings.length ? validationFindings : null,
    })
    .eq('id', id);

  // ── Log the retry attempt for audit + future rate-limit checks ──
  await ctx.serviceClient.from('processing_log').insert({
    invoice_id: id,
    event: 'retry_ocr',
    provider: ocrResult.provider,
    confidence_score: ocrResult.confidenceScore,
    processing_time_ms: ocrResult.processingTimeMs,
    metadata: {
      attempt_number: attemptsSoFar + 1,
      max_attempts: MAX_RETRY_ATTEMPTS,
      ocr_success: ocrResult.success,
      issues: ocrResult.issues,
      validation_finding_count: validationFindings.length,
    },
  });

  // ── Audit log ──
  logAccess(ctx.serviceClient, ctx.userClient, request, 'invoice_update', id, {
    action: 'retry_ocr',
    attempt_number: attemptsSoFar + 1,
    new_status: hasErrors ? 'pending' : ocrResult.status,
    provider: ocrResult.provider,
  });

  // ── Return the refreshed invoice so the portal can re-render ──
  const { data: refreshed } = await getInvoiceById(ctx.serviceClient, id);
  return jsonResponse({
    invoice: refreshed,
    ocr: {
      success: ocrResult.success,
      provider: ocrResult.provider,
      confidence: ocrResult.confidence,
      confidence_score: ocrResult.confidenceScore,
      issues: ocrResult.issues,
    },
    validation: {
      finding_count: validationFindings.length,
      has_errors: hasErrors,
    },
    attempt_number: attemptsSoFar + 1,
    attempts_remaining: MAX_RETRY_ATTEMPTS - (attemptsSoFar + 1),
  });
}
