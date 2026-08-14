// ============================================
// Supplier Handlers — list, create, update, delete
// ============================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { requireAdmin } from '../middleware/auth';
import {
  validate,
  createSupplierSchema,
  createSupplierRequiredFields,
  validatePatchSupplier,
  PATCH_SUPPLIER_ALLOWED_FIELDS,
} from '../middleware/validate';
import { safeJsonBody, extractPathId, sanitizeDbError } from '../middleware/safeParse';
import {
  listSuppliersQuery,
  insertSupplier,
  updateSupplier,
  deleteSupplierRecord,
  deleteAllAssignmentsForSupplier,
  listSupplierUsers,
  setUserSupplier,
  resolveCorcentricCredentials,
  encryptCredential,
} from '../db/queries';

/**
 * RSK-01: intercept plaintext credential fields on inbound PATCH bodies,
 * encrypt them via write_credential RPC, and rewrite the payload so the
 * DB update targets the *_enc bytea columns. Plaintext columns no longer
 * exist post-drop-migration; writing to them would 400.
 */
const CREDENTIAL_FIELD_MAP: Record<string, string> = {
  cor_username: 'cor_username_enc',
  cor_password: 'cor_password_enc',
  ps_auth_id: 'ps_auth_id_enc',
  ps_auth_password: 'ps_auth_password_enc',
};

async function rewriteCredentialFields(
  client: SupabaseClient,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    const encKey = CREDENTIAL_FIELD_MAP[k];
    if (encKey) {
      out[encKey] = v === null || v === '' ? null : await encryptCredential(client, String(v));
    } else {
      out[k] = v;
    }
  }
  return out;
}


/**
 * List all suppliers visible to the current user (filtered by RLS policies).
 *
 * @param request - HTTP request object
 * @param ctx - Shared RequestContext with RLS-enabled userClient
 * @returns JSON response with array of supplier objects, ordered by name
 * @throws 500 if database query fails
 */
export async function listSuppliers(request: Request, ctx: RequestContext): Promise<Response> {
  const { data, error } = await listSuppliersQuery(ctx.userClient);
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);
  return jsonResponse({ success: true, data });
}

/**
 * Create a new supplier with email prefix and optional contact details.
 *
 * @param request - HTTP request with JSON body
 * @param ctx - Shared RequestContext with userClient (RLS-filtered)
 * @returns JSON response with created supplier object and 201 status code
 * @throws 400 if JSON malformed or validation fails
 * @throws 500 if database insert fails
 */
export async function createSupplier(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const parsed = await safeJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const validation = validate(body, createSupplierSchema, createSupplierRequiredFields);
  if (!validation.ok) return errorResponse(validation.errors.map(e => `${e.field}: ${e.message}`).join('; '), 400);

  const emailPrefix = (body.email_prefix as string || '').toLowerCase();

  const { data, error } = await insertSupplier(ctx.userClient, {
    name: body.name,
    code: body.code,
    email_prefix: emailPrefix,
    contact_email: body.contact_email || `${emailPrefix}@submitstream.com`,
    contact_name: body.contact_name || null,
    test_mode: body.test_mode !== undefined ? body.test_mode : true,
  });

  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);
  return jsonResponse({ success: true, data }, 201);
}

/**
 * Update supplier configuration including test mode, contact details, and OCR extraction template.
 *
 * @param request - HTTP request with JSON body containing fields to update
 * @param ctx - Shared RequestContext with userClient (RLS-filtered)
 * @returns JSON response with updated supplier object
 * @throws 400 if JSON malformed, validation fails, or no valid fields provided
 * @throws 500 if database update fails
 */
export async function patchSupplier(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const supplierId = extractPathId(ctx.path);
  if (!supplierId) return errorResponse('Invalid supplier ID', 400);

  const parsed = await safeJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const validation = validatePatchSupplier(body);
  if (!validation.ok) return errorResponse(validation.errors.map(e => `${e.field}: ${e.message}`).join('; '), 400);

  // Field allowlist derived from patchSupplierSchema — single source of
  // truth via PATCH_SUPPLIER_ALLOWED_FIELDS in validate.ts. Adding a new
  // supplier column now only needs updating the schema; both the validator
  // and this handler pick it up automatically.
  const updateData: Record<string, unknown> = {};
  for (const field of PATCH_SUPPLIER_ALLOWED_FIELDS) {
    if (body[field as string] !== undefined) {
      updateData[field as string] = body[field as string];
    }
  }

  // RSK-01: rewrite plaintext credential fields (cor_username, cor_password,
  // ps_auth_id, ps_auth_password) into encrypted-at-rest *_enc bytea via
  // write_credential RPC before the DB update. The plaintext columns no
  // longer exist on the row post-drop-migration.
  const encryptedUpdateData = await rewriteCredentialFields(ctx.serviceClient, updateData);

  const { data, error } = await updateSupplier(ctx.userClient, supplierId, encryptedUpdateData);
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);
  return jsonResponse({ success: true, data });
}

/**
 * Deactivate a supplier (admin-only). Sets active=false.
 * POST /api/suppliers/:id/deactivate
 */
export async function deactivateSupplier(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const supplierId = extractPathId(ctx.path);
  if (!supplierId) return errorResponse('Invalid supplier ID', 400);

  const { data, error } = await updateSupplier(ctx.serviceClient, supplierId, { active: false });
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  return jsonResponse({ success: true, message: 'Supplier deactivated', data });
}

/**
 * Reactivate a supplier (admin-only). Sets active=true.
 * POST /api/suppliers/:id/reactivate
 */
export async function reactivateSupplier(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const supplierId = extractPathId(ctx.path);
  if (!supplierId) return errorResponse('Invalid supplier ID', 400);

  const { data, error } = await updateSupplier(ctx.serviceClient, supplierId, { active: true });
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  return jsonResponse({ success: true, message: 'Supplier reactivated', data });
}

/**
 * Permanently delete a supplier (admin-only).
 * Removes all team assignments, then deletes the supplier record.
 * DELETE /api/suppliers/:id
 */
export async function deleteSupplier(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const supplierId = extractPathId(ctx.path);
  if (!supplierId) return errorResponse('Invalid supplier ID', 400);

  // 1. Remove all team-supplier assignments for this supplier
  await deleteAllAssignmentsForSupplier(ctx.serviceClient, supplierId);

  // 2. Delete the supplier record
  const { error } = await deleteSupplierRecord(ctx.serviceClient, supplierId);
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  return jsonResponse({ success: true, message: 'Supplier permanently deleted' });
}

/**
 * List all supplier-role users assigned to a specific supplier.
 * GET /api/suppliers/:id/users
 */
export async function getSupplierUsers(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const supplierId = extractPathId(ctx.path.replace('/users', ''));
  if (!supplierId) return errorResponse('Invalid supplier ID', 400);

  const { data, error } = await listSupplierUsers(ctx.serviceClient, supplierId);
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  // Enrich with email from Supabase Auth
  const { data: { users: authUsers } } = await ctx.serviceClient.auth.admin.listUsers();
  const emailMap: Record<string, string> = {};
  (authUsers || []).forEach((u: { id: string; email?: string }) => {
    if (u.email) emailMap[u.id] = u.email;
  });

  const enriched = (data || [])
    .filter((profile: Record<string, unknown>) => profile && profile.id)
    .map((profile: Record<string, unknown>) => ({
      ...profile,
      email: emailMap[profile.id as string] || '',
    }));

  return jsonResponse({ success: true, data: enriched });
}

/**
 * Unassign a supplier-role user from a supplier (sets supplier_id to null).
 * DELETE /api/suppliers/:id/users
 * Body: { user_id: string }
 */
export async function removeSupplierUser(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const parsed = await safeJsonBody<{ user_id: string }>(request);
  if (!parsed.ok) return parsed.response;

  const userId = parsed.data.user_id;
  if (!userId) return errorResponse('user_id is required', 400);

  const { error } = await setUserSupplier(ctx.serviceClient, userId, null);
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);

  return jsonResponse({ success: true, message: 'User unassigned from supplier' });
}

/**
 * Test a supplier's Corcentric DMS connection (admin-only).
 * Sends a minimal credit check request to verify credentials work.
 * POST /api/suppliers/:id/test-connection
 */
export async function testSupplierConnection(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const supplierId = extractPathId(ctx.path.replace('/test-connection', ''));
  if (!supplierId) return errorResponse('Invalid supplier ID', 400);

  // Load supplier config. RSK-01: fetch encrypted-at-rest credential columns
  // (*_enc bytea) rather than plaintext; decryption happens below via RPC.
  const { data: supplier, error } = await ctx.serviceClient
    .from('suppliers')
    .select('id, name, cor_api_url, cor_username_enc, cor_password_enc, cor_vendor_code, cor_customer_code, cor_community_code, cor_currency_code, community_id, communities (id, code, name, cor_api_url, cor_username_enc, cor_password_enc)')
    .eq('id', supplierId)
    .single();

  if (error || !supplier) return errorResponse('Supplier not found', 404);

  // Resolve credentials: community → supplier (legacy) → global fallback.
  // RSK-01: decrypts *_enc bytea via decrypt_credential RPC (SECURITY DEFINER).
  const communityRec = (supplier as Record<string, unknown>).communities as Record<string, unknown> | null;
  const resolvedCreds = await resolveCorcentricCredentials(ctx.serviceClient, {
    community: communityRec,
    supplier: supplier as unknown as Record<string, unknown>,
    envApiUrl: ctx.env.CORCENTRIC_API_URL,
    envApiUser: ctx.env.CORCENTRIC_USERNAME,
    envApiPass: ctx.env.CORCENTRIC_PASSWORD,
  });
  const apiUrl = resolvedCreds.apiUrl;
  const username = resolvedCreds.apiUser;
  const password = resolvedCreds.apiPass;

  if (!apiUrl || !username || !password) {
    return jsonResponse({
      success: false,
      connected: false,
      error: 'Missing credentials — set cor_username, cor_password, and cor_api_url in community settings (or supplier as fallback).',
    }, 400);
  }

  if (!supplier.cor_vendor_code || !supplier.cor_community_code) {
    return jsonResponse({
      success: false,
      connected: false,
      error: 'Missing Corcentric codes — set cor_vendor_code and cor_community_code.',
    }, 400);
  }

  // ── Build the raw Corcentric XML payload (per DMS spec v2.2) ──
  // The .svc/web endpoint accepts plain XML POST (WCF webHttpBinding)
  const testXml = `<?xml version='1.0' encoding='UTF-8' ?>
<ProcessRequest>
  <UserName>${escXmlAttr(username)}</UserName>
  <Password>${escXmlAttr(password)}</Password>
  <corRequest>
    <corRequestID>T-${Date.now().toString(36)}</corRequestID>
    <corRequestType>C</corRequestType>
    <corVendorCode>${escXmlAttr(supplier.cor_vendor_code)}</corVendorCode>
    <corCustomerCode>${escXmlAttr(supplier.cor_customer_code || 'TEST')}</corCustomerCode>
    <corCommunityCode>${escXmlAttr(supplier.cor_community_code)}</corCommunityCode>
    <corTransactionAmount>0.0100</corTransactionAmount>
    <corAuthorizationAmount>0.0100</corAuthorizationAmount>
    <corCurrencyCode>${escXmlAttr(supplier.cor_currency_code || 'USD')}</corCurrencyCode>
  </corRequest>
</ProcessRequest>`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const startTime = Date.now();

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Accept': 'text/xml',
      },
      body: testXml,
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const responseText = await response.text();

    // Check if we got a valid Corcentric response (any status code means auth worked)
    const hasCorResponse = responseText.includes('corResponse');
    const statusMatch = responseText.match(/<corResponseStatusCode>(\d+)<\/corResponseStatusCode>/);
    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;

    // Auth failure returns status 0 with code 14
    const msgMatch = responseText.match(/<corResponseMessageCode>(\d+)<\/corResponseMessageCode>/);
    const msgCode = msgMatch ? parseInt(msgMatch[1], 10) : null;
    const isAuthFailure = statusCode === 0 && msgCode === 14;

    // Update supplier's last connection status
    await ctx.serviceClient
      .from('suppliers')
      .update({
        cor_last_status: isAuthFailure ? 'error' : hasCorResponse ? 'success' : 'error',
        cor_last_error: isAuthFailure ? 'Authentication failed — check username/password' : null,
      })
      .eq('id', supplierId);

    const duration_ms = Date.now() - startTime;

    if (isAuthFailure) {
      return jsonResponse({
        success: false,
        connected: false,
        error: 'Authentication failed — username or password is incorrect.',
        http_status: response.status,
        duration_ms,
      });
    }

    if (!hasCorResponse) {
      return jsonResponse({
        success: false,
        connected: false,
        error: 'Received response but could not parse Corcentric XML — check API URL.',
        http_status: response.status,
        response_content_type: response.headers.get('content-type') || 'none',
        duration_ms,
        response_preview: responseText.substring(0, 500),
      });
    }

    return jsonResponse({
      success: true,
      connected: true,
      status_code: statusCode,
      message: 'Connection successful — credentials verified.',
      http_status: response.status,
      duration_ms,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    const isTimeout = message.includes('abort');

    return jsonResponse({
      success: false,
      connected: false,
      error: isTimeout ? 'Connection timed out (15s) — check API URL' : `Network error: ${message}`,
    }, 502);
  }
}

/** Escape XML special chars for inline attribute values */
function escXmlAttr(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
