// ============================================
// Corcentric Auto-Submit
//
// Fire-and-forget Corcentric submission triggered
// after successful OCR processing. Called from the
// upload and email handlers when a supplier has
// auto-submit enabled and the invoice passes
// confidence thresholds.
// ============================================

import { SupabaseClient } from '@supabase/supabase-js';
import { mapInvoiceToCorRequest, validateCorRequest } from './mapper';
import { serializeCorRequest } from './serializer';
import { submitToCorcentricApi, corStatusToSubmissionStatus } from './client';
import { insertSubmission, updateSubmission } from '../db/submission-queries';
import { resolveCorCustomerCodeByName, resolveCorcentricCredentials } from '../db/queries';
import { resolveMappingConfig, buildConfigFromLegacy } from './mapping-config';
import type { SupplierCorcentricConfig, CorMappingConfig } from './types';

export interface AutoSubmitConfig {
  /** Supabase service client (bypasses RLS) */
  serviceClient: SupabaseClient;
  /** R2 bucket for fetching invoice PDFs (for corBaseImage) */
  r2Bucket?: R2Bucket;
  /** Global fallback Corcentric API URL (used if supplier has no per-supplier URL) */
  apiUrl?: string;
  /** Global fallback Corcentric API username */
  apiUser?: string;
  /** Global fallback Corcentric API password */
  apiPass?: string;
}

export interface AutoSubmitInvoice {
  invoiceId: string;
  supplierId: string;
  invoiceData: Record<string, unknown>;
  supplier: Record<string, unknown>;
  /** R2 object key for the invoice PDF (for corBaseImage base64 encoding) */
  r2ObjectKey?: string;
}

/**
 * Resolve the primary supplier_communities row + its joined community.
 * Used by both eligibility check and submission so that per-community
 * vendor/customer codes are picked up from the join table when present,
 * falling back to legacy single-value columns on the supplier row during
 * the SUPPLIER-COMMUNITIES-REFACTOR transition.
 */
type SupplierCommunityRow = {
  community_id?: string;
  cor_vendor_code?: string | null;
  cor_customer_code?: string | null;
  is_primary?: boolean;
  active?: boolean;
  communities?: Record<string, unknown> | null;
};
function pickPrimarySupplierCommunity(
  supplier: Record<string, unknown>,
): { join: SupplierCommunityRow | null; community: Record<string, unknown> | null } {
  const raw = supplier.supplier_communities;
  const rows: SupplierCommunityRow[] = Array.isArray(raw)
    ? (raw as SupplierCommunityRow[]).filter((r) => r?.active !== false)
    : [];
  const join = rows.find((r) => r.is_primary) || rows[0] || null;
  const community =
    (join?.communities as Record<string, unknown> | null) ||
    ((supplier.communities as Record<string, unknown> | null) ?? null);
  return { join, community };
}

/**
 * Check if a supplier is eligible for auto-submission.
 */
export function isAutoSubmitEligible(supplier: Record<string, unknown>, globalConfig?: AutoSubmitConfig): boolean {
  const { join, community } = pickPrimarySupplierCommunity(supplier);
  const vendorCode = join?.cor_vendor_code || supplier.cor_vendor_code;
  const customerCode = join?.cor_customer_code || supplier.cor_customer_code;
  const communityCode = community?.code || supplier.cor_community_code;

  // Check credentials at community level first, then supplier (legacy), then global.
  // RSK-01: credentials live encrypted as *_enc bytea. We can't decrypt in a
  // sync helper (RPC required) — presence check is sufficient here; actual
  // decryption happens on the submission path via resolveCorcentricCredentials.
  const hasCredentials =
    (!!community?.cor_username_enc && !!community?.cor_password_enc) ||
    (!!supplier.cor_username_enc && !!supplier.cor_password_enc) ||
    (!!globalConfig?.apiUser && !!globalConfig?.apiPass);

  return (
    supplier.cor_ingestion_enabled === true &&
    !!vendorCode &&
    !!customerCode &&
    !!communityCode &&
    hasCredentials
  );
}

/**
 * Fire-and-forget Corcentric submission.
 *
 * This is designed to be called with ctx.waitUntil() so it runs
 * in the background without blocking the response to the user.
 *
 * It handles its own errors — never throws.
 */
export async function autoSubmitToCorentric(
  invoice: AutoSubmitInvoice,
  config: AutoSubmitConfig,
): Promise<void> {
  const { invoiceId, supplierId, invoiceData, supplier } = invoice;

  try {
    console.log(`[Corcentric Auto-Submit] Starting for invoice ${invoiceId}`);

    // Resolve customer code by name matching against customers table.
    // Priority: ShipToName → BillToName → supplier default
    const invData = invoiceData as Record<string, unknown>;
    const ocrShipToName = String(invData?.ShipToName || '').trim();
    const ocrBillToName = String(invData?.BillToName || '').trim();
    let resolvedCustomerCode = '';

    if (!resolvedCustomerCode && ocrShipToName) {
      const looked = await resolveCorCustomerCodeByName(config.serviceClient, ocrShipToName, supplierId);
      if (looked) resolvedCustomerCode = looked;
    }

    if (!resolvedCustomerCode && ocrBillToName) {
      const looked = await resolveCorCustomerCodeByName(config.serviceClient, ocrBillToName, supplierId);
      if (looked) resolvedCustomerCode = looked;
    }

    // Resolve community + vendor/customer codes from the supplier_communities
    // join (primary row). Legacy supplier.cor_* columns are the fallback
    // during the refactor transition.
    const { join: primaryJoin, community: communityRec } =
      pickPrimarySupplierCommunity(supplier);

    if (!resolvedCustomerCode) {
      resolvedCustomerCode = String(
        primaryJoin?.cor_customer_code || supplier.cor_customer_code || '',
      );
    }

    // Build supplier config
    const corConfig: SupplierCorcentricConfig = {
      corVendorCode: String(primaryJoin?.cor_vendor_code || supplier.cor_vendor_code || ''),
      corCustomerCode: resolvedCustomerCode,
      corCommunityCode: String(communityRec?.code || supplier.cor_community_code || ''),
      defaultTransactionType: String(supplier.cor_transaction_type || 'P') as SupplierCorcentricConfig['defaultTransactionType'],
      defaultCurrencyCode: String(supplier.cor_currency_code || 'USD') as SupplierCorcentricConfig['defaultCurrencyCode'],
    };

    // Resolve mapping config: prefer cor_mapping_config, fall back to legacy columns
    const mappingConfig: CorMappingConfig = resolveMappingConfig(
      (supplier.cor_mapping_config as Partial<CorMappingConfig>) || buildConfigFromLegacy(supplier)
    );

    // Resolve credentials: community → supplier (legacy) → global fallback.
    // RSK-01: decrypts *_enc bytea columns via decrypt_credential RPC.
    const resolved = await resolveCorcentricCredentials(config.serviceClient, {
      community: communityRec,
      supplier,
      envApiUrl: config.apiUrl,
      envApiUser: config.apiUser,
      envApiPass: config.apiPass,
    });
    const resolvedApiUrl = resolved.apiUrl;
    const resolvedApiUser = resolved.apiUser;
    const resolvedApiPass = resolved.apiPass;

    if (!resolvedApiUrl || !resolvedApiUser || !resolvedApiPass) {
      console.warn(`[Corcentric Auto-Submit] No API credentials for community/supplier ${supplierId}, skipping`);
      return;
    }

    // Map → validate → serialize
    const corRequest = mapInvoiceToCorRequest(invoiceData, {
      username: resolvedApiUser,
      password: resolvedApiPass,
      supplierConfig: corConfig,
      mappingConfig,
      requestId: `AUTO-${invoiceId}-${Date.now()}`,
    });

    // Attach PDF as base64 image if R2 bucket and key available
    if (config.r2Bucket && invoice.r2ObjectKey) {
      try {
        const pdfObject = await config.r2Bucket.get(invoice.r2ObjectKey);
        if (pdfObject) {
          const pdfBytes = await pdfObject.arrayBuffer();
          const uint8 = new Uint8Array(pdfBytes);
          let binary = '';
          for (let i = 0; i < uint8.length; i++) {
            binary += String.fromCharCode(uint8[i]);
          }
          corRequest.corRequest.corBaseImage = btoa(binary);
          console.log(`[Corcentric Auto-Submit] Attached PDF base64 (${Math.round(pdfBytes.byteLength / 1024)} KB)`);
        }
      } catch (pdfErr) {
        console.warn(`[Corcentric Auto-Submit] Failed to fetch PDF for base64:`, pdfErr);
      }
    }

    const validation = validateCorRequest(corRequest);
    if (!validation.valid) {
      console.warn(`[Corcentric Auto-Submit] Validation failed for ${invoiceId}:`, validation.errors);

      // Log the failed attempt
      await insertSubmission(config.serviceClient, {
        invoice_id: invoiceId,
        supplier_id: supplierId,
        request_xml: '',
        status: 'invalid',
        attempt_number: 1,
        is_dry_run: false,
        submitted_by: null,
      });
      return;
    }

    const xml = serializeCorRequest(corRequest, false);

    // Create submission record
    const { data: submission } = await insertSubmission(config.serviceClient, {
      invoice_id: invoiceId,
      supplier_id: supplierId,
      request_xml: xml,
      status: 'submitted',
      attempt_number: 1,
      is_dry_run: false,
      submitted_by: null,
    });

    if (!submission) {
      console.error(`[Corcentric Auto-Submit] Failed to create submission record for ${invoiceId}`);
      return;
    }

    // Submit to Corcentric
    const result = await submitToCorcentricApi(xml, { apiUrl: resolvedApiUrl });

    if (!result.httpSuccess && !result.response) {
      await updateSubmission(config.serviceClient, submission.id, {
        status: 'failed',
        error_message: result.error || `HTTP ${result.httpStatus}`,
        response_xml: result.responseXml || null,
        completed_at: new Date().toISOString(),
      });
      console.error(`[Corcentric Auto-Submit] Failed for ${invoiceId}: ${result.error}`);
      return;
    }

    const corResponse = result.response;
    const submissionStatus = corResponse
      ? corStatusToSubmissionStatus(corResponse.corResponseStatusCode)
      : 'failed';

    await updateSubmission(config.serviceClient, submission.id, {
      status: submissionStatus,
      response_xml: result.responseXml,
      cor_status_code: corResponse?.corResponseStatusCode ?? null,
      cor_response_id: corResponse?.corResponseID ?? null,
      cor_messages: corResponse?.corResponseMessages ?? [],
      completed_at: new Date().toISOString(),
    });

    // Auto-update invoice status to 'submitted' on successful transmission
    const isSuccess = submissionStatus === 'success' || submissionStatus === 'warning';
    if (isSuccess) {
      await config.serviceClient
        .from('invoices')
        .update({ status: 'submitted' })
        .eq('id', invoiceId);
      console.log(`[Corcentric Auto-Submit] Invoice ${invoiceId} status updated to 'submitted'`);
    }

    console.log(`[Corcentric Auto-Submit] Completed for ${invoiceId}: ${submissionStatus} (${result.durationMs}ms)`);
  } catch (err) {
    console.error(`[Corcentric Auto-Submit] Unexpected error for ${invoiceId}:`, err);
  }
}
