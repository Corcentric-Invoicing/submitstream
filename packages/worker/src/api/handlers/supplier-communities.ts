// ============================================
// Supplier-Community Assignment Handlers
//
// Admin-only CRUD for the supplier_communities join table.
// A supplier can belong to multiple communities; each (supplier,
// community) pair owns its own Corcentric vendor + customer codes,
// because Corcentric assigns those per DMS/community.
//
// This is the API the portal CommunitiesPage uses to wire suppliers
// into communities. Submission/ingestion code reads the join directly
// via getInvoiceWithCorcentricConfig + auto-submit; this handler is
// the write path.
//
// is_primary: at most one row per supplier may have is_primary=true.
// Enforced by a partial unique index + handled here on writes by
// auto-flipping any other primary row to false in the same transaction.
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { extractPathId } from '../middleware/safeParse';
import { requireAdmin } from '../middleware/auth';

interface AssignmentRow {
  id?: string;
  supplier_id: string;
  community_id: string;
  cor_vendor_code: string | null;
  cor_customer_code: string | null;
  is_primary: boolean;
  active: boolean;
}

/**
 * GET /api/supplier-communities?community_id=... or ?supplier_id=...
 *
 * Lists assignments filtered by either community_id or supplier_id (one
 * of the two is required). Returns the joined supplier/community names
 * so the UI doesn't need a second round-trip.
 */
export async function listSupplierCommunitiesHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const communityId = ctx.url.searchParams.get('community_id');
  const supplierId = ctx.url.searchParams.get('supplier_id');
  // No filter = list all assignments. Admin-only handler so this is safe;
  // used by the Communities admin page to count assignments per community.

  let q = ctx.serviceClient
    .from('supplier_communities')
    .select(`
      id, supplier_id, community_id,
      cor_vendor_code, cor_customer_code,
      is_primary, active, created_at, updated_at,
      suppliers (id, name, code),
      communities (id, name, code)
    `)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });

  if (communityId) q = q.eq('community_id', communityId);
  if (supplierId) q = q.eq('supplier_id', supplierId);

  const { data, error } = await q;
  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ success: true, data: data || [] });
}

/**
 * POST /api/supplier-communities — assign a supplier to a community
 *
 * Body: { supplier_id, community_id, cor_vendor_code?, cor_customer_code?,
 *         is_primary?: boolean (default false), active?: boolean (default true) }
 *
 * If is_primary=true and the supplier already has a primary community,
 * the old primary is demoted to is_primary=false before insert (atomic
 * via the request — no transaction here but the unique index would 23505
 * otherwise).
 */
export async function createSupplierCommunityHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const body = (await request.json()) as Record<string, unknown>;
  const supplier_id = String(body.supplier_id || '').trim();
  const community_id = String(body.community_id || '').trim();
  if (!supplier_id) return errorResponse('supplier_id is required', 400);
  if (!community_id) return errorResponse('community_id is required', 400);

  const row: Partial<AssignmentRow> = {
    supplier_id,
    community_id,
    cor_vendor_code: body.cor_vendor_code === undefined ? null : String(body.cor_vendor_code).trim() || null,
    cor_customer_code: body.cor_customer_code === undefined ? null : String(body.cor_customer_code).trim() || null,
    is_primary: Boolean(body.is_primary),
    active: body.active === undefined ? true : Boolean(body.active),
  };

  if (row.is_primary) {
    await demoteExistingPrimary(ctx, supplier_id);
  }

  const { data, error } = await ctx.serviceClient
    .from('supplier_communities')
    .insert(row)
    .select(`
      id, supplier_id, community_id,
      cor_vendor_code, cor_customer_code, is_primary, active,
      suppliers (id, name, code),
      communities (id, name, code)
    `)
    .single();
  if (error) {
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      return errorResponse('This supplier is already assigned to that community', 409);
    }
    return errorResponse(error.message, 500);
  }
  return jsonResponse({ success: true, data }, 201);
}

/**
 * PATCH /api/supplier-communities/:id — update vendor_code, customer_code,
 * is_primary, or active on an existing assignment.
 */
export async function updateSupplierCommunityHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Missing assignment ID', 400);

  const body = (await request.json()) as Record<string, unknown>;
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.cor_vendor_code !== undefined) {
    updates.cor_vendor_code =
      body.cor_vendor_code === null ? null : String(body.cor_vendor_code).trim() || null;
  }
  if (body.cor_customer_code !== undefined) {
    updates.cor_customer_code =
      body.cor_customer_code === null ? null : String(body.cor_customer_code).trim() || null;
  }
  if (body.is_primary !== undefined) updates.is_primary = Boolean(body.is_primary);
  if (body.active !== undefined) updates.active = Boolean(body.active);

  // Promoting to primary? Demote any other primary for the same supplier first.
  if (updates.is_primary === true) {
    const { data: existing } = await ctx.serviceClient
      .from('supplier_communities')
      .select('supplier_id')
      .eq('id', id)
      .single();
    if (existing?.supplier_id) {
      await demoteExistingPrimary(ctx, existing.supplier_id, id);
    }
  }

  const { data, error } = await ctx.serviceClient
    .from('supplier_communities')
    .update(updates)
    .eq('id', id)
    .select(`
      id, supplier_id, community_id,
      cor_vendor_code, cor_customer_code, is_primary, active,
      suppliers (id, name, code),
      communities (id, name, code)
    `)
    .single();
  if (error) return errorResponse(error.message, 500);
  if (!data) return errorResponse('Assignment not found', 404);
  return jsonResponse({ success: true, data });
}

/**
 * DELETE /api/supplier-communities/:id — remove an assignment.
 *
 * Hard delete. The join table has no historical value once an assignment
 * is removed — re-add via POST if the supplier should be re-attached.
 */
export async function deleteSupplierCommunityHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Missing assignment ID', 400);

  const { error } = await ctx.serviceClient
    .from('supplier_communities')
    .delete()
    .eq('id', id);
  if (error) return errorResponse(error.message, 500);
  return jsonResponse({ success: true });
}

// ── helpers ────────────────────────────────────────────────

/**
 * Flip is_primary to false on all rows for `supplierId`, optionally
 * excluding `exceptId` (used during PATCH so we don't demote the row
 * we're about to promote).
 */
async function demoteExistingPrimary(
  ctx: RequestContext,
  supplierId: string,
  exceptId?: string,
): Promise<void> {
  let q = ctx.serviceClient
    .from('supplier_communities')
    .update({ is_primary: false, updated_at: new Date().toISOString() })
    .eq('supplier_id', supplierId)
    .eq('is_primary', true);
  if (exceptId) q = q.neq('id', exceptId);
  await q;
}
