// ============================================
// Upload Handler — PDF upload + OCR processing
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { sanitizeFilename, sanitizeDbError } from '../middleware/safeParse';
import { processInvoicePDF } from '../../ocr-pipeline';
import { postProcessInvoiceData } from '../../ocr-pipeline/post-process';
import { isAutoSubmitEligible, autoSubmitToCorentric } from '../corcentric/auto-submit';
import { getCachedScope } from '../middleware/auth';
import { validateFlatInvoice } from '../validation/invoice-validator';

/** Maximum allowed length (in characters) for supplier-specific OCR extraction templates. */
const MAX_TEMPLATE_LENGTH = 2000;

/**
 * Validate an OCR extraction template against length constraints.
 * Throws an error if template exceeds maximum allowed length.
 *
 * @param template - Optional extraction template string to validate
 * @returns The validated template, or undefined if no template provided
 * @throws Error if template length exceeds MAX_TEMPLATE_LENGTH
 */
export function validateExtractionTemplate(template: string | undefined): string | undefined {
  if (!template) return undefined;
  if (template.length > MAX_TEMPLATE_LENGTH) {
    throw new Error(`Extraction template exceeds maximum length (${MAX_TEMPLATE_LENGTH} chars)`);
  }
  return template;
}

/**
 * Sanitize raw OCR responses before storing in the database.
 * Keeps only the metadata we need for debugging — strips full API payloads.
 */
export function sanitizeRawResponse(raw: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  const sanitized: Record<string, unknown> = {};
  if (raw.mistral) {
    const m = raw.mistral as Record<string, unknown>;
    sanitized.mistral = {
      model: m.model || 'unknown',
      pages_processed: Array.isArray(m.pages) ? m.pages.length : 0,
      timestamp: new Date().toISOString(),
    };
  }
  if (raw.pixtral) {
    const p = raw.pixtral as Record<string, unknown>;
    // Pixtral comes through /v1/chat/completions which returns { model, usage, choices, ... }
    sanitized.pixtral = {
      model: p.model || 'pixtral-large-latest',
      role: 'fallback-1',
      usage: p.usage,
      timestamp: new Date().toISOString(),
    };
  }
  if (raw.claude) {
    const c = raw.claude as Record<string, unknown>;
    sanitized.claude = {
      model: c.model || 'unknown',
      role: 'fallback-2',
      timestamp: new Date().toISOString(),
    };
  }
  return sanitized;
}

/**
 * Handle PDF file upload and initiate OCR processing pipeline.
 * Stores PDF in R2, creates invoice record, runs OCR pipeline (Mistral + fallback to Claude),
 * and persists extracted data. Enforces daily upload rate limit per system settings.
 *
 * @param request - HTTP request with multipart form data containing 'file' and optional 'supplier_id'
 * @param ctx - Shared RequestContext with R2 bucket, database clients, and API keys
 * @returns JSON response with invoice ID, OCR status, confidence score, provider used, and any issues
 *          Example: { invoice_id, status: 'processing'|'processed'|'failed', confidence, provider, issues }
 * @throws 400 if file is missing, extraction template invalid, or invoice_data not ready
 * @throws 429 if daily upload limit has been reached
 * @throws 500 if database write, R2 storage, or OCR pipeline fails
 */
export async function uploadInvoice(request: Request, ctx: RequestContext): Promise<Response> {
  // ── Authorization gate ──
  // Pre-fix this endpoint had no auth at all: an anonymous caller could
  // POST a PDF, attach it to any supplier_id, burn OCR budget, and
  // pollute R2. (CRIT-2 in the 2026-05-04 security audit.)
  //
  // Rules:
  //   • caller must be authenticated (have a resolved userId)
  //   • if a supplier_id is supplied AND the caller is a supplier-role
  //     user, that supplier_id must be in the caller's own supplierIds
  //   • admin/team callers may upload for any supplier (or unscoped)
  //   • a missing supplier_id is treated as "admin/team triage upload"
  //     and is denied for supplier-role users
  const scope = await getCachedScope(ctx);
  if (!scope.userId) return errorResponse('Unauthorized', 401);

  const formData = await request.formData();
  const file = formData.get('file') as File;
  const supplierId = formData.get('supplier_id') as string | null;

  if (!file) return errorResponse('Missing file');

  // Supplier-role authorization on the requested target.
  if (scope.role === 'supplier') {
    if (!supplierId) {
      return errorResponse('supplier_id is required for supplier-role uploads', 400);
    }
    if (!scope.supplierIds || !scope.supplierIds.includes(supplierId)) {
      return errorResponse('Forbidden: supplier_id is outside your scope', 403);
    }
  }

  // ── HIGH-5 fix: Validate file size (50 MB max) ──
  const MAX_FILE_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_FILE_SIZE) {
    return errorResponse(`File exceeds maximum size of ${MAX_FILE_SIZE / (1024 * 1024)}MB`, 413);
  }

  // ── Validate file type (PDF only) ──
  const allowedTypes = ['application/pdf'];
  if (file.type && !allowedTypes.includes(file.type)) {
    return errorResponse('Only PDF files are accepted', 400);
  }
  // Also check file extension as a fallback (some clients don't send MIME type)
  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return errorResponse('Only PDF files are accepted (.pdf extension required)', 400);
  }

  // ── Sanitize filename ──
  const safeFileName = sanitizeFilename(file.name);

  // ── Rate limit check ──
  const today = new Date().toISOString().split('T')[0];
  const { count: todayCount } = await ctx.serviceClient
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', `${today}T00:00:00Z`);

  const { data: limitSetting } = await ctx.serviceClient
    .from('system_settings')
    .select('value')
    .eq('key', 'daily_upload_limit')
    .single();

  const dailyLimit = limitSetting?.value ?? 25;
  if ((todayCount || 0) >= dailyLimit) {
    return errorResponse(
      `Daily upload limit reached (${dailyLimit}). Contact your admin to increase the limit.`,
      429,
    );
  }

  // ── Store PDF in R2 ──
  const pdfBytes = await file.arrayBuffer();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const r2Key = `invoices/upload/${timestamp}_${safeFileName}`;

  await ctx.env.INVOICE_PDFS.put(r2Key, pdfBytes, {
    customMetadata: {
      source: 'upload',
      original_filename: safeFileName,
      uploaded_at: new Date().toISOString(),
    },
  });

  // ── Supplier details (test mode + extraction template) ──
  let supplierTestMode = false;
  let extractionTemplate: string | undefined;
  if (supplierId) {
    const { data: supplierData } = await ctx.serviceClient
      .from('suppliers')
      .select('extraction_template, test_mode')
      .eq('id', supplierId)
      .single();

    try {
      extractionTemplate = validateExtractionTemplate(supplierData?.extraction_template || undefined);
    } catch (err) {
      return errorResponse(err instanceof Error ? err.message : 'Invalid extraction template', 400);
    }
    supplierTestMode = supplierData?.test_mode === true;
  }

  // ── Create invoice record ──
  const { data: invoice, error: insertError } = await ctx.serviceClient
    .from('invoices')
    .insert({
      ...(supplierId ? { supplier_id: supplierId } : {}),
      file_name: safeFileName,
      r2_object_key: r2Key,
      status: 'processing',
      source: 'upload',
      invoice_data: {},
      is_test: supplierTestMode,
    })
    .select()
    .single();

  if (insertError) return errorResponse(sanitizeDbError(insertError.message, 500), 500);

  // ── Run OCR pipeline ──
  const ocrResult = await processInvoicePDF(pdfBytes, {
    MISTRAL_API_KEY: ctx.env.MISTRAL_API_KEY,
    ANTHROPIC_API_KEY: ctx.env.ANTHROPIC_API_KEY,
  }, {
    extractionTemplate,
  });

  // ── Apply post-processing rules (if supplier is set and OCR succeeded) ──
  let invoiceData = ocrResult.data;
  if (supplierId && ocrResult.success) {
    const { data: supplier } = await ctx.serviceClient
      .from('suppliers')
      .select('code, vendor_code_override, remit_to_code')
      .eq('id', supplierId)
      .single();

    if (supplier) {
      const enrichedData = await postProcessInvoiceData(
        ocrResult.data as Record<string, unknown>,
        {
          supplier: {
            code: supplier.code,
            vendor_code_override: supplier.vendor_code_override || undefined,
            remit_to_code: supplier.remit_to_code || undefined,
          },
        }
      );
      invoiceData = enrichedData;

      // Log applied post-processing rules if any
      if (Array.isArray(enrichedData._postProcessRules) && enrichedData._postProcessRules.length > 0) {
        console.log(`[Upload] Post-processing applied ${enrichedData._postProcessRules.length} rules for invoice ${invoice.id}`);
      }
    }
  }

  // ── Validate the extracted invoice data ──
  // validateFlatInvoice works on the actual stored shape (flat top-level
  // keys: BillToName, ShipToCity, LineItems[]) and mirrors the portal's
  // Corcentric DMS mandatory-field list. Findings get persisted so the
  // queue can render warning chips and submission is blocked on errors.
  const validationFindings = validateFlatInvoice(invoiceData as Record<string, unknown>);
  const hasErrors = validationFindings.some((f) => f.severity === 'error');

  // ── Persist results (with sanitized raw response) ──
  await ctx.serviceClient
    .from('invoices')
    .update({
      // If the validator found error-severity issues, force the invoice into
      // 'pending' (needs human review) regardless of what OCR thought —
      // submission is blocked until the errors get resolved.
      status: hasErrors ? 'pending' : ocrResult.status,
      confidence: ocrResult.confidence,
      ocr_provider: ocrResult.provider,
      invoice_data: invoiceData,
      ocr_raw_response: sanitizeRawResponse(ocrResult.rawResponses as Record<string, unknown>),
      validation_findings: validationFindings.length ? validationFindings : null,
    })
    .eq('id', invoice.id);

  // ── Auto-submit to Corcentric (fire-and-forget) ──
  // Gated on: OCR succeeded + reached 'processed' state + NO error-severity
  // validation findings. Validator-flagged invoices stay in the review queue.
  let corcentricAutoSubmit = false;
  if (
    ocrResult.success &&
    ocrResult.status === 'processed' &&
    !hasErrors &&
    supplierId
  ) {
    // Check if supplier has auto-submit enabled and all codes configured.
    // Pulls supplier_communities so auto-submit can resolve per-community
    // vendor/customer codes from the join table (post-refactor). Legacy
    // single-value columns remain as fallback during the transition.
    const { data: supplierFull } = await ctx.serviceClient
      .from('suppliers')
      .select(`
        id, name, code,
        cor_vendor_code, cor_customer_code, cor_community_code,
        cor_transaction_type, cor_currency_code,
        cor_field_mapping, cor_mapping_config, cor_ingestion_enabled,
        cor_api_url, cor_username, cor_password,
        community_id, communities (id, code, name, cor_api_url, cor_username, cor_password),
        supplier_communities (
          community_id,
          cor_vendor_code,
          cor_customer_code,
          is_primary,
          active,
          communities (id, code, name, cor_api_url, cor_username, cor_password)
        )
      `)
      .eq('id', supplierId)
      .single();

    const apiUrl = ctx.env.CORCENTRIC_API_URL;
    const apiUser = ctx.env.CORCENTRIC_USERNAME;
    const apiPass = ctx.env.CORCENTRIC_PASSWORD;

    // CRITICAL-5 fix: Only admins can trigger auto-submit (prevents privilege escalation)
    const scope = await getCachedScope(ctx);
    if (supplierFull && isAutoSubmitEligible(supplierFull) && apiUrl && apiUser && apiPass && scope.role === 'admin') {
      corcentricAutoSubmit = true;
      // Fire-and-forget — don't block the upload response
      // Note: In Workers, use ctx.waitUntil() if available, otherwise just fire
      autoSubmitToCorentric(
        {
          invoiceId: invoice.id,
          supplierId,
          invoiceData: ocrResult.data,
          supplier: supplierFull,
          r2ObjectKey: r2Key,
        },
        {
          serviceClient: ctx.serviceClient,
          r2Bucket: ctx.env.INVOICE_PDFS,
          apiUrl,
          apiUser,
          apiPass,
        },
      ).catch(err => console.error('[Upload] Auto-submit background error:', err));
    }
  }

  return jsonResponse({
    invoice_id: invoice.id,
    status: ocrResult.status,
    confidence: ocrResult.confidence,
    provider: ocrResult.provider,
    issues: ocrResult.issues,
    corcentric_auto_submit: corcentricAutoSubmit,
  });
}
