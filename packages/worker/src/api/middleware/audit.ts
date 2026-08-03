// ============================================
// Audit Logging
// Non-blocking access trail for SOC 2 compliance.
// Uses service client (bypasses RLS) so logs can't
// be tampered with by the requesting user.
// ============================================

import { SupabaseClient } from '@supabase/supabase-js';

export type AuditAction =
  | 'invoice_view'
  | 'invoice_list'
  | 'pdf_download'
  | 'csv_export'
  | 'invoice_update';

export interface AuditEntry {
  user_id: string | null;
  action: AuditAction;
  resource_type: 'invoice';
  resource_id: string | null;
  ip_address: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Extract the caller's real IP address from the request headers.
 * Checks Cloudflare's CF-Connecting-IP first, then X-Real-IP, then X-Forwarded-For.
 * Cloudflare Workers expose the real client IP via CF-Connecting-IP header.
 *
 * @param request - HTTP request object with headers
 * @returns Resolved client IP address, or null if not found in headers
 */
export function getClientIP(request: Request): string | null {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('X-Real-IP') ||
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
    null
  );
}

/**
 * Resolve the current user's ID from their JWT token.
 * Returns null if the token is missing or invalid; audit entries with null user_id
 * are still written so anonymous/unauthenticated access attempts are logged.
 *
 * @param userClient - Supabase client authenticated with user's JWT
 * @returns User ID from JWT claims, or null if not authenticated or token is invalid
 */
async function resolveUserId(userClient: SupabaseClient): Promise<string | null> {
  try {
    const { data: { user } } = await userClient.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Write an audit log entry for SOC 2 compliance and access tracking.
 * Fire-and-forget function — handlers should NOT await this in the hot path.
 * Instead, pass the returned promise to Cloudflare's ctx.waitUntil() or let it settle asynchronously.
 * Uses service client (not RLS-filtered) to ensure logs cannot be tampered with by the requesting user.
 * All failures are logged to console but never surfaced to the end user.
 *
 * @param serviceClient - Supabase service-level client (bypasses RLS) for secure audit writes
 * @param userClient - Supabase client authenticated with user's JWT (for resolving user ID)
 * @param request - HTTP request object (for extracting client IP)
 * @param action - Type of action being logged (e.g., 'invoice_view', 'pdf_download')
 * @param resourceId - ID of the resource being accessed, or null for list actions
 * @param metadata - Optional additional context (filters applied, counts, changed fields, etc.)
 * @returns Promise that resolves when log entry is written; safe to ignore in handlers
 */
export async function logAccess(
  serviceClient: SupabaseClient,
  userClient: SupabaseClient,
  request: Request,
  action: AuditAction,
  resourceId: string | null,
  metadata?: Record<string, unknown>,
): Promise<void> {
  try {
    const userId = await resolveUserId(userClient);
    const entry: AuditEntry = {
      user_id: userId,
      action,
      resource_type: 'invoice',
      resource_id: resourceId,
      ip_address: getClientIP(request),
      metadata,
    };

    const { error } = await serviceClient
      .from('access_audit_log')
      .insert(entry);

    if (error) {
      console.error('[Audit] Failed to write log entry:', error.message);
    }
  } catch (err) {
    // Never let audit failures propagate — the request must still succeed
    console.error('[Audit] Unexpected error:', err);
  }
}
