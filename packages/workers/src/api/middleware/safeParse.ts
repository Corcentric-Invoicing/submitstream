// ============================================
// Safe Request Parsing Utilities
// Centralized JSON parsing, path extraction,
// pagination bounds, and error sanitization.
// ============================================

import { errorResponse } from './response';

// ── Safe JSON body parsing ──

type JsonResult<T = Record<string, unknown>> =
  | { ok: true; data: T }
  | { ok: false; response: Response };

/**
 * Safely parse a JSON request body, returning a typed result or a 400 error response.
 * Prevents unhandled exceptions from malformed JSON crashing the Worker.
 */
export async function safeJsonBody<T = Record<string, unknown>>(
  request: Request,
): Promise<JsonResult<T>> {
  try {
    const data = (await request.json()) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, response: errorResponse('Invalid or malformed JSON body', 400) };
  }
}

// ── Path ID extraction ──

/**
 * Extract a resource ID from a URL path by segment index or pattern.
 * Returns null if the segment is missing or doesn't match UUID/slug format.
 *
 * @example extractPathId('/api/invoices/abc-123')        → 'abc-123'
 * @example extractPathId('/api/invoices/abc-123/pdf')    → 'abc-123'  (index 3)
 * @example extractPathId('/api/suppliers/xyz', 3)        → 'xyz'
 */
export function extractPathId(path: string, segmentIndex = 3): string | null {
  const segments = path.split('/').filter(Boolean); // ['api', 'invoices', 'abc-123', ...]
  const id = segments[segmentIndex - 1]; // -1 because filter(Boolean) removes leading empty string
  if (!id || !/^[\w-]+$/.test(id)) return null;
  return id;
}

// ── Pagination bounds ──

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

/**
 * Parse and clamp pagination parameters from URL search params.
 * Prevents unbounded queries (e.g. ?limit=999999999).
 */
export function parsePagination(url: URL): { limit: number; offset: number } {
  let limit = parseInt(url.searchParams.get('limit') || '', 10);
  let offset = parseInt(url.searchParams.get('offset') || '', 10);

  if (isNaN(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  if (isNaN(offset) || offset < 0) offset = DEFAULT_OFFSET;

  return { limit, offset };
}

// ── Error message sanitization ──

/**
 * Sanitize a database/internal error message before sending to the client.
 * Strips Supabase/Postgres details that could reveal schema information.
 *
 * Returns a safe, generic message for 500 errors and passes through
 * 4xx-level messages that are already user-facing.
 */
export function sanitizeDbError(rawMessage: string, statusCode: number): string {
  // 4xx errors are typically our own validation — pass through
  if (statusCode < 500) return rawMessage;

  // Log the real error server-side, return generic to client
  console.error('[DB Error]', rawMessage);

  // Match common Supabase/Postgres patterns and give helpful-but-safe messages
  if (rawMessage.includes('duplicate key')) return 'A record with that identifier already exists';
  if (rawMessage.includes('violates foreign key')) return 'Referenced record not found';
  if (rawMessage.includes('violates check constraint')) return 'Value out of allowed range';
  if (rawMessage.includes('permission denied')) return 'Insufficient permissions';
  if (rawMessage.includes('JWT')) return 'Authentication error';

  return 'An internal error occurred. Please try again or contact support.';
}

// ── Filename sanitization ──

/**
 * Sanitize a filename to prevent path traversal and injection attacks.
 * Strips directory separators, null bytes, and control characters.
 * Truncates to 200 chars max.
 */
export function sanitizeFilename(raw: string): string {
  return raw
    .replace(/[/\\]/g, '_')        // No directory traversal
    .replace(/\.\./g, '_')         // No parent directory tricks
    .replace(/[\x00-\x1f]/g, '')   // No control characters
    .replace(/[<>:"|?*]/g, '_')    // No OS-reserved chars
    .trim()
    .slice(0, 200) || 'unnamed_file';
}
