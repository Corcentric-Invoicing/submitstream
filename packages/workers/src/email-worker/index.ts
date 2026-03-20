// ============================================
// Email Ingestion Worker
// Receives emails via Cloudflare Email Routing,
// extracts PDF attachments, and triggers OCR pipeline
// ============================================

import PostalMime from 'postal-mime';
import { createClient } from '@supabase/supabase-js';
import { processInvoicePDF } from '../ocr-pipeline';

export interface EmailWorkerEnv {
  INVOICE_PDFS: R2Bucket;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  MISTRAL_API_KEY: string;
  ANTHROPIC_API_KEY: string;
}

/**
 * Email Worker entry point.
 * Triggered by Cloudflare Email Routing when an email arrives
 * at *@corcentricinvoices.com
 */
export default {
  async email(message: ForwardableEmailMessage, env: EmailWorkerEnv): Promise<void> {
    const startTime = Date.now();
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Extract supplier code from recipient address
    // e.g., acme@corcentricinvoices.com → 'acme'
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
      // TODO: Send error reply to sender
      // "Your email was sent to an unrecognized address"
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

    // Parse MIME message to extract attachments
    const rawEmail = await new Response(message.raw).arrayBuffer();
    const parser = new PostalMime();
    const parsed = await parser.parse(rawEmail);

    // Filter for PDF attachments
    const pdfAttachments = (parsed.attachments || []).filter(
      (att) => att.mimeType === 'application/pdf'
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
      // TODO: Send error reply "No PDF attachment found"
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

      // Run OCR pipeline
      try {
        const ocrResult = await processInvoicePDF(pdfBytes, {
          MISTRAL_API_KEY: env.MISTRAL_API_KEY,
          ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
        });

        // Update invoice with OCR results
        const updateData: Record<string, unknown> = {
          status: ocrResult.status,
          confidence: ocrResult.confidence,
          ocr_provider: ocrResult.provider,
          invoice_data: ocrResult.data,
          ocr_raw_response: ocrResult.rawResponses,
          needs_supplier_review: ocrResult.status === 'rejected',
        };

        await supabase
          .from('invoices')
          .update(updateData)
          .eq('id', invoice.id);

        // Log OCR completion
        await logProcessingEvent(supabase, invoice.id, 'ocr_complete', {
          provider: ocrResult.provider,
          confidence_score: ocrResult.confidenceScore,
          confidence_level: ocrResult.confidence,
          status: ocrResult.status,
          issues: ocrResult.issues,
          processing_time_ms: ocrResult.processingTimeMs,
        });

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
