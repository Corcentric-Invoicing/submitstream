// ============================================
// Customer Management Handlers
//
// Customers are 1:1 with a supplier. Suppliers
// manage their own bill-to/ship-to data.
// Admins can manage all customers.
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { extractPathId } from '../middleware/safeParse';
import { getCachedScope, CallerScope } from '../middleware/auth';
import {
  listCustomers,
  getCustomerById,
  insertCustomer,
  updateCustomer,
  listCustomerSupplierCodes,
  insertCustomerSupplierCode,
  deleteCustomerSupplierCode,
  listCustomerShipTos,
  insertCustomerShipTo,
  updateCustomerShipTo,
  deleteCustomerShipTo,
  getSupplierIdByCode,
} from '../db/queries';

/**
 * Resolve caller scope and return it. Rejects unauthenticated callers.
 */
async function getScope(ctx: RequestContext): Promise<CallerScope | null> {
  const scope = await getCachedScope(ctx);
  if (!scope.userId) return null;
  return scope;
}

/**
 * Check if a caller can access a customer record.
 * Admins can access any. Suppliers can only access their own (supplier_id match).
 */
function canAccessCustomer(scope: CallerScope, customer: Record<string, unknown>): boolean {
  if (scope.role === 'admin') return true;
  if (!scope.supplierIds || scope.supplierIds.length === 0) return false;
  return scope.supplierIds.includes(String(customer.supplier_id || ''));
}

/**
 * GET /api/customers — list customers (scoped to caller's supplier for supplier-role users)
 */
export async function listCustomersHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  if (scope.role === 'admin') {
    // Admins see all, or filter by supplier_id / supplier context cookie
    let filterSupplierId = new URL(request.url).searchParams.get('supplier_id');

    // If on a supplier page (cookie set by Worker), resolve code → ID to scope results
    if (!filterSupplierId && ctx.supplierContextCode) {
      const resolvedId = await getSupplierIdByCode(ctx.serviceClient, ctx.supplierContextCode);
      if (resolvedId) filterSupplierId = resolvedId;
    }

    if (filterSupplierId) {
      const { data, error } = await ctx.serviceClient
        .from('customers')
        .select('*')
        .eq('supplier_id', filterSupplierId)
        .eq('active', true)
        .order('name');
      if (error) return errorResponse('Failed to load customers', 500);
      return jsonResponse({ success: true, data: data || [] });
    }
    const { data, error } = await listCustomers(ctx.serviceClient);
    if (error) return errorResponse('Failed to load customers', 500);
    return jsonResponse({ success: true, data: data || [] });
  }

  // Suppliers see only their own
  const supplierId = scope.supplierIds?.[0];
  if (!supplierId) return jsonResponse({ success: true, data: [] });

  const { data, error } = await ctx.serviceClient
    .from('customers')
    .select('*')
    .eq('supplier_id', supplierId)
    .eq('active', true)
    .order('name');

  if (error) return errorResponse('Failed to load customers', 500);
  return jsonResponse({ success: true, data: data || [] });
}

/**
 * GET /api/customers/:id — get a single customer with ship-to locations
 */
export async function getCustomerHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid customer ID', 400);

  const { data: customer, error } = await getCustomerById(ctx.serviceClient, id);
  if (error || !customer) return errorResponse('Customer not found', 404);

  // Check access
  if (!canAccessCustomer(scope, customer as Record<string, unknown>)) {
    return errorResponse('Customer not found', 404);
  }

  // Load supplier code mappings and ship-to locations
  const [codesResult, shipTosResult] = await Promise.all([
    listCustomerSupplierCodes(ctx.serviceClient, id),
    listCustomerShipTos(ctx.serviceClient, id),
  ]);

  return jsonResponse({ success: true, data: {
    ...customer,
    supplier_codes: codesResult.data || [],
    ship_tos: shipTosResult.data || [],
  }});
}

/**
 * POST /api/customers — create a new customer
 * Suppliers auto-set supplier_id to their own supplier.
 */
export async function createCustomerHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  const body = await request.json() as Record<string, unknown>;

  const allowed = [
    'name', 'code', 'cor_customer_code',
    'bill_to_name', 'bill_to_address1', 'bill_to_address2',
    'bill_to_city', 'bill_to_state', 'bill_to_zip',
    'ship_to_name', 'ship_to_address1', 'ship_to_address2',
    'ship_to_city', 'ship_to_state', 'ship_to_zip',
    'contact_email', 'contact_phone',
    'notes',
  ];

  const payload: Record<string, unknown> = {};
  for (const key of allowed) {
    if (body[key] !== undefined) payload[key] = body[key];
  }

  if (!payload.name) {
    return errorResponse('Customer name is required', 400);
  }

  // Auto-generate code from name if not provided
  if (!payload.code) {
    payload.code = String(payload.name).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) + '-' + Date.now().toString(36);
  }

  // Set supplier_id
  if (scope.role === 'supplier') {
    const supplierId = scope.supplierIds?.[0];
    if (!supplierId) return errorResponse('No supplier assigned to your account', 403);
    payload.supplier_id = supplierId;
  } else if (body.supplier_id) {
    // Admin can specify supplier_id
    payload.supplier_id = body.supplier_id;
  }

  const { data, error } = await insertCustomer(ctx.serviceClient, payload);
  if (error) {
    if (String(error.message || '').includes('duplicate')) {
      return errorResponse('A customer with that code already exists', 409);
    }
    return errorResponse('Failed to create customer: ' + (error.message || ''), 500);
  }

  return jsonResponse(data, 201);
}

/**
 * PATCH /api/customers/:id — update a customer
 */
export async function patchCustomerHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid customer ID', 400);

  // Verify ownership
  const { data: existing } = await getCustomerById(ctx.serviceClient, id);
  if (!existing || !canAccessCustomer(scope, existing as Record<string, unknown>)) {
    return errorResponse('Customer not found', 404);
  }

  const body = await request.json() as Record<string, unknown>;

  const allowed = [
    'name', 'code', 'cor_customer_code', 'active',
    'bill_to_name', 'bill_to_address1', 'bill_to_address2',
    'bill_to_city', 'bill_to_state', 'bill_to_zip',
    'ship_to_name', 'ship_to_address1', 'ship_to_address2',
    'ship_to_city', 'ship_to_state', 'ship_to_zip',
    'contact_email', 'contact_phone',
    'notes',
  ];

  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) payload[key] = body[key];
  }

  const { data, error } = await updateCustomer(ctx.serviceClient, id, payload);
  if (error) return errorResponse('Failed to update customer: ' + (error.message || ''), 500);

  return jsonResponse(data);
}

/**
 * GET /api/customers/:id/codes — list supplier code mappings for a customer.
 *
 * Authorization: caller must be authenticated AND canAccessCustomer for
 * the parent customer. Service-role client bypasses RLS, so without this
 * check any authenticated user could read every supplier's per-customer
 * code mappings — including from competing tenants.
 */
export async function listCustomerCodesHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  const id = ctx.path.match(/\/api\/customers\/([\w-]+)\/codes/)?.[1];
  if (!id) return errorResponse('Invalid customer ID', 400);

  // Parent-customer ownership gate.
  const { data: customer } = await getCustomerById(ctx.serviceClient, id);
  if (!customer || !canAccessCustomer(scope, customer as Record<string, unknown>)) {
    return errorResponse('Customer not found', 404);
  }

  const { data, error } = await listCustomerSupplierCodes(ctx.serviceClient, id);
  if (error) return errorResponse('Failed to load supplier codes', 500);

  return jsonResponse(data || []);
}

/**
 * POST /api/customers/:id/codes — add a supplier code mapping.
 *
 * Authorization:
 *   - admin: allowed for any (customer, supplier) pair.
 *   - supplier: must own the parent customer AND can only add a mapping
 *     for one of their own supplier_ids — even if they hand-craft a body
 *     with a different supplier_id, we overwrite it with their own. This
 *     prevents cross-tenant injection of customer-code mappings.
 */
export async function addCustomerCodeHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  const customerId = ctx.path.match(/\/api\/customers\/([\w-]+)\/codes/)?.[1];
  if (!customerId) return errorResponse('Invalid customer ID', 400);

  // Parent-customer ownership gate.
  const { data: customer } = await getCustomerById(ctx.serviceClient, customerId);
  if (!customer || !canAccessCustomer(scope, customer as Record<string, unknown>)) {
    return errorResponse('Customer not found', 404);
  }

  const body = await request.json() as Record<string, unknown>;
  if (!body.supplier_code) {
    return errorResponse('supplier_code is required', 400);
  }

  // Force the supplier_id for non-admin callers. Admins may target any
  // supplier explicitly; suppliers always write to their own.
  let supplierId: string;
  if (scope.role === 'admin') {
    if (!body.supplier_id) return errorResponse('supplier_id is required', 400);
    supplierId = String(body.supplier_id);
  } else {
    const own = scope.supplierIds?.[0];
    if (!own) return errorResponse('Caller has no supplier scope', 403);
    supplierId = own;
  }

  const { data, error } = await insertCustomerSupplierCode(ctx.serviceClient, {
    customer_id: customerId,
    supplier_id: supplierId,
    supplier_code: String(body.supplier_code),
    description: body.description ? String(body.description) : undefined,
  });

  if (error) {
    if (String(error.message || '').includes('duplicate') || String(error.message || '').includes('unique')) {
      return errorResponse('This supplier already has that code mapped', 409);
    }
    return errorResponse('Failed to add code mapping: ' + (error.message || ''), 500);
  }

  return jsonResponse(data, 201);
}

/**
 * DELETE /api/customers/:customerId/codes/:codeId — remove a supplier code mapping.
 *
 * Authorization: load the existing mapping, walk up to its parent customer,
 * confirm the caller can access that customer. Without this, any
 * authenticated user could delete any other supplier's code mapping
 * by guessing the row id (UUID lookup brute-force is impractical, but
 * the check is still required for SOC 2 access-control conformance).
 */
export async function removeCustomerCodeHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  const match = ctx.path.match(/\/api\/customers\/[\w-]+\/codes\/([\w-]+)/);
  if (!match) return errorResponse('Invalid code mapping ID', 400);

  // Look up the existing mapping so we can resolve its parent customer
  // and check scope before deleting.
  const { data: existing } = await ctx.serviceClient
    .from('customer_supplier_codes')
    .select('customer_id, supplier_id')
    .eq('id', match[1])
    .maybeSingle();
  if (!existing) return errorResponse('Code mapping not found', 404);

  const existingRow = existing as { customer_id: string; supplier_id: string };
  const { data: customer } = await getCustomerById(ctx.serviceClient, existingRow.customer_id);
  if (!customer || !canAccessCustomer(scope, customer as Record<string, unknown>)) {
    return errorResponse('Code mapping not found', 404);
  }
  // Belt-and-suspenders for supplier callers: also confirm the mapping's
  // supplier_id matches what they're scoped to. canAccessCustomer above
  // checks parent-customer ownership; this catches the corner case where
  // a customer has multiple supplier mappings and a supplier shouldn't
  // be able to delete another supplier's mapping on a shared customer.
  if (
    scope.role !== 'admin' &&
    !scope.supplierIds?.includes(existingRow.supplier_id)
  ) {
    return errorResponse('Code mapping not found', 404);
  }

  const { error } = await deleteCustomerSupplierCode(ctx.serviceClient, match[1]);
  if (error) return errorResponse('Failed to remove code mapping', 500);

  return jsonResponse({ success: true });
}

// ── Ship-To Location Endpoints ──

/**
 * GET /api/customers/:id/ship-tos — list ship-to locations for a customer
 */
export async function listShipTosHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  const id = ctx.path.match(/\/api\/customers\/([\w-]+)\/ship-tos/)?.[1];
  if (!id) return errorResponse('Invalid customer ID', 400);

  // Verify ownership
  const { data: customer } = await getCustomerById(ctx.serviceClient, id);
  if (!customer || !canAccessCustomer(scope, customer as Record<string, unknown>)) {
    return errorResponse('Customer not found', 404);
  }

  const { data, error } = await listCustomerShipTos(ctx.serviceClient, id);
  if (error) return errorResponse('Failed to load ship-to locations', 500);

  return jsonResponse(data || []);
}

/**
 * POST /api/customers/:id/ship-tos — add a ship-to location
 */
export async function addShipToHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  const customerId = ctx.path.match(/\/api\/customers\/([\w-]+)\/ship-tos/)?.[1];
  if (!customerId) return errorResponse('Invalid customer ID', 400);

  // Verify ownership
  const { data: customer } = await getCustomerById(ctx.serviceClient, customerId);
  if (!customer || !canAccessCustomer(scope, customer as Record<string, unknown>)) {
    return errorResponse('Customer not found', 404);
  }

  const body = await request.json() as Record<string, unknown>;

  // Auto-generate code if not provided
  const code = body.code ? String(body.code) : ('ST-' + Date.now().toString(36).toUpperCase());

  const { data, error } = await insertCustomerShipTo(ctx.serviceClient, {
    customer_id: customerId,
    code,
    name: body.name ? String(body.name) : undefined,
    address1: body.address1 ? String(body.address1) : undefined,
    address2: body.address2 ? String(body.address2) : undefined,
    city: body.city ? String(body.city) : undefined,
    state: body.state ? String(body.state) : undefined,
    zip: body.zip ? String(body.zip) : undefined,
  });

  if (error) {
    if (String(error.message || '').includes('duplicate') || String(error.message || '').includes('unique')) {
      return errorResponse('This customer already has a ship-to with that code', 409);
    }
    return errorResponse('Failed to add ship-to: ' + (error.message || ''), 500);
  }

  return jsonResponse(data, 201);
}

/**
 * PATCH /api/customers/:customerId/ship-tos/:shipToId — update a ship-to location
 */
export async function patchShipToHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  const match = ctx.path.match(/\/api\/customers\/([\w-]+)\/ship-tos\/([\w-]+)/);
  if (!match) return errorResponse('Invalid ship-to ID', 400);

  // Verify ownership of parent customer
  const { data: customer } = await getCustomerById(ctx.serviceClient, match[1]);
  if (!customer || !canAccessCustomer(scope, customer as Record<string, unknown>)) {
    return errorResponse('Customer not found', 404);
  }

  const body = await request.json() as Record<string, unknown>;
  const allowed = ['code', 'name', 'address1', 'address2', 'city', 'state', 'zip', 'notes', 'active'];
  const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of allowed) {
    if (body[key] !== undefined) payload[key] = body[key];
  }

  const { data, error } = await updateCustomerShipTo(ctx.serviceClient, match[2], payload);
  if (error) return errorResponse('Failed to update ship-to: ' + (error.message || ''), 500);

  return jsonResponse(data);
}

/**
 * DELETE /api/customers/:customerId/ship-tos/:shipToId — soft-delete a ship-to
 */
export async function removeShipToHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const scope = await getScope(ctx);
  if (!scope) return errorResponse('Unauthorized', 401);

  const match = ctx.path.match(/\/api\/customers\/([\w-]+)\/ship-tos\/([\w-]+)/);
  if (!match) return errorResponse('Invalid ship-to ID', 400);

  // Verify ownership of parent customer
  const { data: customer } = await getCustomerById(ctx.serviceClient, match[1]);
  if (!customer || !canAccessCustomer(scope, customer as Record<string, unknown>)) {
    return errorResponse('Customer not found', 404);
  }

  const { error } = await deleteCustomerShipTo(ctx.serviceClient, match[2]);
  if (error) return errorResponse('Failed to remove ship-to', 500);

  return jsonResponse({ success: true });
}
