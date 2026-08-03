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

// Shared extraction prompts — kept as constants so the file-upload + base64
// paths share a single source of truth. Trimmed to single-string concat
// instead of inline ternary for readability.
const BASE_PROMPT =
  'You are extracting invoice data into a structured EDI format. ' +
  'All dates must be in YYYYMMDD format (e.g., 20240215). All monetary amounts must be plain numbers without currency symbols or commas. ' +
  'Empty or missing fields should be empty strings.\n\n' +
  'IMPORTANT — Subtotal vs Discountable Amount:\n' +
  '• Write the visible "Subtotal" / "Sub-total" / "Net amount" / "Net total" line to the `Subtotal` field. ' +
  'This is the standard pre-tax sum of line items.\n' +
  '• Write to `DiscountableAmount` ONLY when the invoice explicitly labels a "discountable amount" or shows a separate amount eligible for an early-payment discount. ' +
  'Do NOT use DiscountableAmount as a generic subtotal.\n' +
  '• Most invoices have Subtotal but no DiscountableAmount.\n\n' +
  'IMPORTANT: Look carefully for tracking numbers (UPS tracking starts with 1Z, FedEx is 12-34 digits, etc.) — ' +
  'they may appear near shipping details or in a separate section labeled "Tracking Number", "Tracking #", or "Tracking No".';

function buildPrompt(extractionTemplate?: string): string {
  if (!extractionTemplate) return BASE_PROMPT;
  return `${BASE_PROMPT}\n\nSUPPLIER-SPECIFIC EXTRACTION GUIDE:\n${extractionTemplate}`;
}

/**
 * Upload a PDF to Mistral's Files API and get a signed URL that can be
 * passed to /v1/ocr as a `document_url`. This is the recommended path for
 * larger or structurally-unusual PDFs that fail the inline `data:base64`
 * approach (seen on legacy ERP-exported invoices like the Fedrigoni format).
 *
 * Returns the signed URL, OR throws with a descriptive error.
 */
export async function uploadPdfAndGetSignedUrl(pdfBytes: ArrayBuffer, apiKey: string): Promise<string> {
  // Step 1: POST /v1/files (multipart) — purpose=ocr is the documented value
  // for OCR file uploads (other valid values: fine-tune, batch).
  const form = new FormData();
  form.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'invoice.pdf');
  form.append('purpose', 'ocr');

  const uploadRes = await fetch('https://api.mistral.ai/v1/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` }, // intentionally no Content-Type — fetch sets multipart boundary
    body: form,
  });
  if (!uploadRes.ok) {
    throw new Error(`Mistral file upload failed (HTTP ${uploadRes.status}): ${await uploadRes.text()}`);
  }
  const uploadData = (await uploadRes.json()) as { id?: string };
  const fileId = uploadData.id;
  if (!fileId) throw new Error('Mistral file upload returned no file id');

  // Step 2: GET /v1/files/{id}/url — returns a time-limited signed URL.
  // Default expiry 24h; we use it immediately so any expiry is fine.
  const urlRes = await fetch(`https://api.mistral.ai/v1/files/${encodeURIComponent(fileId)}/url`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!urlRes.ok) {
    throw new Error(`Mistral signed-URL fetch failed (HTTP ${urlRes.status}): ${await urlRes.text()}`);
  }
  const urlData = (await urlRes.json()) as { url?: string };
  if (!urlData.url) throw new Error('Mistral signed-URL response missing url field');
  return urlData.url;
}

/**
 * Process a PDF through Mistral OCR 4 with structured extraction.
 * Uses the annotations API to extract fields matching our EDI schema.
 *
 * Transport: 3-step file-upload flow (POST /v1/files → GET /v1/files/:id/url
 * → POST /v1/ocr with document_url). Previously sent the PDF as a base64
 * `data:` URI in the OCR call, but that path failed deterministically on
 * some legacy-ERP-exported PDFs (Fedrigoni IVPR* format, HTTP 500
 * "Service unavailable"). File upload is more robust for unusual PDF
 * structures. Cost is the same — files auto-expire ~24h, no cleanup
 * required.
 *
 * Response: document_annotation at top level (string that must be JSON-parsed).
 */
export async function extractWithMistral(
  pdfBytes: ArrayBuffer,
  apiKey: string,
  extractionTemplate?: string
): Promise<MistralOCRResult> {
  const startTime = Date.now();

  try {
    // Step 1+2: upload PDF and resolve a signed URL Mistral OCR can fetch
    const signedUrl = await uploadPdfAndGetSignedUrl(pdfBytes, apiKey);

    // Step 3: call OCR with the signed URL (instead of base64 data URI)
    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Pinned to OCR 4 explicitly (not `mistral-ocr-latest`) so we're
        // guaranteed to be on the model that supports block extraction
        // (paragraph-level bboxes + structural labels). Bump when Mistral
        // ships OCR 5+. Docs: https://docs.mistral.ai/studio-api/document-processing/basic_ocr
        model: 'mistral-ocr-4-0',
        document: {
          type: 'document_url',
          document_url: signedUrl,
        },
        document_annotation_format: {
          type: 'json_schema',
          json_schema: {
            name: 'edi_invoice',
            schema: EDI_EXTRACTION_SCHEMA,
          },
        },
        document_annotation_prompt: buildPrompt(extractionTemplate),
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
