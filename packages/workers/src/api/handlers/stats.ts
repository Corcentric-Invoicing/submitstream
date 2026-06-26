// ============================================
// Stats, Usage & Health Handlers
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { getCachedScope } from '../middleware/auth';
import {
  countInvoicesByStatus,
  countInvoicesSince,
  getSettingByKey,
} from '../db/queries';

/**
 * Retrieve dashboard summary statistics for invoice processing status.
 * Stats are scoped to the caller's role:
 * - Admin: sees counts for all invoices across all suppliers
 * - Team: sees counts only for invoices from their assigned suppliers
 *
 * @param request - HTTP request object
 * @param ctx - Shared RequestContext with database clients
 * @returns JSON response with status counts
 */
export async function getStats(request: Request, ctx: RequestContext): Promise<Response> {
  // Resolve caller scope — admins see all, team sees assigned suppliers only
  const scope = await getCachedScope(ctx);

  const [processed, pending, rejected, total] = await Promise.all([
    countInvoicesByStatus(ctx.serviceClient, 'processed', scope.supplierIds),
    countInvoicesByStatus(ctx.serviceClient, 'pending', scope.supplierIds),
    countInvoicesByStatus(ctx.serviceClient, 'rejected', scope.supplierIds),
    countInvoicesByStatus(ctx.serviceClient, undefined, scope.supplierIds),
  ]);

  return jsonResponse({
    processed: processed.count || 0,
    pending: pending.count || 0,
    rejected: rejected.count || 0,
    total: total.count || 0,
  });
}

/**
 * Get today's upload usage vs the daily limit (for progress bar in admin dashboard).
 * Uses service client to read global stats; not RLS-filtered so admins see complete usage data.
 *
 * @param request - HTTP request object
 * @param ctx - Shared RequestContext with serviceClient (bypasses RLS)
 * @returns JSON response with usage stats
 */
export async function getUsage(request: Request, ctx: RequestContext): Promise<Response> {
  const today = new Date().toISOString().split('T')[0];

  const [usageResult, limitResult] = await Promise.all([
    countInvoicesSince(ctx.serviceClient, `${today}T00:00:00Z`),
    getSettingByKey(ctx.serviceClient, 'daily_upload_limit'),
  ]);

  const limit = limitResult.data?.value ?? 25;
  const count = usageResult.count || 0;

  return jsonResponse({
    today_count: count,
    daily_limit: limit,
    remaining: Math.max(0, limit - count),
  });
}

/**
 * Simple health check / liveness probe endpoint.
 * No authentication required; indicates whether the API worker is running.
 *
 * @returns JSON response with status='ok' and current timestamp
 */
export async function healthCheck(): Promise<Response> {
  return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
}
