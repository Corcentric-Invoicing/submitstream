// ============================================
// API Worker — Request Router
// Maps incoming HTTP requests to handler functions.
// Each handler lives in its own module under handlers/.
// ============================================

import { APIWorkerEnv, RequestContext } from './types';
import { buildResponseHeaders } from './middleware/cors';
import { getUserClient, getServiceClient } from './middleware/auth';
import { setResponseHeaders, errorResponse, jsonResponse } from './middleware/response';

// ── Handler imports ──
import { listInvoices, getInvoice, patchInvoice, deleteInvoice, retryOcrInvoice } from './handlers/invoices';
import { uploadInvoice } from './handlers/upload';
import { getInvoicePdf } from './handlers/pdf';
import { exportInvoiceCsv, exportInvoicesBulkCsv } from './handlers/csv-export';
import { listSuppliers, createSupplier, patchSupplier, deactivateSupplier, reactivateSupplier, deleteSupplier, getSupplierUsers, removeSupplierUser, testSupplierConnection } from './handlers/suppliers';
import { getSettings, patchSettings } from './handlers/settings';
import { inviteTeamMember, listTeamMembers, assignSupplier, unassignSupplier, updateTeamMember, resetTeamMemberPassword, resendInviteToTeamMember, deactivateTeamMember, reactivateTeamMember, deleteTeamMember } from './handlers/team';
import { getStats, getUsage, healthCheck } from './handlers/stats';
import { previewCorcentricXml } from './handlers/corcentric-xml';
import { submitToCorcentricHandler, retryCorcentricSubmission, listCorcentricSubmissions } from './handlers/corcentric-submit';
import { listCustomersHandler, getCustomerHandler, createCustomerHandler, patchCustomerHandler, listCustomerCodesHandler, addCustomerCodeHandler, removeCustomerCodeHandler, listShipTosHandler, addShipToHandler, patchShipToHandler, removeShipToHandler } from './handlers/customers';
import { listCommunitiesHandler, getCommunitiesHandler, createCommunityHandler, updateCommunityHandler, deleteCommunityHandler } from './handlers/communities';
import {
  listSupplierCommunitiesHandler,
  createSupplierCommunityHandler,
  updateSupplierCommunityHandler,
  deleteSupplierCommunityHandler,
} from './handlers/supplier-communities';
import { pullOneSupplierHandler, pullAllSuppliersHandler, testConnectionHandler as psTestConnectionHandler, listPullsHandler, healthSummaryHandler } from './handlers/promostandards';
import { getCustomerCandidatesHandler } from './handlers/customer-match';

/**
 * Main Cloudflare Worker fetch handler.
 * Routes incoming requests to appropriate handler functions based on method and path.
 * Builds shared RequestContext with pre-configured database clients and headers before delegating.
 *
 * @param request - Incoming HTTP request
 * @param env - Cloudflare Worker environment (R2 buckets, secrets, KV, etc.)
 * @returns HTTP response from the matched handler, or 404 if no route matches
 */
export default {
  async fetch(request: Request, env: APIWorkerEnv): Promise<Response> {
    // Build CORS + security headers for this request
    const headers = buildResponseHeaders(request, env);
    setResponseHeaders(headers);

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const authHeader = request.headers.get('Authorization');

    // Read supplier context cookie (set when serving /supplier/{code} pages)
    const cookieHeader = request.headers.get('Cookie') || '';
    const supplierCtxMatch = cookieHeader.match(/(?:^|;\s*)__supplier_ctx=([^;]+)/);
    const supplierContextCode = supplierCtxMatch
      ? decodeURIComponent(supplierCtxMatch[1]).toLowerCase()
      : undefined;

    // Build request context (shared by all handlers)
    const ctx: RequestContext = {
      env,
      url,
      path,
      authHeader,
      headers,
      userClient: getUserClient(env, authHeader),
      serviceClient: getServiceClient(env),
      supplierContextCode,
    };

    try {
      // ── Invoices ──
      if (path === '/api/invoices' && request.method === 'GET')
        return listInvoices(request, ctx);

      if (path.match(/^\/api\/invoices\/[\w-]+$/) && request.method === 'GET')
        return getInvoice(request, ctx);

      if (path.match(/^\/api\/invoices\/[\w-]+$/) && request.method === 'PATCH')
        return patchInvoice(request, ctx);

      // ── Delete invoice (admin always; team/supplier scoped; blocked if submitted) ──
      if (path.match(/^\/api\/invoices\/[\w-]+$/) && request.method === 'DELETE')
        return deleteInvoice(request, ctx);

      // ── Re-run OCR on existing invoice (recover from failed extraction) ──
      if (path.match(/^\/api\/invoices\/[\w-]+\/retry-ocr$/) && request.method === 'POST')
        return retryOcrInvoice(request, ctx);

      // ── Upload ──
      if ((path === '/api/upload' || path === '/api/invoices/upload') && request.method === 'POST')
        return uploadInvoice(request, ctx);

      // ── PDF viewer ──
      if (path.match(/^\/api\/invoices\/[\w-]+\/pdf$/) && request.method === 'GET')
        return getInvoicePdf(request, ctx);

      // ── CSV export (single) ──
      if (path.match(/^\/api\/invoices\/[\w-]+\/csv$/) && request.method === 'GET')
        return exportInvoiceCsv(request, ctx);

      // ── CSV export (bulk, multi-select) ──
      if (path === '/api/invoices/export-csv' && request.method === 'POST')
        return exportInvoicesBulkCsv(request, ctx);

      // ── Customer-match candidates (review UI banner) ──
      if (path.match(/^\/api\/invoices\/[\w-]+\/customer-candidates$/) && request.method === 'GET')
        return getCustomerCandidatesHandler(request, ctx);

      // ── Corcentric XML preview (dry-run) ──
      if (path.match(/^\/api\/invoices\/[\w-]+\/corcentric-xml$/) && request.method === 'GET')
        return previewCorcentricXml(request, ctx);

      // ── Corcentric submit (live or dry-run) ──
      if (path.match(/^\/api\/invoices\/[\w-]+\/corcentric-submit$/) && request.method === 'POST')
        return submitToCorcentricHandler(request, ctx);

      // ── Corcentric retry ──
      if (path.match(/^\/api\/invoices\/[\w-]+\/corcentric-retry$/) && request.method === 'POST')
        return retryCorcentricSubmission(request, ctx);

      // ── Corcentric submission history ──
      if (path === '/api/corcentric-submissions' && request.method === 'GET')
        return listCorcentricSubmissions(request, ctx);

      // ── Suppliers ──
      if (path === '/api/suppliers' && request.method === 'GET')
        return listSuppliers(request, ctx);

      if (path === '/api/suppliers' && request.method === 'POST')
        return createSupplier(request, ctx);

      if (path.match(/^\/api\/suppliers\/[\w-]+\/deactivate$/) && request.method === 'POST')
        return deactivateSupplier(request, ctx);

      if (path.match(/^\/api\/suppliers\/[\w-]+\/reactivate$/) && request.method === 'POST')
        return reactivateSupplier(request, ctx);

      if (path.match(/^\/api\/suppliers\/[\w-]+$/) && request.method === 'DELETE')
        return deleteSupplier(request, ctx);

      if (path.match(/^\/api\/suppliers\/[\w-]+\/users$/) && request.method === 'GET')
        return getSupplierUsers(request, ctx);

      if (path.match(/^\/api\/suppliers\/[\w-]+\/users$/) && request.method === 'DELETE')
        return removeSupplierUser(request, ctx);

      // ── Supplier Corcentric connection test ──
      if (path.match(/^\/api\/suppliers\/[\w-]+\/test-connection$/) && request.method === 'POST')
        return testSupplierConnection(request, ctx);

      if (path.startsWith('/api/suppliers/') && request.method === 'PATCH')
        return patchSupplier(request, ctx);

      // ── Stats ──
      if (path === '/api/stats' && request.method === 'GET')
        return getStats(request, ctx);

      // ── Settings (admin only) ──
      if (path === '/api/settings' && request.method === 'GET')
        return getSettings(request, ctx);

      if (path === '/api/settings' && request.method === 'PATCH')
        return patchSettings(request, ctx);

      // ── Usage ──
      if (path === '/api/usage' && request.method === 'GET')
        return getUsage(request, ctx);

      // ── Team (admin only) ──
      if (path === '/api/team/invite' && request.method === 'POST')
        return inviteTeamMember(request, ctx);

      if (path === '/api/team' && request.method === 'GET')
        return listTeamMembers(request, ctx);

      if (path === '/api/team/assign' && request.method === 'POST')
        return assignSupplier(request, ctx);

      if (path === '/api/team/assign' && request.method === 'DELETE')
        return unassignSupplier(request, ctx);

      if (path.match(/^\/api\/team\/[\w-]+\/reset-password$/) && request.method === 'POST')
        return resetTeamMemberPassword(request, ctx);

      if (path.match(/^\/api\/team\/[\w-]+\/resend-invite$/) && request.method === 'POST')
        return resendInviteToTeamMember(request, ctx);

      if (path.match(/^\/api\/team\/[\w-]+\/deactivate$/) && request.method === 'POST')
        return deactivateTeamMember(request, ctx);

      if (path.match(/^\/api\/team\/[\w-]+\/reactivate$/) && request.method === 'POST')
        return reactivateTeamMember(request, ctx);

      if (path.match(/^\/api\/team\/[\w-]+$/) && request.method === 'DELETE')
        return deleteTeamMember(request, ctx);

      if (path.match(/^\/api\/team\/[\w-]+$/) && request.method === 'PATCH')
        return updateTeamMember(request, ctx);

      // ── Me (authenticated role check for post-login redirect) ──
      if (path === '/api/me' && request.method === 'GET') {
        const { data: { user } } = await ctx.userClient.auth.getUser();
        if (!user) return errorResponse('Not authenticated', 401);
        const { data: profile, error: profileError } = await ctx.serviceClient
          .from('user_profiles')
          .select('role, supplier_id, display_name, terms_accepted_at, terms_version')
          .eq('id', user.id)
          .single();
        if (profileError || !profile) {
          return errorResponse('Profile not found — retry', 503);
        }
        return jsonResponse({
          id: user.id,
          role: profile.role,
          supplier_id: profile.supplier_id || null,
          display_name: profile.display_name || null,
          terms_accepted_at: profile.terms_accepted_at || null,
          terms_version: profile.terms_version || null,
        });
      }

      // ── Accept Terms of Service ──
      if (path === '/api/me/accept-terms' && request.method === 'POST') {
        const { data: { user } } = await ctx.userClient.auth.getUser();
        if (!user) return errorResponse('Not authenticated', 401);
        const { error: updateError } = await ctx.serviceClient
          .from('user_profiles')
          .update({
            terms_accepted_at: new Date().toISOString(),
            terms_version: '1.0',
          })
          .eq('id', user.id);
        if (updateError) return errorResponse('Failed to record acceptance', 500);
        return jsonResponse({ accepted: true, terms_version: '1.0', accepted_at: new Date().toISOString() });
      }

      // ── Customers (admin only) ──
      if (path === '/api/customers' && request.method === 'GET')
        return listCustomersHandler(request, ctx);

      if (path === '/api/customers' && request.method === 'POST')
        return createCustomerHandler(request, ctx);

      if (path.match(/^\/api\/customers\/[\w-]+\/codes\/[\w-]+$/) && request.method === 'DELETE')
        return removeCustomerCodeHandler(request, ctx);

      if (path.match(/^\/api\/customers\/[\w-]+\/codes$/) && request.method === 'GET')
        return listCustomerCodesHandler(request, ctx);

      if (path.match(/^\/api\/customers\/[\w-]+\/codes$/) && request.method === 'POST')
        return addCustomerCodeHandler(request, ctx);

      if (path.match(/^\/api\/customers\/[\w-]+$/) && request.method === 'GET')
        return getCustomerHandler(request, ctx);

      if (path.match(/^\/api\/customers\/[\w-]+$/) && request.method === 'PATCH')
        return patchCustomerHandler(request, ctx);

      // ── Customer Ship-To Locations ──
      if (path.match(/^\/api\/customers\/[\w-]+\/ship-tos\/[\w-]+$/) && request.method === 'PATCH')
        return patchShipToHandler(request, ctx);

      if (path.match(/^\/api\/customers\/[\w-]+\/ship-tos\/[\w-]+$/) && request.method === 'DELETE')
        return removeShipToHandler(request, ctx);

      if (path.match(/^\/api\/customers\/[\w-]+\/ship-tos$/) && request.method === 'GET')
        return listShipTosHandler(request, ctx);

      if (path.match(/^\/api\/customers\/[\w-]+\/ship-tos$/) && request.method === 'POST')
        return addShipToHandler(request, ctx);

      // ── PromoStandards pull (admin only) ──
      if (path.match(/^\/api\/promostandards\/pull\/[\w-]+$/) && request.method === 'POST')
        return pullOneSupplierHandler(request, ctx);

      if (path === '/api/promostandards/pull-all' && request.method === 'POST')
        return pullAllSuppliersHandler(request, ctx);

      if (path === '/api/promostandards/test-connection' && request.method === 'POST')
        return psTestConnectionHandler(request, ctx);

      if (path === '/api/promostandards/pulls' && request.method === 'GET')
        return listPullsHandler(request, ctx);

      if (path === '/api/promostandards/health' && request.method === 'GET')
        return healthSummaryHandler(request, ctx);

      // ── Communities (admin only) ──
      if (path === '/api/communities' && request.method === 'GET')
        return listCommunitiesHandler(request, ctx);

      if (path === '/api/communities' && request.method === 'POST')
        return createCommunityHandler(request, ctx);

      if (path.match(/^\/api\/communities\/[\w-]+$/) && request.method === 'GET')
        return getCommunitiesHandler(request, ctx);

      if (path.match(/^\/api\/communities\/[\w-]+$/) && request.method === 'PATCH')
        return updateCommunityHandler(request, ctx);

      if (path.match(/^\/api\/communities\/[\w-]+$/) && request.method === 'DELETE')
        return deleteCommunityHandler(request, ctx);

      // ── Supplier ↔ Community assignments (admin only) ──
      // Read via ?community_id=... or ?supplier_id=... query param.
      if (path === '/api/supplier-communities' && request.method === 'GET')
        return listSupplierCommunitiesHandler(request, ctx);

      if (path === '/api/supplier-communities' && request.method === 'POST')
        return createSupplierCommunityHandler(request, ctx);

      if (path.match(/^\/api\/supplier-communities\/[\w-]+$/) && request.method === 'PATCH')
        return updateSupplierCommunityHandler(request, ctx);

      if (path.match(/^\/api\/supplier-communities\/[\w-]+$/) && request.method === 'DELETE')
        return deleteSupplierCommunityHandler(request, ctx);

      // ── Health ──
      if (path === '/api/health')
        return healthCheck();

      return errorResponse('Not found', 404);

    } catch (error) {
      console.error('[API] Unhandled error:', error);
      return errorResponse('Internal server error', 500);
    }
  },
};
