// ============================================
// Settings Handler — admin-only system config
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { requireAdmin } from '../middleware/auth';
import { validate, patchSettingsSchemaWithValue, patchSettingsRequiredFields } from '../middleware/validate';
import { safeJsonBody, sanitizeDbError } from '../middleware/safeParse';
import { getAllSettings, updateSetting } from '../db/queries';

/**
 * Retrieve all system settings (admin-only endpoint).
 *
 * @param request - HTTP request object
 * @param ctx - Shared RequestContext with environment and auth header
 * @returns JSON response with array of setting objects
 * @throws 403 if caller is not authenticated as admin
 */
export async function getSettings(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const { data: settings } = await getAllSettings(ctx.serviceClient);
  return jsonResponse(settings || []);
}

/**
 * Update a single system setting by its key (admin-only endpoint).
 *
 * @param request - HTTP request with JSON body containing key and value
 * @param ctx - Shared RequestContext with environment and auth header
 * @returns JSON response with updated setting object
 * @throws 403 if caller is not authenticated as admin
 * @throws 400 if JSON malformed or validation fails
 * @throws 500 if database update fails
 */
export async function patchSettings(request: Request, ctx: RequestContext): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const parsed = await safeJsonBody<{ key: string; value: unknown }>(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const validation = validate(body, patchSettingsSchemaWithValue, patchSettingsRequiredFields);
  if (!validation.ok) return errorResponse(validation.errors.map(e => `${e.field}: ${e.message}`).join('; '), 400);

  const { data, error } = await updateSetting(ctx.serviceClient, body.key, body.value);
  if (error) return errorResponse(sanitizeDbError(error.message, 500), 500);
  return jsonResponse(data);
}
