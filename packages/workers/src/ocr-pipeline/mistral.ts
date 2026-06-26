// ============================================
// Mistral OCR 3 Integration
// Primary OCR provider for invoice extraction
// ============================================

import { EDI_EXTRACTION_SCHEMA } from '../../shared/src/utils/edi-schema';

export interface MistralOCRResult {
  success: boolean;
  data: Record<string, unknown> | null;
  rawResponse: unknown;
  processingTimeMs: number;
  error?: string;
}

/**
 * Process a PDF through Mistral OCR 3 with structured extraction.
 * Uses the annotations API to extract fields matching our EDI schema.
 *
 * API format: JSON body with base64 data URL, NOT FormData upload.
 * Response: document_annotation at top level (string that must be JSON-parsed).
 */
export async function extractWithMistral(
  pdfBytes: ArrayBuffer,
  apiKey: string,
  extractionTemplate?: string
): Promise<MistralOCRResult> {
  const startTime = Date.now();

  try {
    // Convert PDF to base64 data URL
    const uint8Array = new Uint8Array(pdfBytes);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const pdfBase64 = btoa(binary);

    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'mistral-ocr-latest',
        document: {
          type: 'document_url',
          document_url: `data:application/pdf;base64,${pdfBase64}`,
        },
        document_annotation_format: {
          type: 'json_schema',
          json_schema: {
            name: 'edi_invoice',
            schema: EDI_EXTRACTION_SCHEMA,
          },
        },
        // Supplier-specific extraction hints improve field mapping accuracy
        ...(extractionTemplate ? {
          document_annotation_prompt: `You are extracting invoice data into a structured EDI format. All dates must be YYYYMMDD. All monetary amounts must be plain numbers without currency symbols.\n\nIMPORTANT — Subtotal vs Discountable Amount:\n• Write the visible "Subtotal" / "Sub-total" / "Net amount" / "Net total" line to the \`Subtotal\` field. This is the standard pre-tax sum of line items.\n• Write to \`DiscountableAmount\` ONLY when the invoice explicitly labels a "discountable amount" or shows a separate amount eligible for an early-payment discount. Do NOT use DiscountableAmount as a generic subtotal.\n• Most invoices have Subtotal but no DiscountableAmount.\n\nSUPPLIER-SPECIFIC EXTRACTION GUIDE:\n${extractionTemplate}`
        } : {
          document_annotation_prompt: 'You are extracting invoice data into a structured EDI format. All dates must be in YYYYMMDD format (e.g., 20240215). All monetary amounts must be plain numbers without currency symbols or commas. Empty or missing fields should be empty strings.\n\nIMPORTANT — Subtotal vs Discountable Amount:\n• Write the visible "Subtotal" / "Sub-total" / "Net amount" / "Net total" line to the `Subtotal` field. This is the standard pre-tax sum of line items.\n• Write to `DiscountableAmount` ONLY when the invoice explicitly labels a "discountable amount" or shows a separate amount eligible for an early-payment discount. Do NOT use DiscountableAmount as a generic subtotal.\n• Most invoices have Subtotal but no DiscountableAmount.\n\nIMPORTANT: Look carefully for tracking numbers (UPS tracking starts with 1Z, FedEx is 12-34 digits, etc.) — they may appear near shipping details or in a separate section labeled "Tracking Number", "Tracking #", or "Tracking No".'
        }),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        data: null,
        rawResponse: errorText,
        processingTimeMs: Date.now() - startTime,
        error: `Mistral API error ${response.status}: ${errorText}`,
      };
    }

    const result = await response.json() as Record<string, unknown>;

    // document_annotation is at the top level of the response as a JSON string
    let extractedData: Record<string, unknown> | null = null;

    if (result.document_annotation) {
      try {
        // document_annotation is returned as a JSON string — parse it
        if (typeof result.document_annotation === 'string') {
          extractedData = JSON.parse(result.document_annotation);
        } else {
          // Already an object
          extractedData = result.document_annotation as Record<string, unknown>;
        }
      } catch (parseError) {
        console.error('[OCR] Failed to parse document_annotation:', parseError);
      }
    }

    // Fallback: check inside pages array (some API versions)
    if (!extractedData && result.pages && Array.isArray(result.pages)) {
      const pages = result.pages as Array<Record<string, unknown>>;
      for (const page of pages) {
        if (page.document_annotation) {
          try {
            extractedData = typeof page.document_annotation === 'string'
              ? JSON.parse(page.document_annotation)
              : page.document_annotation as Record<string, unknown>;
            break;
          } catch { /* continue */ }
        }
      }
    }

    return {
      success: !!extractedData,
      data: extractedData,
      rawResponse: result,
      processingTimeMs: Date.now() - startTime,
      error: extractedData ? undefined : 'No structured annotation found in response',
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      rawResponse: null,
      processingTimeMs: Date.now() - startTime,
      error: `Mistral OCR error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
