// ============================================
// Response helpers
// Standard JSON + error responses with headers
// ============================================

let _headers: Record<string, string> = {};

/**
 * Store CORS and security headers for use by response helper functions.
 * Called once at the start of each request before calling jsonResponse or errorResponse.
 *
 * NOTE: This global approach has a theoretical race condition under high concurrency
 * in Workers isolates. Prefer passing headers explicitly via the `headers` parameter
 * on jsonResponse/errorResponse, or use ctx.headers directly for custom responses.
 *
 * @param headers - Record of HTTP response headers (CORS + security headers)
 */
export function setResponseHeaders(headers: Record<string, string>): void {
  _headers = headers;
}

/**
 * Build a JSON response with CORS and security headers.
 * Serializes data to JSON and sets application/json Content-Type.
 *
 * @param data - Any serializable JavaScript value to respond with
 * @param status - HTTP status code (default 200)
 * @param headers - Optional explicit headers (falls back to global _headers if not provided)
 * @returns Response object with JSON body and headers
 */
export function jsonResponse(data: unknown, status = 200, headers?: Record<string, string>): Response {
  const h = headers || _headers;
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...h, 'Content-Type': 'application/json' },
  });
}

/**
 * Build an error response with a standardized JSON format.
 * Wraps the error message in { error: message } and delegates to jsonResponse for headers.
 *
 * @param message - Human-readable error description
 * @param status - HTTP status code (default 400 for client errors)
 * @param headers - Optional explicit headers (falls back to global _headers if not provided)
 * @returns Response object with error message wrapped in JSON and appropriate status code
 */
export function errorResponse(message: string, status = 400, headers?: Record<string, string>): Response {
  return jsonResponse({ error: message }, status, headers);
}
