// ============================================
// Combined Worker Entry Point
// Handles HTTP fetch (API + Portal), and
// email messages (Cloudflare Email Routing)
// ============================================

import apiWorker from './api/index';
import emailWorker from './email-worker/index';

export interface CombinedEnv {
  INVOICE_PDFS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  MISTRAL_API_KEY: string;
  ANTHROPIC_API_KEY: string;
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

async function handleStaticAsset(request: Request, env: CombinedEnv): Promise<Response> {
  const url = new URL(request.url);
  let path = url.pathname;

  // Serve portal assets from R2 under the "portal/" prefix
  const r2Key = `portal${path === '/' ? '/index.html' : path}`;

  const object = await env.INVOICE_PDFS.get(r2Key);
  if (object) {
    const headers = new Headers();
    headers.set('Content-Type', getMimeType(r2Key));
    headers.set('Cache-Control', r2Key.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=60');
    headers.set('ETag', object.httpEtag);
    return new Response(object.body, { headers });
  }

  // For SPA routing: any non-file path falls back to index.html
  if (!path.includes('.')) {
    const indexObject = await env.INVOICE_PDFS.get('portal/index.html');
    if (indexObject) {
      const headers = new Headers();
      headers.set('Content-Type', 'text/html; charset=utf-8');
      headers.set('Cache-Control', 'public, max-age=60');
      return new Response(indexObject.body, { headers });
    }
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
};
