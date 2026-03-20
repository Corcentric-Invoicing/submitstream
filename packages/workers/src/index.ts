// ============================================
// Combined Worker Entry Point
// Handles both HTTP fetch requests (API) and
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

export default {
  // HTTP handler → API Worker
  fetch: apiWorker.fetch,
  // Email handler → Email Worker
  email: emailWorker.email,
};
