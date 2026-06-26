// ============================================
// Corcentric Submission Database Queries
// ============================================

import { SupabaseClient } from '@supabase/supabase-js';

export interface InsertSubmissionData {
  invoice_id: string;
  supplier_id: string | null;
  request_xml: string;
  status: string;
  attempt_number: number;
  is_dry_run: boolean;
  submitted_by: string | null;
}

/**
 * Insert a new submission record.
 */
export async function insertSubmission(
  client: SupabaseClient,
  data: InsertSubmissionData,
) {
  return client
    .from('corcentric_submissions')
    .insert(data)
    .select()
    .single();
}

/**
 * Update a submission record by ID.
 */
export async function updateSubmission(
  client: SupabaseClient,
  id: string,
  data: Record<string, unknown>,
) {
  return client
    .from('corcentric_submissions')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
}

/**
 * Get the latest (most recent) submission for an invoice.
 */
export async function getLatestSubmission(
  client: SupabaseClient,
  invoiceId: string,
): Promise<Record<string, unknown> | null> {
  const { data } = await client
    .from('corcentric_submissions')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return data as Record<string, unknown> | null;
}

/**
 * Count how many submission attempts exist for an invoice.
 */
export async function countSubmissionAttempts(
  client: SupabaseClient,
  invoiceId: string,
): Promise<number> {
  const { count } = await client
    .from('corcentric_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('invoice_id', invoiceId)
    .eq('is_dry_run', false);

  return count || 0;
}

export interface ListSubmissionsOptions {
  invoiceId?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

/**
 * List submissions with optional filters and pagination.
 */
export async function listSubmissions(
  client: SupabaseClient,
  options: ListSubmissionsOptions = {},
) {
  const { invoiceId, status, limit = 20, offset = 0 } = options;

  // response_xml is included so the invoice-detail drawer can show the
  // full, timestamped Corcentric response inline without a second round
  // trip. Typical body is <10KB; keeping the per-invoice list capped at
  // a handful of attempts (see caller) prevents payload bloat.
  let query = client
    .from('corcentric_submissions')
    .select(
      `id, invoice_id, supplier_id, status, cor_status_code, cor_response_id,
       cor_messages, attempt_number, submitted_at, completed_at, submitted_by,
       error_message, is_dry_run, response_xml, created_at,
       invoices!inner(file_name, invoice_data->InvoiceNumber),
       suppliers(name, code)`,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (invoiceId) query = query.eq('invoice_id', invoiceId);
  if (status) query = query.eq('status', status);

  return query;
}

