// ============================================
// Shared types for the API worker
// ============================================

import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Environment variables and bindings available to the API worker.
 * Includes R2 bucket, Supabase credentials, API keys, and optional configuration.
 */
export interface APIWorkerEnv {
  /** Cloudflare R2 bucket for storing invoice PDFs */
  INVOICE_PDFS: R2Bucket;
  /** Supabase project URL (e.g., https://xyz.supabase.co) */
  SUPABASE_URL: string;
  /** Supabase service role key (bypasses RLS, use with caution) */
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Supabase anon key (for RLS-filtered user queries) */
  SUPABASE_ANON_KEY: string;
  /** Mistral AI API key for primary OCR processing */
  MISTRAL_API_KEY: string;
  /** Anthropic Claude API key for fallback OCR processing */
  ANTHROPIC_API_KEY: string;
  /** Corcentric DMS Web Service endpoint URL */
  CORCENTRIC_API_URL?: string;
  /** Corcentric DMS API username */
  CORCENTRIC_USERNAME?: string;
  /** Corcentric DMS API password */
  CORCENTRIC_PASSWORD?: string;
  /** Resend API key for sending transactional notification emails */
  RESEND_API_KEY?: string;
  /** Environment name ('production', 'staging', 'development') — affects CORS origin allowlisting */
  ENVIRONMENT?: string;
  /** Optional custom portal domain to allow in CORS (in addition to standard allowed origins) */
  PORTAL_DOMAIN?: string;
}

/**
 * Context object passed to every handler function.
 * Pre-built by the router to avoid duplicating auth logic and header plumbing in each handler.
 * Contains environment, parsed request data, and pre-configured database clients.
 */
export interface RequestContext {
  /** Environment variables and Cloudflare bindings (R2 bucket, API keys, etc.) */
  env: APIWorkerEnv;
  /** Parsed URL object from the request */
  url: URL;
  /** Request pathname (e.g., '/api/invoices/123') */
  path: string;
  /** Authorization header value (e.g., 'Bearer <token>'), or null if not provided */
  authHeader: string | null;
  /** CORS and security headers built by buildResponseHeaders() */
  headers: Record<string, string>;
  /** Supabase client scoped to the authenticated user's JWT (RLS-filtered queries) */
  userClient: SupabaseClient;
  /** Service-level Supabase client with full access (bypasses RLS) */
  serviceClient: SupabaseClient;
  /** Cached caller scope — avoids repeated DB lookups within a single request */
  _cachedScope?: { userId: string | null; role: 'admin' | 'supplier' | null; supplierIds: string[] | null };
  /** Supplier code from __supplier_ctx cookie — set when page is served under /supplier/{code} */
  supplierContextCode?: string;
}
