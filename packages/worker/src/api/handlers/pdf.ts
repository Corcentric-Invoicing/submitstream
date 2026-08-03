// ============================================
// PDF Viewer Handler
// Streams invoice PDFs from R2 to the portal
// ============================================

import { RequestContext } from '../types';
import { errorResponse } from '../middleware/response';
import { logAccess } from '../middleware/audit';
import { extractPathId } from '../middleware/safeParse';
import { getInvoiceR2Key } from '../db/queries';

/**
 * Stream the original invoice PDF from R2 storage to the client.
 *
 * @param request - HTTP request object
 * @param ctx - Shared RequestContext with R2 bucket and database clients
 * @returns Response stream with PDF content and application/pdf Content-Type
 * @throws 400 if invoice ID is invalid
 * @throws 404 if invoice not found in database or PDF not found in R2 storage
 */
export async function getInvoicePdf(request: Request, ctx: RequestContext): Promise<Response> {
  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid invoice ID', 400);

  const { data: invoice, error } = await getInvoiceR2Key(ctx.userClient, id);
  if (error || !invoice) return errorResponse('Invoice not found', 404);

  const object = await ctx.env.INVOICE_PDFS.get(invoice.r2_object_key);
  if (!object) return errorResponse('PDF not found in storage', 404);

  // Audit: log PDF download (fire-and-forget)
  logAccess(ctx.serviceClient, ctx.userClient, request, 'pdf_download', id);

  return new Response(object.body, {
    headers: {
      ...ctx.headers,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="invoice.pdf"',
    },
  });
}
