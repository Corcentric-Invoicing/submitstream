// ============================================
// Corcentric XML Export Handler (Dry-Run Mode)
//
// Generates Corcentric DMS XML from an invoice's
// extracted data for review before live submission.
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { extractPathId } from '../middleware/safeParse';
import { getInvoiceWithCorcentricConfig, resolveCorCustomerCodeByName } from '../db/queries';
import { mapInvoiceToCorRequest, validateCorRequest } from '../corcentric/mapper';
import { serializeCorRequest } from '../corcentric/serializer';
import { resolveMappingConfig, buildConfigFromLegacy } from '../corcentric/mapping-config';
import type { SupplierCorcentricConfig, CorMappingConfig } from '../corcentric/types';

/**
 * Generate Corcentric DMS XML for an invoice (dry-run / preview).
 *
 * Returns the XML as content-type text/xml with validation results.
 * Does NOT submit to Corcentric — this is for review only.
 *
 * Query params:
 *   ?format=json  → returns JSON with { xml, validation, invoice_id } instead of raw XML
 *
 * @param request - HTTP request object
 * @param ctx - Shared RequestContext
 * @returns XML response (or JSON with validation info)
 */
export async function previewCorcentricXml(request: Request, ctx: RequestContext): Promise<Response> {
  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid invoice ID', 400);

  // Fetch invoice + supplier Corcentric config
  const { data, error } = await getInvoiceWithCorcentricConfig(ctx.userClient, id);
  if (error || !data) return errorResponse('Invoice not found', 404);
  if (!data.invoice_data) return errorResponse('Invoice has no extracted data yet', 400);

  // Extract supplier config (Supabase returns joined FK as object or array)
  const rawSupplier = data.suppliers;
  const supplier = (Array.isArray(rawSupplier) ? rawSupplier[0] : rawSupplier) as Record<string, unknown> | null;
  if (!supplier) return errorResponse('Invoice has no associated supplier', 400);

  // ── Name-based customer code resolution (same logic as corcentric-submit) ──
  const invoiceData = data.invoice_data as Record<string, unknown>;
  const ocrShipToName = String(invoiceData?.ShipToName || '').trim();
  const ocrBillToName = String(invoiceData?.BillToName || '').trim();
  let resolvedCustomerCode = '';

  // 1. Try ShipToName match against customers table, scoped to this supplier
  const supplierId = String(supplier.id || '');
  if (!resolvedCustomerCode && ocrShipToName) {
    const looked = await resolveCorCustomerCodeByName(ctx.serviceClient, ocrShipToName, supplierId);
    if (looked) resolvedCustomerCode = looked;
  }
  // 2. Try BillToName match
  if (!resolvedCustomerCode && ocrBillToName) {
    const looked = await resolveCorCustomerCodeByName(ctx.serviceClient, ocrBillToName, supplierId);
    if (looked) resolvedCustomerCode = looked;
  }
  // 3. Fall back to supplier-level code (legacy)
  if (!resolvedCustomerCode) {
    resolvedCustomerCode = String(supplier.cor_customer_code || '');
  }

  const corConfig: SupplierCorcentricConfig = {
    corVendorCode: String(supplier.cor_vendor_code || ''),
    corCustomerCode: resolvedCustomerCode,
    corCommunityCode: String(supplier.cor_community_code || ''),
    defaultTransactionType: (String(supplier.cor_transaction_type || 'P') as SupplierCorcentricConfig['defaultTransactionType']),
    defaultCurrencyCode: (String(supplier.cor_currency_code || 'USD') as SupplierCorcentricConfig['defaultCurrencyCode']),
    corRemitCode: (supplier.cor_remit_code as string) || undefined,
    defaultFreightCode: (supplier.cor_freight_code as string) || undefined,
  };

  // Resolve mapping config: prefer cor_mapping_config, fall back to legacy columns
  const mappingConfig: CorMappingConfig = resolveMappingConfig(
    (supplier.cor_mapping_config as Partial<CorMappingConfig>) || buildConfigFromLegacy(supplier)
  );

  // Map OCR data → Corcentric request structure
  const corRequest = mapInvoiceToCorRequest(
    data.invoice_data as Record<string, unknown>,
    {
      // In dry-run mode, use placeholder credentials
      username: 'DRY_RUN_USER',
      password: 'DRY_RUN_PASS',
      supplierConfig: corConfig,
      mappingConfig,
      requestId: `PREVIEW-${id}`,
    },
  );

  // Validate the mapped request
  const validation = validateCorRequest(corRequest);

  // Serialize to XML
  const xml = serializeCorRequest(corRequest);

  // Return format based on query param
  const format = ctx.url.searchParams.get('format');
  if (format === 'json') {
    return jsonResponse({
      invoice_id: id,
      supplier_name: supplier.name,
      supplier_code: supplier.code,
      corcentric_enabled: supplier.cor_ingestion_enabled || false,
      resolved_config: {
        customer_code: resolvedCustomerCode,
        vendor_code: corConfig.corVendorCode,
        community_code: corConfig.corCommunityCode,
      },
      validation,
      xml,
      mapping_config_source: supplier.cor_mapping_config ? 'custom' : (supplier.cor_field_mapping ? 'legacy' : 'default'),
    });
  }

  // Return raw XML
  return new Response(xml, {
    status: validation.valid ? 200 : 422,
    headers: {
      ...ctx.headers,
      'Content-Type': 'text/xml; charset=utf-8',
      'Content-Disposition': `inline; filename="corcentric_${data.file_name?.replace('.pdf', '') || id}.xml"`,
      'X-Corcentric-Valid': String(validation.valid),
      'X-Corcentric-Errors': String(validation.errors.length),
      'X-Corcentric-Warnings': String(validation.warnings.length),
    },
  });
}
