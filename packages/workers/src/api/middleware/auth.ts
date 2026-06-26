// ============================================
// Authentication & Authorization
// Supabase client factories + admin role check
// ============================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { APIWorkerEnv } from '../types';

/**
 * Create a Supabase client scoped to the requesting user's JWT token.
 * All database queries go through RLS policies — users only see data they are authorized to access.
 * If no Bearer token is provided, creates an anonymous client.
 *
 * @param env - Environment config with Supabase URL and anon key
 * @param authHeader - Authorization header value (e.g., 'Bearer <token>'), or null for anonymous
 * @returns Supabase client configured with user's JWT or anon key
 */
export function getUserClient(env: APIWorkerEnv, authHeader: string | null): SupabaseClient {
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

/**
 * Create a service-level Supabase client that bypasses RLS policies.
 * Use ONLY for server-initiated operations that need to access data across all organizations:
 * rate limit checks, audit logging, admin operations, and system settings reads/writes.
 *
 * @param env - Environment config with Supabase URL and service role key
 * @returns Supabase client configured with service role credentials (unfiltered access)
 */
export function getServiceClient(env: APIWorkerEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Verify that the caller is authenticated and has the 'admin' role.
 * Checks the user_profiles table via service client to determine role.
 * Returns both authorization status and the authenticated user's ID.
 *
 * @param env - Environment config with Supabase credentials
 * @param authHeader - Authorization header value (e.g., 'Bearer <token>'), or null
 * @returns Object with:
 *          - authorized: true if user is authenticated and has role='admin', false otherwise
 *          - userId: authenticated user's ID, or null if not authenticated
 */
export async function requireAdmin(
  env: APIWorkerEnv,
  authHeader: string | null,
): Promise<{ authorized: boolean; userId: string | null }> {
  const userClient = getUserClient(env, authHeader);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { authorized: false, userId: null };

  const serviceClient = getServiceClient(env);
  const { data: profile } = await serviceClient
    .from('user_profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  return {
    authorized: profile?.role === 'admin',
    userId: user.id,
  };
}

/**
 * Resolve the caller's identity, role, and data scope.
 * - Admin users see everything (supplierIds = null means "no filter").
 * - Team users see only invoices from their assigned suppliers.
 * - Unauthenticated callers get an empty scope (no data).
 *
 * This is intentionally a single query batch (user + profile + assignments)
 * to keep latency low on every invoice/stats request.
 */
export interface CallerScope {
  userId: string | null;
  role: 'admin' | 'supplier' | null;
  /** null = no restriction (admin sees all). string[] = filter to these supplier IDs */
  supplierIds: string[] | null;
}

export async function resolveCallerScope(
  env: APIWorkerEnv,
  authHeader: string | null,
): Promise<CallerScope> {
  const userClient = getUserClient(env, authHeader);
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return { userId: null, role: null, supplierIds: [] };

  const serviceClient = getServiceClient(env);

  // Fetch profile (includes role + supplier_id for supplier users)
  const { data: profile } = await serviceClient
    .from('user_profiles')
    .select('role, supplier_id')
    .eq('id', user.id)
    .single();

  const role = (profile?.role as 'admin' | 'supplier') || 'supplier';

  // Admins see everything — no supplier filter
  if (role === 'admin') {
    return { userId: user.id, role: 'admin', supplierIds: null };
  }

  // Supplier users see only their own supplier's data
  if (role === 'supplier') {
    const supplierId = profile?.supplier_id;
    return {
      userId: user.id,
      role: 'supplier',
      supplierIds: supplierId ? [supplierId] : [],
    };
  }

  // Non-admin, non-supplier users: check for supplier assignments (legacy team members)
  const { data: assignments } = await serviceClient
    .from('team_supplier_assignments')
    .select('supplier_id')
    .eq('user_id', user.id);

  const supplierIds = (assignments || []).map(
    (row: { supplier_id: string }) => row.supplier_id,
  );

  return { userId: user.id, role: 'supplier', supplierIds };
}

/**
 * Get caller scope with per-request caching.
 * Avoids redundant DB queries when multiple parts of a handler need scope info.
 * Uses ctx._cachedScope to store the result after the first resolution.
 *
 * @param ctx - RequestContext (uses inline type to avoid circular import with types.ts)
 */
export async function getCachedScope(ctx: { env: APIWorkerEnv; authHeader: string | null; _cachedScope?: CallerScope }): Promise<CallerScope> {
  if (ctx._cachedScope) return ctx._cachedScope;
  ctx._cachedScope = await resolveCallerScope(ctx.env, ctx.authHeader);
  return ctx._cachedScope;
}
