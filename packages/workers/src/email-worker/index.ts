// ============================================
// Email Ingestion Worker
// Receives emails via Cloudflare Email Routing,
// extracts PDF attachments, and triggers OCR pipeline
// ============================================

import PostalMime from 'postal-mime';
import { createClient } from '@supabase/supabase-js';
import { processInvoicePDF } from '../ocr-pipeline';
import { postProcessInvoiceData } from '../ocr-pipeline/post-process';
import { replyUnknownSupplier, replyNoPdfAttachment, replyInvoiceReceived } from './reply';
import { matchCustomer, extractBillTo, matchShipTo, extractShipTo } from '../api/customers/match';

export interface EmailWorkerEnv {
  INVOICE_PDFS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MISTRAL_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  RESEND_API_KEY?: string;
}

/**
 * Email Worker entry point.
 * Triggered by Cloudflare Email Routing when an email arrives
 * at *@submitstream.com
 */
export default {
  async email(message: ForwardableEmailMessage, env: EmailWorkerEnv): Promise<void> {
    const startTime = Date.now();
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Extract supplier code from recipient address
    // e.g., acme@submitstream.com → 'acme'
    const recipientAddress = message.to;
    const emailPrefix = recipientAddress.split('@')[0].toLowerCase();
    const senderEmail = message.from;

    console.log(`[Email] Received from ${senderEmail} to ${recipientAddress} (prefix: ${emailPrefix})`);

    // Look up supplier by email prefix
    const { data: supplier, error: supplierError } = await supabase
      .from('suppliers')
      .select('*')
      .eq('email_prefix', emailPrefix)
      .eq('active', true)
      .single();

    if (supplierError || !supplier) {
      console.error(`[Email] Unknown supplier prefix: ${emailPrefix}`);
      if (env.RESEND_API_KEY) {
        await replyUnknownSupplier(env.RESEND_API_KEY, senderEmail, recipientAddress);
      }
      await logProcessingEvent(supabase, null, 'email_rejected', {
        reason: 'unknown_supplier',
        email_prefix: emailPrefix,
        sender: senderEmail,
      });
      // Reject the email
      message.setReject('Unknown recipient address');
      return;
    }

    console.log(`[Email] Matched supplier: ${supplier.name} (${supplier.code})`);

    // Verify sender is allowed for this supplier
    const senderDomain = senderEmail.split('@')[1]?.toLowerCase() || '';
    const senderLower = senderEmail.toLowerCase();
    const allowedDomains: string[] = supplier.allowed_sender_domains || [];
    const allowedEmails: string[] = supplier.allowed_sender_emails || [];

    // If either whitelist is populated, sender must match at least one entry
    const hasWhitelist = allowedDomains.length > 0 || allowedEmails.length > 0;
    if (hasWhitelist) {
      const domainMatch = allowedDomains.some(d => senderDomain === d.toLowerCase());
      const emailMatch = allowedEmails.some(e => senderLower === e.toLowerCase());

      if (!domainMatch && !emailMatch) {
        console.warn(`[Email] Sender ${senderEmail} not authorized for supplier ${supplier.code}`);
        await logProcessingEvent(supabase, null, 'email_rejected', {
          reason: 'unauthorized_sender',
          sender: senderEmail,
          sender_domain: senderDomain,
          supplier_code: supplier.code,
          allowed_domains: allowedDomains,
        });
        message.setReject('Sender not authorized for this supplier');
        return;
      }
    }
    // If no whitelist configured, accept all senders (backwards compatible)

    // Parse MIME message to extract attachments
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parser = new PostalMime();
    const parsed = await parser.parse(rawEmail);

    // Filter for PDF attachments — match by MIME type OR .pdf file extension
    // Some email clients send PDFs as application/octet-stream
    const pdfAttachments = (parsed.attachments || []).filter(
      (att) =>
        att.mimeType === 'application/pdf' ||
        (att.filename && att.filename.toLowerCase().endsWith('.pdf'))
    );

    if (pdfAttachments.length === 0) {
      console.error('[Email] No PDF attachments found');
      await logProcessingEvent(supabase, null, 'email_rejected', {
        reason: 'no_pdf_attachment',
        sender: senderEmail,
        supplier_code: supplier.code,
        attachment_count: parsed.attachments?.length || 0,
        attachment_types: parsed.attachments?.map(a => a.mimeType) || [],
      });
      if (env.RESEND_API_KEY) {
        await replyNoPdfAttachment(env.RESEND_API_KEY, senderEmail, supplier.name);
      }
      return;
    }

    // Process each PDF attachment
    for (const attachment of pdfAttachments) {
      const fileName = attachment.filename || `invoice_${Date.now()}.pdf`;
      const pdfBytes = attachment.content;

      console.log(`[Email] Processing attachment: ${fileName} (${pdfBytes.byteLength} bytes)`);

      // Store PDF in R2
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const r2Key = `invoices/${supplier.code}/${timestamp}_${fileName}`;

      await env.INVOICE_PDFS.put(r2Key, pdfBytes, {
        customMetadata: {
          supplier_code: supplier.code,
          sender_email: senderEmail,
          original_filename: fileName,
          received_at: new Date().toISOString(),
        },
      });

      console.log(`[Email] Stored PDF in R2: ${r2Key}`);

      // Create invoice record in Supabase (status: processing)
      const { data: invoice, error: insertError } = await supabase
        .from('invoices')
        .insert({
          supplier_id: supplier.id,
          file_name: fileName,
          r2_object_key: r2Key,
          status: 'processing',
          source: 'email',
          source_email: senderEmail,
          invoice_data: {},
          is_test: supplier.test_mode === true,
        })
        .select()
        .single();

      if (insertError || !invoice) {
        console.error('[Email] Failed to create invoice record:', insertError);
        continue;
      }

      // Log receipt
      await logProcessingEvent(supabase, invoice.id, 'email_received', {
        supplier_code: supplier.code,
        file_name: fileName,
        file_size: pdfBytes.byteLength,
        sender: senderEmail,
      });

      // Send receipt confirmation to sender
      if (env.RESEND_API_KEY) {
        // Fire-and-forget — don't block OCR on email delivery
        replyInvoiceReceived(env.RESEND_API_KEY, senderEmail, {
          fileName,
          supplierName: supplier.name,
        }).catch(err => console.warn('[Email] Receipt confirmation failed:', err));
      }

      // Run OCR pipeline
      try {
        const ocrResult = await processInvoicePDF(pdfBytes, {
          MISTRAL_API_KEY: env.MISTRAL_API_KEY,
          ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        }, {
          extractionTemplate: supplier.extraction_template || undefined,
        });

        // Post-process: apply systematic field defaults and enrichment
        const enrichedData = await postProcessInvoiceData(
          ocrResult.data as Record<string, unknown>,
          {
            supplier: {
              code: supplier.code,
              vendor_code_override: supplier.vendor_code_override || undefined,
              remit_to_code: supplier.remit_to_code || undefined,
            },
          }
        );

        // Resolve the BillTo against the customers table.  Two-pass
        // match (supplier-specific code → fuzzy name).  When the top
        // candidate clears AUTO_LINK_THRESHOLD we auto-link; otherwise
        // we flag the invoice for review and surface the candidate
        // list in the UI banner.  A null billToName short-circuits to
        // "no match, needs review".
        //
        // extractBillTo() handles both the flat OCR shape (BillToName
        // at top level) and the nested PromoStandards shape
        // (billTo.Name), so this same hook works across ingestion
        // paths.
        const billTo = extractBillTo(enrichedData);
        const matchResult = await matchCustomer(supabase, {
          supplierId: supplier.id,
          billToName: billTo.name,
          billToCode: billTo.code || undefined,
          billToZip:  billTo.zip  || undefined,
        });

        // Ship-to resolution. Only meaningful once the customer is
        // resolved — without a customer_id we can't know which pool of
        // ship-to addresses to compare against. If the customer match
        // succeeded, look for a matching ship-to row; if no confident
        // match, flag for review so the portal banner surfaces it.
        let shipToId: string | null = null;
        let needsShipToReview = false;
        let shipToMatchConfidence = 0;
        if (matchResult.customerId) {
          const shipTo = extractShipTo(enrichedData);
          const shipToResult = await matchShipTo(
            supabase,
            matchResult.customerId,
            shipTo,
          );
          shipToId = shipToResult.shipToId;
          shipToMatchConfidence = shipToResult.confidence;
          // Flag for review when there's extracted ship-to data but no
          // confident link. A truly empty ship-to (rare — invoices
          // almost always have one) skips review entirely.
          needsShipToReview = !shipToResult.empty && shipToResult.shipToId === null;
        }

        // Update invoice with OCR results + post-processing enrichment
        // + customer-match outcome.
        const updateData: Record<string, unknown> = {
          status: ocrResult.status,
          confidence: ocrResult.confidence,
          ocr_provider: ocrResult.provider,
          invoice_data: enrichedData,
          ocr_raw_response: ocrResult.rawResponses,
          needs_supplier_review: ocrResult.status === 'rejected',
          customer_id: matchResult.customerId,
          customer_match_confidence: matchResult.confidence,
          // needs_customer_review is independent of needs_supplier_review —
          // an invoice can be clean on the OCR side but still need a
          // human to pick or create the right customer.
          needs_customer_review: matchResult.customerId === null,
          // Ship-to outcome (mirrors customer review pattern).
          ship_to_id: shipToId,
          needs_ship_to_review: needsShipToReview,
        };

        await supabase
          .from('invoices')
          .update(updateData)
          .eq('id', invoice.id);

        // Log the customer-match outcome so the review history carries
        // a breadcrumb of which pass (code / name / none) resolved.
        await logProcessingEvent(supabase, invoice.id, 'customer_match', {
          method: matchResult.method,
          confidence: matchResult.confidence,
          auto_linked: matchResult.customerId !== null,
          candidate_count: matchResult.candidates.length,
          top_candidate: matchResult.candidates[0]
            ? { id: matchResult.candidates[0].id, name: matchResult.candidates[0].name, similarity: matchResult.candidates[0].similarity }
            : null,
        });

        // Log ship-to-match outcome only when the customer was resolved.
        // Skipped for unresolved customers because there's no pool to
        // compare against.
        if (matchResult.customerId) {
          await logProcessingEvent(supabase, invoice.id, 'ship_to_match', {
            confidence: shipToMatchConfidence,
            auto_linked: shipToId !== null,
            needs_review: needsShipToReview,
          });
        }

        // Log OCR completion
        await logProcessingEvent(supabase, invoice.id, 'ocr_complete', {
          provider: ocrResult.provider,
          confidence_score: ocrResult.confidenceScore,
          confidence_level: ocrResult.confidence,
          status: ocrResult.status,
          issues: ocrResult.issues,
          processing_time_ms: ocrResult.processingTimeMs,
        });

        // Log post-processing rules that fired
        const appliedRules = (enrichedData._postProcessRules as string[]) || [];
        if (appliedRules.length > 0) {
          await logProcessingEvent(supabase, invoice.id, 'post_process_applied', {
            rules_applied: appliedRules,
            rules_count: appliedRules.length,
          });
        }

        console.log(`[Email] Invoice processed: ${invoice.id} → ${ocrResult.status} (${ocrResult.confidence}, ${ocrResult.provider})`);

      } catch (ocrError) {
        console.error('[Email] OCR pipeline error:', ocrError);

        // Mark as pending for manual review
        await supabase
          .from('invoices')
          .update({
            status: 'pending',
            confidence: 'low',
          })
          .eq('id', invoice.id);

        await logProcessingEvent(supabase, invoice.id, 'ocr_failed', {
          error: ocrError instanceof Error ? ocrError.message : String(ocrError),
        });
      }
    }

    console.log(`[Email] Processing complete in ${Date.now() - startTime}ms`);
  },
};

// Helper: log processing events
async function logProcessingEvent(
  supabase: ReturnType<typeof createClient>,
  invoiceId: string | null,
  event: string,
  metadata: Record<string, unknown>
): Promise<void> {
  try {
    await supabase.from('processing_log').insert({
      invoice_id: invoiceId,
      event,
      provider: metadata.provider as string || null,
      confidence_score: metadata.confidence_score as number || null,
      processing_time_ms: metadata.processing_time_ms as number || null,
      error_message: metadata.error as string || null,
      metadata,
    });
  } catch (error) {
    console.error('[Log] Failed to write processing log:', error);
  }
}
