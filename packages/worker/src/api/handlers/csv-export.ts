// ============================================
// CSV Export Handler
// Generates EDI-format CSV from extracted data.
// Two endpoints:
//   - GET  /api/invoices/:id/csv          → single invoice
//   - POST /api/invoices/export-csv       → bulk (body: {ids: [...]})
// ============================================

import { RequestContext } from '../types';
import { errorResponse } from '../middleware/response';
import { generateEDICSV } from '../../../shared/src/utils/csv-export';
import { logAccess } from '../middleware/audit';
import { extractPathId, sanitizeFilename, safeJsonBody } from '../middleware/safeParse';
import { getCachedScope } from '../middleware/auth';
import { getInvoiceFull } from '../db/queries';

/**
 * Export an invoice's extracted data as an EDI-formatted CSV file.
 *
 * @param request - HTTP request object
 * @param ctx - Shared RequestContext with database clients
 * @returns Response stream with CSV content
 * @throws 400 if invoice ID invalid or no extracted data
 * @throws 404 if invoice not found
 */
export async function exportInvoiceCsv(request: Request, ctx: RequestContext): Promise<Response> {
  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid invoice ID', 400);

  const { data: invoice, error } = await getInvoiceFull(ctx.userClient, id);
  if (error || !invoice) return errorResponse('Invoice not found', 404);
  if (!invoice.invoice_data) return errorResponse('Invoice has no extracted data yet', 400);

  const csv = generateEDICSV(invoice.invoice_data);

  // Audit: log CSV export (fire-and-forget)
  logAccess(ctx.serviceClient, ctx.userClient, request, 'csv_export', id);

  const safeName = sanitizeFilename(invoice.file_name.replace('.pdf', ''));

  return new Response(csv, {
    headers: {
      ...ctx.headers,
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="invoice_${safeName}.csv"`,
    },
  });
}

/**
 * Bulk-export multiple invoices as a single combined CSV.
 *
 * Body: { ids: string[] }  // array of invoice UUIDs to include
 *
 * Generates one header row + N data rows per invoice (one row per line item).
 * Scope-checked: each requested invoice must be visible to the caller —
 * silently skips any the caller doesn't own / can't see (no leaking IDs).
 *
 * Returns 400 if no IDs sent. Returns CSV download for everything that
 * passed the scope check, even if some IDs were excluded.
 */
export async function exportInvoicesBulkCsv(request: Request, ctx: RequestContext): Promise<Response> {
  const parsed = await safeJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data;

  const ids = Array.isArray(body?.ids) ? body.ids.filter((x: unknown) => typeof x === 'string') : [];
  if (ids.length === 0) return errorResponse('No invoice IDs provided', 400);

  // Cap to prevent runaway requests (1000 should be plenty for any realistic batch)
  if (ids.length > 1000) {
    return errorResponse('Bulk export limited to 1000 invoices per request', 400);
  }

  // Scope filtering: non-admin callers can only export their own scope.
  // We fetch with userClient so RLS applies — invoices outside scope just
  // come back as missing rows, which we silently drop from the export.
  const scope = await getCachedScope(ctx);

  const invoices: Array<{ id: string; invoice_data: Record<string, unknown>; file_name: string }> = [];
  for (const id of ids) {
    const { data, error } = await getInvoiceFull(ctx.userClient, id);
    if (error || !data || !data.invoice_data) continue; // skip — not visible or no extracted data

    // Belt-and-suspenders scope check (RLS should already cover this,
    // but for non-admin callers double-check supplier_id is in their scope)
    if (scope.supplierIds !== null && data.supplier_id && !scope.supplierIds.includes(data.supplier_id)) {
      continue;
    }

    invoices.push({
      id: data.id,
      invoice_data: data.invoice_data as Record<string, unknown>,
      file_name: data.file_name as string,
    });
  }

  if (invoices.length === 0) {
    return errorResponse('No exportable invoices found (check IDs and access scope)', 404);
  }

  // Build combined CSV — single header from first invoice, then data-rows
  // (header stripped) for each subsequent invoice.
  const csvParts: string[] = [];
  for (let i = 0; i < invoices.length; i++) {
    const csv = generateEDICSV(invoices[i].invoice_data);
    if (i === 0) {
      csvParts.push(csv);
    } else {
      // Drop the header (first line) for invoices 2..N
      const newlineIdx = csv.indexOf('\n');
      csvParts.push(newlineIdx >= 0 ? csv.slice(newlineIdx + 1) : '');
    }
  }
  const combinedCsv = csvParts.join('\n');

  // Audit: log one entry per invoice included (fire-and-forget)
  for (const inv of invoices) {
    logAccess(ctx.serviceClient, ctx.userClient, request, 'csv_export', inv.id, {
      bulk: true,
      batch_size: invoices.length,
    });
  }

  // Filename: include count + a timestamp so the user can tell exports apart
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `invoices_${invoices.length}_${ts}.csv`;

  return new Response(combinedCsv, {
    headers: {
      ...ctx.headers,
      'Content-Type': 'text/csv',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
