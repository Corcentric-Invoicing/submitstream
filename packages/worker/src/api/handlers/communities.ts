// ============================================
// Community Management Handlers
//
// Admin-only CRUD for Corcentric communities.
// Communities represent DMS community codes
// (e.g., IPW, FLAG) assigned to suppliers.
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { extractPathId } from '../middleware/safeParse';
import { requireAdmin } from '../middleware/auth';
import {
  listCommunities,
  getCommunity,
  insertCommunity,
  updateCommunity,
  deleteCommunity,
} from '../db/queries';

// All handlers in this file MUST gate on requireAdmin. Communities hold
// plaintext Corcentric DMS credentials (cor_username, cor_password,
// cor_api_url), so unauthenticated or supplier-role access here would
// leak credentials and let attackers redirect submissions to a hostile
// endpoint. Service-role-client reads bypass RLS, so the check has to
// happen in the handler — RLS lockdown alone does not protect this path.

/**
 * GET /api/communities — list all active communities
 */
export async function listCommunitiesHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const { data, error } = await listCommunities(ctx.serviceClient);
  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ success: true, data: data || [] });
}

/**
 * GET /api/communities/:id — get a single community
 */
export async function getCommunitiesHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Missing community ID', 400);

  const { data, error } = await getCommunity(ctx.serviceClient, id);
  if (error || !data) return errorResponse('Community not found', 404);
  return jsonResponse({ success: true, data });
}

/**
 * POST /api/communities — create a new community
 */
export async function createCommunityHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const body = await request.json() as Record<string, unknown>;
  const code = String(body.code || '').trim().toUpperCase();
  const name = String(body.name || '').trim();

  if (!code) return errorResponse('Community code is required', 400);
  if (!name) return errorResponse('Community name is required', 400);

  // Optional credential fields on create
  const createPayload: { code: string; name: string; cor_api_url?: string; cor_username?: string; cor_password?: string } = { code, name };
  if (body.cor_api_url !== undefined) createPayload.cor_api_url = String(body.cor_api_url).trim();
  if (body.cor_username !== undefined) createPayload.cor_username = String(body.cor_username).trim();
  if (body.cor_password !== undefined) createPayload.cor_password = String(body.cor_password).trim();

  const { data, error } = await insertCommunity(ctx.serviceClient, createPayload);
  if (error) {
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      return errorResponse(`Community code "${code}" already exists`, 409);
    }
    return errorResponse(error.message, 500);
  }
  return jsonResponse({ success: true, data }, 201);
}

/**
 * PATCH /api/communities/:id — update a community
 */
export async function updateCommunityHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Missing community ID', 400);

  const body = await request.json() as Record<string, unknown>;
  const updates: Record<string, unknown> = {};
  if (body.code !== undefined) updates.code = String(body.code).trim().toUpperCase();
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.active !== undefined) updates.active = Boolean(body.active);
  // API credential fields
  if (body.cor_api_url !== undefined) updates.cor_api_url = body.cor_api_url === null ? null : String(body.cor_api_url).trim();
  if (body.cor_username !== undefined) updates.cor_username = body.cor_username === null ? null : String(body.cor_username).trim();
  if (body.cor_password !== undefined) updates.cor_password = body.cor_password === null ? null : String(body.cor_password).trim();

  if (Object.keys(updates).length === 0) {
    return errorResponse('No fields to update', 400);
  }

  const { data, error } = await updateCommunity(ctx.serviceClient, id, updates);
  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ success: true, data });
}

/**
 * DELETE /api/communities/:id — soft-delete a community
 */
export async function deleteCommunityHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Missing community ID', 400);

  const { error } = await deleteCommunity(ctx.serviceClient, id);
  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ success: true });
}
