// ============================================
// CSV Export Handler
// Generates EDI-format CSV from extracted data
// ============================================

import { RequestContext } from '../types';
import { errorResponse } from '../middleware/response';
import { generateEDICSV } from '../../../../shared/src/utils/csv-export';
import { logAccess } from '../middleware/audit';
import { extractPathId, sanitizeFilename } from '../middleware/safeParse';
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
