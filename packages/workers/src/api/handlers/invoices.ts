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
} from '../db/queries';
import { replyInvoiceRejected } from '../../email-worker/reply';

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
