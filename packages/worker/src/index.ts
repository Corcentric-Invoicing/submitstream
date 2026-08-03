// ============================================
// Combined Worker Entry Point
// Handles HTTP fetch (API + Portal), and
// email messages (Cloudflare Email Routing)
// ============================================

import apiWorker from './api/index';
import emailWorker from './email-worker/index';
import { createClient } from '@supabase/supabase-js';
import { pullAllDueSuppliers } from './api/promostandards/puller';
// ── Inject scripts retired ────────────────────────────────────
// All 8 inject scripts (team-admin, dms, terms, portal-rebrand,
// promostandards-admin, customer-resolution, layout-splitter, polish)
// were ported into the corcentric-invoicing React source as proper
// components in Waves 5b–6b. The compiled bundle now ships those
// features natively, so the Worker no longer overlays them at runtime.
// The original .txt files are kept in this folder for git history but
// are no longer imported or served. Safe to delete after one release.
//
// @ts-ignore — text module import (set-password page served inline)
import SET_PASSWORD_HTML from './set-password.html.txt';
// @ts-ignore — text module import (forgot-password page served inline)
import FORGOT_PASSWORD_HTML from './forgot-password.html.txt';
// @ts-ignore — text module import (reset-password page served inline)
import RESET_PASSWORD_HTML from './reset-password.html.txt';
// @ts-ignore — text module import (accept-invite OTP page served inline)
import ACCEPT_INVITE_HTML from './accept-invite.html.txt';

// Inline assets served directly from the Worker bundle.
// Currently empty — all inject scripts retired (see comment above).
// Keeping the map declaration so the asset-lookup branch downstream
// doesn't need conditional handling.
const INLINE_ASSETS: Record<string, { content: string; contentType: string }> = {};

export interface CombinedEnv {
  INVOICE_PDFS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  MISTRAL_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  ENVIRONMENT?: string;
  PORTAL_DOMAIN?: string;
}

/**
 * Scheduled-trigger handler. Invoked by Cloudflare on the cron
 * expression declared in wrangler.toml (every 6 hours). Sweeps every
 * PromoStandards-enabled supplier whose poll interval has elapsed.
 *
 * Guards: uses the service-role Supabase client so RLS doesn't hide
 * suppliers from the cron context. Handler swallows its own errors
 * and logs — a single failing supplier must not stop the sweep.
 */
async function handleScheduled(env: CombinedEnv): Promise<void> {
  const startedAt = Date.now();
  const serviceClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  try {
    const summary = await pullAllDueSuppliers(serviceClient);
    const okCount = summary.results.filter(r => r.ok).length;
    const totalInvoices = summary.results.reduce((n, r) => n + r.invoicesStored, 0);
    console.log(
      `[scheduled:promostandards] attempted=${summary.attempted} ok=${okCount} stored=${totalInvoices} duration=${Date.now() - startedAt}ms`,
    );
    for (const r of summary.results) {
      if (!r.ok) console.warn(`[scheduled:promostandards] supplier=${r.supplierId} failed: ${r.error}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[scheduled:promostandards] sweep crashed: ${msg}`);
  }
}

// MIME type mapping for static files
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};

function getMimeType(path: string): string {
  const ext = path.substring(path.lastIndexOf('.'));
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * Serve the SPA HTML straight from R2 — no inline-script injection,
 * no cookie-based supplier scoping.
 *
 * Historical note: this used to inject a 36-line `window.fetch`
 * monkey-patch (`SUPABASE_SCOPE_INLINE`) that read a `__supplier_ctx`
 * cookie and force-appended `supplier_id=eq.<uuid>` to every Supabase
 * REST call on `/supplier/{code}` pages. That whole pattern is now dead
 * weight: the React app uses `useAppState` + `?supplier=` URL params
 * for scope, the `/supplier/*` route is a backward-compat redirect to
 * `/invoices`, and supplier-level RLS enforces the actual visibility
 * rules at the database. Any monkey-patch on `window.fetch` is
 * untrusted defense-in-depth at best — and dangerous tech debt at
 * worst, since future code expecting an unmodified fetch would hit
 * a quietly-rewritten URL.
 */
async function serveHtmlFromR2(env: CombinedEnv, r2Key: string): Promise<Response | null> {
  const object = await env.INVOICE_PDFS.get(r2Key);
  if (!object) return null;
  const html = await object.text();
  const headers = new Headers();
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', 'no-cache');
  return new Response(html, { headers });
}

/**
 * Serve the set-password page with Supabase credentials injected at runtime.
 * This page handles invite email redirects where users set their own password.
 */
function serveSetPasswordPage(env: CombinedEnv): Response {
  const html = SET_PASSWORD_HTML
    .replace('%%SUPABASE_URL%%', env.SUPABASE_URL)
    .replace('%%SUPABASE_ANON_KEY%%', env.SUPABASE_ANON_KEY);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * Serve the forgot-password page with Supabase credentials injected.
 * Allows users to request a password reset email.
 */
function serveForgotPasswordPage(env: CombinedEnv): Response {
  const html = FORGOT_PASSWORD_HTML
    .replace('%%SUPABASE_URL%%', env.SUPABASE_URL)
    .replace('%%SUPABASE_ANON_KEY%%', env.SUPABASE_ANON_KEY);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * Serve the reset-password page with Supabase credentials injected.
 * Handles the redirect from the password reset email link.
 */
function serveResetPasswordPage(env: CombinedEnv): Response {
  const html = RESET_PASSWORD_HTML
    .replace('%%SUPABASE_URL%%', env.SUPABASE_URL)
    .replace('%%SUPABASE_ANON_KEY%%', env.SUPABASE_ANON_KEY);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

/**
 * Serve the accept-invite page (OTP-based invite acceptance).
 * User enters email + 6-digit code from the invite email + a new password.
 * Codes work on Outlook / corporate email where link-based invites break
 * because Microsoft ATP pre-fetches links and burns the single-use token.
 */
function serveAcceptInvitePage(env: CombinedEnv): Response {
  const html = ACCEPT_INVITE_HTML
    .replace('%%SUPABASE_URL%%', env.SUPABASE_URL)
    .replace('%%SUPABASE_ANON_KEY%%', env.SUPABASE_ANON_KEY);

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    },
  });
}

async function handleStaticAsset(request: Request, env: CombinedEnv): Promise<Response> {
  const url = new URL(request.url);
  let path = url.pathname;

  // Serve the set-password page (handles Supabase invite redirects)
  if (path === '/set-password') {
    return serveSetPasswordPage(env);
  }

  // Serve the forgot-password page
  if (path === '/forgot-password') {
    return serveForgotPasswordPage(env);
  }

  // Serve the reset-password page (handles recovery email redirects)
  if (path === '/reset-password') {
    return serveResetPasswordPage(env);
  }

  // Serve the accept-invite page (OTP-based invite acceptance)
  if (path === '/accept-invite') {
    return serveAcceptInvitePage(env);
  }

  // Strip cache-busting query params for inline asset matching
  const cleanPath = path.split('?')[0];

  // Check inline assets first (served from Worker bundle, no R2 needed)
  const inlineAsset = INLINE_ASSETS[cleanPath];
  if (inlineAsset) {
    return new Response(inlineAsset.content, {
      headers: {
        'Content-Type': inlineAsset.contentType,
        'Cache-Control': 'no-cache',
      },
    });
  }

  // Serve portal assets from R2 under the "portal/" prefix.
  const r2Key = `portal${path === '/' ? '/index.html' : path}`;

  if (r2Key.endsWith('.html')) {
    const resp = await serveHtmlFromR2(env, r2Key);
    if (resp) return resp;
  } else {
    const object = await env.INVOICE_PDFS.get(r2Key);
    if (object) {
      const headers = new Headers();
      headers.set('Content-Type', getMimeType(r2Key));
      headers.set('Cache-Control', r2Key.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      headers.set('ETag', object.httpEtag);
      return new Response(object.body, { headers });
    }
  }

  // SPA fallback: any non-file path serves index.html so React Router
  // can resolve the route on the client.
  if (!path.includes('.')) {
    const resp = await serveHtmlFromR2(env, 'portal/index.html');
    if (resp) return resp;
  }

  return new Response('Not Found', { status: 404 });
}

export default {
  async fetch(request: Request, env: CombinedEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // API routes → API Worker
    if (url.pathname.startsWith('/api/') || url.pathname === '/api') {
      return apiWorker.fetch(request, env, ctx);
    }

    // Everything else → serve portal from R2
    return handleStaticAsset(request, env);
  },
  // Email handler → Email Worker
  email: emailWorker.email,
  // Scheduled cron handler → PromoStandards sweep
  async scheduled(_event: ScheduledEvent, env: CombinedEnv, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  },
};
