// ============================================
// API Worker
// HTTP endpoints for the portal frontend
// ============================================

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { processInvoicePDF } from '../ocr-pipeline';

export interface APIWorkerEnv {
  INVOICE_PDFS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_ANON_KEY: string;
  MISTRAL_API_KEY: string;
  ANTHROPIC_API_KEY: string;
}

// CORS headers for portal frontend
const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // TODO: restrict to portal domain
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

/**
 * Create a Supabase client from the request's Authorization header.
 * Uses the user's JWT for RLS enforcement.
 */
function getSupabaseClient(env: APIWorkerEnv, authHeader: string | null): SupabaseClient {
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
  }
  // Fallback to anon key (limited by RLS)
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
}

/**
 * Service-level Supabase client (bypasses RLS).
 * Used for operations triggered by Workers, not user requests.
 */
function getServiceClient(env: APIWorkerEnv): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
}

export default {
  async fetch(request: Request, env: APIWorkerEnv): Promise<Response> {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;
    const authHeader = request.headers.get('Authorization');

    try {
      // ============================================
      // INVOICE ENDPOINTS
      // ============================================

      // GET /api/invoices - List invoices (filtered by RLS)
      if (path === '/api/invoices' && request.method === 'GET') {
        const supabase = getSupabaseClient(env, authHeader);
        const status = url.searchParams.get('status');
        const supplierId = url.searchParams.get('supplier_id');
        const limit = parseInt(url.searchParams.get('limit') || '50');
        const offset = parseInt(url.searchParams.get('offset') || '0');

        let query = supabase
          .from('invoices')
          .select('*, supplier:suppliers(name, code)', { count: 'exact' })
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (status) query = query.eq('status', status);
        if (supplierId) query = query.eq('supplier_id', supplierId);

        const { data, error, count } = await query;
        if (error) return errorResponse(error.message, 500);
        return jsonResponse({ invoices: data, total: count });
      }

      // GET /api/invoices/:id - Get single invoice
      if (path.match(/^\/api\/invoices\/[\w-]+$/) && request.method === 'GET') {
        const id = path.split('/').pop();
        const supabase = getSupabaseClient(env, authHeader);

        const { data, error } = await supabase
          .from('invoices')
          .select('*, supplier:suppliers(name, code)')
          .eq('id', id)
          .single();

        if (error) return errorResponse(error.message, 404);
        return jsonResponse(data);
      }

      // PATCH /api/invoices/:id - Update invoice (team only: status, feedback)
      if (path.match(/^\/api\/invoices\/[\w-]+$/) && request.method === 'PATCH') {
        const id = path.split('/').pop();
        const supabase = getSupabaseClient(env, authHeader);
        const body = await request.json() as Record<string, unknown>;

        // Allowed update fields
        const allowedFields = ['status', 'feedback', 'needs_supplier_review', 'invoice_data'];
        const updateData: Record<string, unknown> = {};
        for (const field of allowedFields) {
          if (body[field] !== undefined) {
            updateData[field] = body[field];
          }
        }

        // If rejecting, set feedback metadata
        if (updateData.status === 'rejected') {
          updateData.needs_supplier_review = true;
          updateData.feedback_date = new Date().toISOString();
        }

        const { data, error } = await supabase
          .from('invoices')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();

        if (error) return errorResponse(error.message, 500);

        // Log the status change
        if (updateData.status) {
          const serviceClient = getServiceClient(env);
          await serviceClient.from('feedback_history').insert({
            invoice_id: id,
            action: updateData.status as string,
            feedback_text: updateData.feedback as string || null,
          });
        }

        return jsonResponse(data);
      }

      // ============================================
      // UPLOAD ENDPOINT (manual fallback)
      // ============================================

      // POST /api/upload - Upload PDF for OCR processing
      if (path === '/api/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const supplierId = formData.get('supplier_id') as string;

        if (!file || !supplierId) {
          return errorResponse('Missing file or supplier_id');
        }

        const serviceClient = getServiceClient(env);

        // Store in R2
        const pdfBytes = await file.arrayBuffer();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const r2Key = `invoices/upload/${timestamp}_${file.name}`;

        await env.INVOICE_PDFS.put(r2Key, pdfBytes, {
          customMetadata: {
            source: 'upload',
            original_filename: file.name,
            uploaded_at: new Date().toISOString(),
          },
        });

        // Create invoice record
        const { data: invoice, error: insertError } = await serviceClient
          .from('invoices')
          .insert({
            supplier_id: supplierId,
            file_name: file.name,
            r2_object_key: r2Key,
            status: 'processing',
            source: 'upload',
            invoice_data: {},
          })
          .select()
          .single();

        if (insertError) return errorResponse(insertError.message, 500);

        // Run OCR pipeline
        const ocrResult = await processInvoicePDF(pdfBytes, {
          MISTRAL_API_KEY: env.MISTRAL_API_KEY,
          ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        });

        // Update invoice with results
        await serviceClient
          .from('invoices')
          .update({
            status: ocrResult.status,
            confidence: ocrResult.confidence,
            ocr_provider: ocrResult.provider,
            invoice_data: ocrResult.data,
            ocr_raw_response: ocrResult.rawResponses,
          })
          .eq('id', invoice.id);

        return jsonResponse({
          invoice_id: invoice.id,
          status: ocrResult.status,
          confidence: ocrResult.confidence,
          provider: ocrResult.provider,
          issues: ocrResult.issues,
        });
      }

      // ============================================
      // PDF VIEWER ENDPOINT
      // ============================================

      // GET /api/invoices/:id/pdf - Get signed URL for PDF
      if (path.match(/^\/api\/invoices\/[\w-]+\/pdf$/) && request.method === 'GET') {
        const id = path.split('/')[3];
        const supabase = getSupabaseClient(env, authHeader);

        const { data: invoice, error } = await supabase
          .from('invoices')
          .select('r2_object_key')
          .eq('id', id)
          .single();

        if (error || !invoice) return errorResponse('Invoice not found', 404);

        // Get PDF from R2
        const object = await env.INVOICE_PDFS.get(invoice.r2_object_key);
        if (!object) return errorResponse('PDF not found in storage', 404);

        return new Response(object.body, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="invoice.pdf"`,
          },
        });
      }

      // ============================================
      // SUPPLIER ENDPOINTS
      // ============================================

      // GET /api/suppliers - List suppliers (team only via RLS)
      if (path === '/api/suppliers' && request.method === 'GET') {
        const supabase = getSupabaseClient(env, authHeader);
        const { data, error } = await supabase
          .from('suppliers')
          .select('*')
          .order('name');

        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data);
      }

      // POST /api/suppliers - Create supplier (team only)
      if (path === '/api/suppliers' && request.method === 'POST') {
        const supabase = getSupabaseClient(env, authHeader);
        const body = await request.json() as Record<string, unknown>;

        const { data, error } = await supabase
          .from('suppliers')
          .insert({
            name: body.name,
            code: body.code,
            email_prefix: body.email_prefix,
            contact_email: body.contact_email || null,
            contact_name: body.contact_name || null,
          })
          .select()
          .single();

        if (error) return errorResponse(error.message, 500);
        return jsonResponse(data, 201);
      }

      // ============================================
      // DASHBOARD STATS
      // ============================================

      // GET /api/stats - Dashboard summary (team only via RLS)
      if (path === '/api/stats' && request.method === 'GET') {
        const supabase = getSupabaseClient(env, authHeader);

        const [processed, pending, rejected, total] = await Promise.all([
          supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'processed'),
          supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
          supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
          supabase.from('invoices').select('id', { count: 'exact', head: true }),
        ]);

        return jsonResponse({
          processed: processed.count || 0,
          pending: pending.count || 0,
          rejected: rejected.count || 0,
          total: total.count || 0,
        });
      }

      // ============================================
      // CSV EXPORT
      // ============================================

      // GET /api/invoices/:id/csv - Export invoice as EDI CSV
      if (path.match(/^\/api\/invoices\/[\w-]+\/csv$/) && request.method === 'GET') {
        const id = path.split('/')[3];
        const supabase = getSupabaseClient(env, authHeader);

        const { data: invoice, error } = await supabase
          .from('invoices')
          .select('*')
          .eq('id', id)
          .single();

        if (error || !invoice) return errorResponse('Invoice not found', 404);

        // Generate CSV (import dynamically to keep bundle small)
        const { generateEDICSV } = await import('../../../../shared/src/utils/csv-export');
        const csv = generateEDICSV(invoice.invoice_data);

        return new Response(csv, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'text/csv',
            'Content-Disposition': `attachment; filename="invoice_${invoice.file_name.replace('.pdf', '')}.csv"`,
          },
        });
      }

      // ============================================
      // HEALTH CHECK
      // ============================================
      if (path === '/api/health') {
        return jsonResponse({ status: 'ok', timestamp: new Date().toISOString() });
      }

      return errorResponse('Not found', 404);

    } catch (error) {
      console.error('[API] Unhandled error:', error);
      return errorResponse(
        `Internal server error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        500
      );
    }
  },
};
