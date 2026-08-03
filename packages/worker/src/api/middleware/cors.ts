// ============================================
// CORS & Security Headers
// Restricts API access to portal domain only
// ============================================

import { APIWorkerEnv } from '../types';

const ALLOWED_ORIGINS = [
  'https://submitstream.com',
  'https://www.submitstream.com',
];
const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:5173'];

/**
 * Resolve the Access-Control-Allow-Origin header based on the request origin.
 * Maintains a whitelist of allowed origins; includes dev origins in non-production environments.
 * Allows custom PORTAL_DOMAIN if configured in environment.
 *
 * @param request - HTTP request with Origin header
 * @param env - Environment config with ENVIRONMENT and optional PORTAL_DOMAIN
 * @returns Allowed origin string if origin is whitelisted, or empty string if denied
 * @example
 * // Production request from allowed origin
 * getCorsOrigin(request, env) // returns 'https://submitstream.com'
 * // Development request from localhost
 * getCorsOrigin(request, env) // returns 'http://localhost:3000' if env.ENVIRONMENT != 'production'
 */
function getCorsOrigin(request: Request, env: APIWorkerEnv): string {
  const origin = request.headers.get('Origin') || '';
  // HIGH-1 fix: Default to production-safe; only allow dev origins if explicitly "development"
  let allowed = [...ALLOWED_ORIGINS];
  if (env.ENVIRONMENT === 'development') {
    allowed = [...allowed, ...DEV_ORIGINS];
  }
  if (env.PORTAL_DOMAIN) allowed.push(`https://${env.PORTAL_DOMAIN}`);
  return allowed.includes(origin) ? origin : '';
}

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

/**
 * Build response headers with CORS permissions and security headers.
 * Includes Origin validation, allowed HTTP methods, allowed request headers, and security hardening.
 *
 * @param request - HTTP request with Origin header to validate
 * @param env - Environment config with ENVIRONMENT and optional PORTAL_DOMAIN
 * @returns Record of HTTP response headers including CORS and security headers
 */
export function buildResponseHeaders(request: Request, env: APIWorkerEnv): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(request, env),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...securityHeaders,
  };
}
