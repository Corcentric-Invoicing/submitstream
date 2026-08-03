// ============================================
// Customer-match candidate handler
//
// GET /api/invoices/:id/customer-candidates
//   Re-runs the matcher against the invoice's stored BillTo block
//   and returns the current top-N candidates.  Called by the review
//   UI banner when an invoice has needs_customer_review=true.
//
// Why re-run rather than cache: the customers table changes between
// pull time and review time (the reviewer may have just created a
// new customer from a sibling invoice).  A fresh match gives the
// banner the same view the matcher would have produced if the
// invoice arrived right now.
// ============================================

import { RequestContext } from '../types';
import { jsonResponse, errorResponse } from '../middleware/response';
import { extractPathId } from '../middleware/safeParse';
import { requireAdmin } from '../middleware/auth';
import { matchCustomer, extractBillTo } from '../customers/match';

export async function getCustomerCandidatesHandler(
  request: Request,
  ctx: RequestContext,
): Promise<Response> {
  const { authorized } = await requireAdmin(ctx.env, ctx.authHeader);
  if (!authorized) return errorResponse('Admin access required', 403);

  // Path is /api/invoices/:id/customer-candidates — extractPathId
  // pulls the :id segment.
  const id = extractPathId(ctx.path);
  if (!id) return errorResponse('Invalid invoice ID', 400);

  const { data: invoice, error } = await ctx.serviceClient
    .from('invoices')
    .select('id, supplier_id, invoice_data, customer_id, customer_match_confidence, needs_customer_review')
    .eq('id', id)
    .single();

  if (error || !invoice) return errorResponse('Invoice not found', 404);
  if (!invoice.supplier_id) return errorResponse('Invoice has no supplier; cannot match', 400);

  // extractBillTo handles both the flat OCR shape and the nested
  // PromoStandards shape transparently — caller gets a consistent
  // object back regardless of which ingestion path produced the row.
  const billTo = extractBillTo(invoice.invoice_data);
  const result = await matchCustomer(ctx.serviceClient, {
    supplierId: invoice.supplier_id as string,
    billToName: billTo.name,
    billToCode: billTo.code || undefined,
    billToZip:  billTo.zip  || undefined,
  });

  return jsonResponse({
    invoice_id: id,
    currently_linked_customer_id: invoice.customer_id,
    currently_needs_review: invoice.needs_customer_review,
    match: result,
    bill_to_extracted: {
      name:     billTo.name     || null,
      address1: billTo.address1 || null,
      address2: billTo.address2 || null,
      city:     billTo.city     || null,
      state:    billTo.state    || null,
      zip:      billTo.zip      || null,
    },
  });
}
