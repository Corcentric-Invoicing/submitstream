// ============================================
// Shared Database Query Layer
// Centralizes Supabase queries so handlers stay thin.
// Each function is a single, testable unit.
// ============================================

import { SupabaseClient } from '@supabase/supabase-js';

// ── Invoice Queries ──────────────────────────────

export interface InvoiceListOptions {
  status?: string | null;
  supplierId?: string | null;
  /** Scope to multiple supplier IDs (from team_supplier_assignments) */
  supplierIds?: string[] | null;
  /** Text search across invoice number, file name */
  search?: string | null;
  /** Filter by ingestion source (email / upload / promostandards / …). */
  ingestionSource?: string | null;
  /** Flag severity filter — 'clean' = no findings, 'errors' = any error, 'warnings' = any warning, null = all. */
  flagSeverity?: 'clean' | 'warnings' | 'errors' | null;
  /** ISO date: created_at >= this */
  createdAfter?: string | null;
  /** ISO date: created_at <= this */
  createdBefore?: string | null;
  limit?: number;
  offset?: number;
}

/**
 * List invoices with optional filters and pagination.
 * Uses the user's RLS-scoped client so results respect access policies.
 * - supplierId: explicit single-supplier filter (from query param)
 * - supplierIds: multi-supplier scope (from caller's team assignments)
 *   When both are provided, supplierId is used (more specific).
 *   When supplierIds is an empty array, no invoices are returned.
 */
export async function listInvoicesQuery(
  client: SupabaseClient,
  options: InvoiceListOptions = {},
) {
  const {
    status, supplierId, supplierIds, search,
    ingestionSource, flagSeverity, createdAfter, createdBefore,
    limit = 50, offset = 0,
  } = options;

  let query = client
    .from('invoices')
    .select('*, supplier:suppliers(name, code), customer:customers(name, cor_customer_code)', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (status) query = query.eq('status', status);

  // Text search — filter by file_name (invoice number is usually in file_name or invoice_data)
  if (search) {
    query = query.ilike('file_name', `%${search}%`);
  }

  // Ingestion-source filter (email / upload / promostandards / …)
  if (ingestionSource) {
    query = query.eq('ingestion_source', ingestionSource);
  }

  // Flag-severity filter. 'clean' = no findings at all; 'warnings' / 'errors'
  // match any finding whose severity equals the requested level.
  if (flagSeverity === 'clean') {
    query = query.is('validation_findings', null);
  } else if (flagSeverity === 'errors') {
    query = query.contains('validation_findings', [{ severity: 'error' }]);
  } else if (flagSeverity === 'warnings') {
    query = query.contains('validation_findings', [{ severity: 'warning' }]);
  }

  // Date-range filters (both inclusive)
  if (createdAfter) query = query.gte('created_at', createdAfter);
  if (createdBefore) query = query.lte('created_at', createdBefore);

  // Explicit single-supplier filter takes priority
  if (supplierId) {
    query = query.eq('supplier_id', supplierId);
  } else if (supplierIds !== undefined && supplierIds !== null) {
    // Team-scoped filter: only show invoices from assigned suppliers
    if (supplierIds.length === 0) {
      // No assignments → no invoices. Use impossible filter.
      query = query.eq('supplier_id', '00000000-0000-0000-0000-000000000000');
    } else {
      query = query.in('supplier_id', supplierIds);
    }
  }

  return query;
}

/**
 * Get a single invoice by ID with supplier details.
 */
export async function getInvoiceById(client: SupabaseClient, id: string) {
  return client
    .from('invoices')
    .select('*, supplier:suppliers(name, code)')
    .eq('id', id)
    .single();
}

/**
 * Get a single invoice by ID with only the R2 object key (for PDF streaming).
 */
export async function getInvoiceR2Key(client: SupabaseClient, id: string) {
  return client
    .from('invoices')
    .select('r2_object_key')
    .eq('id', id)
    .single();
}

/**
 * Get a single invoice by ID with all fields (for CSV export).
 */
export async function getInvoiceFull(client: SupabaseClient, id: string) {
  return client
    .from('invoices')
    .select('*')
    .eq('id', id)
    .single();
}

/**
 * Update an invoice by ID and return the updated record.
 */
export async function updateInvoice(
  client: SupabaseClient,
  id: string,
  data: Record<string, unknown>,
) {
  return client
    .from('invoices')
    .update(data)
    .eq('id', id)
    .select()
    .single();
}

/**
 * Count invoices matching a date filter (for rate limiting).
 */
export async function countInvoicesSince(client: SupabaseClient, sinceISO: string) {
  return client
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sinceISO);
}

/**
 * Count invoices by status (for dashboard stats).
 * When supplierIds is provided, scopes count to those suppliers only.
 * null means no filter (admin sees all). Empty array means zero results.
 */
export async function countInvoicesByStatus(
  client: SupabaseClient,
  status?: string,
  supplierIds?: string[] | null,
) {
  let query = client.from('invoices').select('id', { count: 'exact', head: true });
  if (status) query = query.eq('status', status);
  if (supplierIds !== undefined && supplierIds !== null) {
    if (supplierIds.length === 0) {
      query = query.eq('supplier_id', '00000000-0000-0000-0000-000000000000');
    } else {
      query = query.in('supplier_id', supplierIds);
    }
  }
  return query;
}

// ── Supplier Queries ─────────────────────────────

/**
 * List all suppliers ordered by name.
 */
export async function listSuppliersQuery(client: SupabaseClient) {
  return client.from('suppliers').select('*, communities(id, code, name)').order('name');
}

/**
 * Look up a supplier by its code (case-insensitive).
 * Returns the supplier's ID if found.
 */
export async function getSupplierIdByCode(client: SupabaseClient, code: string) {
  const { data } = await client
    .from('suppliers')
    .select('id')
    .ilike('code', code)
    .limit(1)
    .single();
  return data?.id as string | undefined;
}

/**
 * Insert a new supplier and return the record.
 */
export async function insertSupplier(
  client: SupabaseClient,
  data: Record<string, unknown>,
) {
  return client.from('suppliers').insert(data).select().single();
}

/**
 * Update a supplier by ID and return the updated record.
 */
export async function updateSupplier(
  client: SupabaseClient,
  id: string,
  data: Record<string, unknown>,
) {
  return client.from('suppliers').update(data).eq('id', id).select().single();
}

// ── System Settings Queries ──────────────────────

/**
 * Get all system settings.
 */
export async function getAllSettings(client: SupabaseClient) {
  return client.from('system_settings').select('*');
}

/**
 * Get a single system setting by key.
 */
export async function getSettingByKey(client: SupabaseClient, key: string) {
  return client
    .from('system_settings')
    .select('value')
    .eq('key', key)
    .single();
}

/**
 * Update a system setting by key and return the updated record.
 */
export async function updateSetting(
  client: SupabaseClient,
  key: string,
  value: unknown,
) {
  return client
    .from('system_settings')
    .update({ value, updated_at: new Date().toISOString() })
    .eq('key', key)
    .select()
    .single();
}

// ── User Profile Queries ─────────────────────────

/**
 * List all supplier-role users assigned to a specific supplier.
 * These are users with role='supplier' and supplier_id set on their profile.
 */
export async function listSupplierUsers(client: SupabaseClient, supplierId: string) {
  return client
    .from('user_profiles')
    .select('id, display_name, role, supplier_id, created_at')
    .eq('supplier_id', supplierId)
    .eq('role', 'supplier')
    .order('created_at', { ascending: true });
}

/**
 * Update a user profile's supplier_id assignment.
 */
export async function setUserSupplier(
  client: SupabaseClient,
  userId: string,
  supplierId: string | null,
) {
  return client
    .from('user_profiles')
    .update({ supplier_id: supplierId })
    .eq('id', userId)
    .select()
    .single();
}

/**
 * Count recently created user profiles (for rate limiting invites).
 */
export async function countRecentProfiles(client: SupabaseClient, sinceISO: string) {
  return client
    .from('user_profiles')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', sinceISO);
}

/**
 * Insert a new user profile.
 */
export async function insertProfile(
  client: SupabaseClient,
  data: Record<string, unknown>,
) {
  return client.from('user_profiles').insert(data);
}

/**
 * List all user profiles with basic info.
 */
export async function listProfiles(client: SupabaseClient) {
  return client.from('user_profiles').select('id, role, display_name, created_at');
}

// ── Team Assignment Queries ──────────────────────

/**
 * Bulk-insert supplier assignments for a team member.
 */
export async function insertSupplierAssignments(
  client: SupabaseClient,
  assignments: Array<{ user_id: string; supplier_id: string; assigned_by: string }>,
) {
  return client.from('team_supplier_assignments').insert(assignments);
}

/**
 * List all supplier assignments with supplier details (for team member display).
 */
export async function listSupplierAssignments(client: SupabaseClient) {
  return client.from('team_supplier_assignments').select('user_id, supplier_id, suppliers(id, name, code)');
}

/**
 * Delete a specific supplier assignment.
 */
export async function deleteSupplierAssignment(
  client: SupabaseClient,
  userId: string,
  supplierId: string,
) {
  return client
    .from('team_supplier_assignments')
    .delete()
    .eq('user_id', userId)
    .eq('supplier_id', supplierId);
}

/**
 * Delete ALL supplier assignments for a given user (used when deleting a team member).
 */
export async function deleteAllSupplierAssignments(
  client: SupabaseClient,
  userId: string,
) {
  return client
    .from('team_supplier_assignments')
    .delete()
    .eq('user_id', userId);
}

/**
 * Delete ALL team assignments for a given supplier (used when deleting a supplier).
 */
export async function deleteAllAssignmentsForSupplier(
  client: SupabaseClient,
  supplierId: string,
) {
  return client
    .from('team_supplier_assignments')
    .delete()
    .eq('supplier_id', supplierId);
}

/**
 * Delete a user profile by ID (hard-delete).
 */
export async function deleteProfile(client: SupabaseClient, id: string) {
  return client.from('user_profiles').delete().eq('id', id);
}

/**
 * Delete an invoice row by ID (hard-delete).
 * Service-role only — handler must enforce scope + business rules first.
 * Cascades to corcentric_submissions, feedback_history, processing_log.
 */
export async function deleteInvoiceById(client: SupabaseClient, id: string) {
  return client.from('invoices').delete().eq('id', id);
}

/**
 * Delete a supplier record by ID (hard-delete).
 */
export async function deleteSupplierRecord(client: SupabaseClient, id: string) {
  return client.from('suppliers').delete().eq('id', id);
}

/**
 * Update a user profile by ID (admin action).
 */
export async function updateProfile(
  client: SupabaseClient,
  id: string,
  data: { role?: string; display_name?: string },
) {
  return client.from('user_profiles').update(data).eq('id', id).select().single();
}

// ── Feedback History Queries ─────────────────────

/**
 * Log a status change to the feedback history table.
 */
export async function insertFeedbackEntry(
  client: SupabaseClient,
  invoiceId: string,
  action: string,
  feedbackText: string | null,
) {
  return client.from('feedback_history').insert({
    invoice_id: invoiceId,
    action,
    feedback_text: feedbackText,
  });
}

// ── Customer Lookup Queries ─────────────────────

/**
 * Resolve a customer's Corcentric customer code by matching the customer name
 * (from OCR ShipToName or BillToName) against the customers table.
 * Scoped to the invoice's supplier — each customer belongs to one supplier (1:1).
 * Used as a fallback when code-based lookup via customer_supplier_codes fails.
 *
 * @param client - Supabase client
 * @param customerName - The name extracted from OCR (e.g. "Campbell Print Center")
 * @param supplierId - Optional supplier ID to scope the lookup (recommended for accuracy)
 * @returns The customer's cor_customer_code, or null if not found
 */
export async function resolveCorCustomerCodeByName(
  client: SupabaseClient,
  customerName: string,
  supplierId?: string,
): Promise<string | null> {
  const trimmed = customerName.trim();
  if (!trimmed) return null;

  try {
    // Fetch active customers, scoped to supplier if provided.
    // Filter for non-null cor_customer_code in JS to avoid .neq/.not null semantics.
    let query = client
      .from('customers')
      .select('cor_customer_code, name')
      .eq('active', true);

    if (supplierId) {
      query = query.eq('supplier_id', supplierId);
    }

    const { data: rawCustomers, error } = await query;

    if (error) {
      console.error(`[CustomerLookup] Query error:`, JSON.stringify(error));
      return null;
    }

    // Filter to only customers that have a cor_customer_code set
    const customers = (rawCustomers || []).filter(
      (c) => c.cor_customer_code != null && String(c.cor_customer_code).trim() !== ''
    );

    console.log(`[CustomerLookup] Found ${customers.length} customers with codes: ${JSON.stringify(customers.map(c => ({ name: c.name, code: c.cor_customer_code })))}`);

    if (customers.length === 0) {
      console.warn(`[CustomerLookup] No customers with cor_customer_code found`);
      return null;
    }

    const lowerName = trimmed.toLowerCase();

    // 1. Try exact match first (case-insensitive)
    for (const c of customers) {
      if (String(c.name || '').toLowerCase() === lowerName) {
        console.log(`[CustomerLookup] Resolved "${trimmed}" → "${c.cor_customer_code}" (exact match)`);
        return String(c.cor_customer_code);
      }
    }

    // 2. Try partial/contains match — customer name might be a substring
    // e.g., OCR extracts "Campbell Print Center" but customer record is "Campbell"
    for (const c of customers) {
      const cName = String(c.name || '').toLowerCase();
      if (cName && (lowerName.includes(cName) || cName.includes(lowerName))) {
        console.log(`[CustomerLookup] Resolved "${trimmed}" → "${c.cor_customer_code}" (partial match on "${c.name}")`);
        return String(c.cor_customer_code);
      }
    }

    console.log(`[CustomerLookup] No customer match for name "${trimmed}"`);
    return null;
  } catch (err) {
    console.error(`[CustomerLookup] Error resolving customer by name "${trimmed}":`, err);
    return null;
  }
}

/**
 * List all customers (for admin management UI).
 */
export async function listCustomers(client: SupabaseClient) {
  return client
    .from('customers')
    .select('*')
    .eq('active', true)
    .order('name');
}

/**
 * Get a single customer by ID.
 */
export async function getCustomerById(client: SupabaseClient, id: string) {
  return client
    .from('customers')
    .select('*')
    .eq('id', id)
    .single();
}

/**
 * Insert a new customer.
 */
export async function insertCustomer(
  client: SupabaseClient,
  data: Record<string, unknown>,
) {
  return client.from('customers').insert(data).select().single();
}

/**
 * Update a customer by ID.
 */
export async function updateCustomer(
  client: SupabaseClient,
  id: string,
  data: Record<string, unknown>,
) {
  return client.from('customers').update(data).eq('id', id).select().single();
}

/**
 * List supplier-specific codes for a customer.
 */
export async function listCustomerSupplierCodes(
  client: SupabaseClient,
  customerId: string,
) {
  return client
    .from('customer_supplier_codes')
    .select('*, suppliers(id, name, code)')
    .eq('customer_id', customerId)
    .eq('active', true)
    .order('created_at');
}

/**
 * Insert a customer-supplier code mapping.
 */
export async function insertCustomerSupplierCode(
  client: SupabaseClient,
  data: { customer_id: string; supplier_id: string; supplier_code: string; description?: string },
) {
  return client.from('customer_supplier_codes').insert(data).select().single();
}

/**
 * Delete a customer-supplier code mapping.
 */
export async function deleteCustomerSupplierCode(client: SupabaseClient, id: string) {
  return client.from('customer_supplier_codes').update({ active: false }).eq('id', id);
}

// ── Ship-To Location Queries ─────────────────────

/**
 * List ship-to locations for a customer.
 */
export async function listCustomerShipTos(
  client: SupabaseClient,
  customerId: string,
) {
  return client
    .from('customer_ship_tos')
    .select('*')
    .eq('customer_id', customerId)
    .eq('active', true)
    .order('name');
}

/**
 * Insert a new ship-to location.
 */
export async function insertCustomerShipTo(
  client: SupabaseClient,
  data: { customer_id: string; code: string; name?: string; address1?: string; address2?: string; city?: string; state?: string; zip?: string },
) {
  return client.from('customer_ship_tos').insert(data).select().single();
}

/**
 * Update a ship-to location by ID.
 */
export async function updateCustomerShipTo(
  client: SupabaseClient,
  id: string,
  data: Record<string, unknown>,
) {
  return client.from('customer_ship_tos').update(data).eq('id', id).select().single();
}

/**
 * Soft-delete a ship-to location.
 */
export async function deleteCustomerShipTo(client: SupabaseClient, id: string) {
  return client.from('customer_ship_tos').update({ active: false }).eq('id', id);
}

// ── Corcentric Integration Queries ──────────────

/**
 * Get invoice with full data + supplier Corcentric config for XML generation.
 *
 * Reads per-community Corcentric codes (cor_vendor_code, cor_customer_code)
 * via the supplier_communities join table. The legacy single-value columns
 * on `suppliers` are still selected as a transition-period fallback — the
 * submission handler prefers join-table values when present.
 *
 * `suppliers.supplier_communities` will be an array; the handler picks the
 * primary row (is_primary=true) for default-community resolution, or filters
 * by a specific community when one is named on the invoice.
 */
export async function getInvoiceWithCorcentricConfig(client: SupabaseClient, invoiceId: string) {
  return client
    .from('invoices')
    .select(`
      id, file_name, invoice_data, status, supplier_id, r2_object_key,
      suppliers (
        id, name, code,
        cor_vendor_code, cor_customer_code, cor_community_code,
        cor_transaction_type, cor_currency_code,
        cor_field_mapping, cor_mapping_config, cor_ingestion_enabled,
        cor_api_url, cor_username, cor_password,
        community_id, communities (id, code, name, cor_api_url, cor_username, cor_password),
        supplier_communities (
          community_id,
          cor_vendor_code,
          cor_customer_code,
          is_primary,
          active,
          communities (id, code, name, cor_api_url, cor_username, cor_password)
        )
      )
    `)
    .eq('id', invoiceId)
    .single();
}

// ── Community Queries ───────────────────────────

/**
 * List all active communities.
 */
export async function listCommunities(client: SupabaseClient) {
  return client
    .from('communities')
    .select('*')
    .eq('active', true)
    .order('code');
}

/**
 * Get a single community by ID.
 */
export async function getCommunity(client: SupabaseClient, id: string) {
  return client.from('communities').select('*').eq('id', id).single();
}

/**
 * Insert a new community.
 */
export async function insertCommunity(
  client: SupabaseClient,
  data: { code: string; name: string; cor_api_url?: string; cor_username?: string; cor_password?: string },
) {
  return client.from('communities').insert(data).select().single();
}

/**
 * Update a community.
 */
export async function updateCommunity(
  client: SupabaseClient,
  id: string,
  data: { code?: string; name?: string; active?: boolean; cor_api_url?: string | null; cor_username?: string | null; cor_password?: string | null },
) {
  return client
    .from('communities')
    .update({ ...data, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
}

/**
 * Soft-delete a community.
 */
export async function deleteCommunity(client: SupabaseClient, id: string) {
  return client
    .from('communities')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id);
}
