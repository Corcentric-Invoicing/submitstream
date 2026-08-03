// ============================================
// Pixtral Vision Extraction (Mistral fallback tier 1)
//
// When Mistral's dedicated OCR endpoint (/v1/ocr) fails or returns low
// confidence — typically on legacy-ERP-exported PDFs that the OCR parser
// can't structure — we try Pixtral via /v1/chat/completions. Pixtral is
// Mistral's multimodal vision LLM; it "sees" the PDF visually rather than
// parsing the text layer, so it can handle documents where the OCR API
// gives up. Same MISTRAL_API_KEY, same free tier — no additional cost.
//
// Falls back to Claude (the only paid path) only if Pixtral also fails.
// ============================================

import { EDI_EXTRACTION_SCHEMA } from '../../shared/src/utils/edi-schema';
import { uploadPdfAndGetSignedUrl } from './mistral';

export interface PixtralResult {
  success: boolean;
  data: Record<string, unknown> | null;
  rawResponse: unknown;
  processingTimeMs: number;
  error?: string;
}

const BASE_PROMPT =
  'You are extracting invoice data into a structured EDI format. ' +
  'Return ONLY valid JSON matching the provided schema — no commentary, no markdown. ' +
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
 * Process a PDF through Pixtral (Mistral's vision LLM via chat completions).
 * Uses the same file-upload + signed-URL pattern as the dedicated OCR API,
 * then passes the document_url to a vision-capable chat model with a
 * json_schema response_format constraint so output is parseable.
 */
export async function extractWithPixtral(
  pdfBytes: ArrayBuffer,
  apiKey: string,
  extractionTemplate?: string,
): Promise<PixtralResult> {
  const startTime = Date.now();

  try {
    // Step 1+2: upload PDF to Mistral Files API, get signed URL
    const signedUrl = await uploadPdfAndGetSignedUrl(pdfBytes, apiKey);

    // Step 3: call chat completions with Pixtral, passing the doc URL.
    // pixtral-large-latest is the highest-capability Pixtral. Cheaper
    // alternatives exist (pixtral-12b-2409) if cost becomes a concern,
    // but Pixtral is on the same free tier so size doesn't matter for us.
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'pixtral-large-latest',
        max_tokens: 4000,
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'document_url', document_url: signedUrl },
              { type: 'text', text: buildPrompt(extractionTemplate) },
            ],
          },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'edi_invoice',
            strict: false,
            schema: EDI_EXTRACTION_SCHEMA,
          },
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        data: null,
        rawResponse: errorText,
        processingTimeMs: Date.now() - startTime,
        error: `Pixtral API error ${response.status}: ${errorText.slice(0, 500)}`,
      };
    }

    const result = (await response.json()) as Record<string, unknown>;

    // Chat completion shape: { choices: [{ message: { content: "..." } }] }
    const choices = result.choices as Array<Record<string, unknown>> | undefined;
    const messageContent = choices?.[0]?.message
      ? ((choices[0].message as Record<string, unknown>).content as string | undefined)
      : undefined;

    let extractedData: Record<string, unknown> | null = null;
    if (typeof messageContent === 'string') {
      try {
        extractedData = JSON.parse(messageContent);
      } catch {
        // Sometimes the model wraps JSON in markdown fences despite our instructions.
        // Strip a leading ```json ... ``` if present.
        const stripped = messageContent
          .replace(/^\s*```(?:json)?\s*/i, '')
          .replace(/\s*```\s*$/i, '');
        try {
          extractedData = JSON.parse(stripped);
        } catch {
          // Give up — leave extractedData null so we fall through to Claude.
        }
      }
    }

    return {
      success: !!extractedData,
      data: extractedData,
      rawResponse: result,
      processingTimeMs: Date.now() - startTime,
      error: extractedData ? undefined : 'Pixtral returned non-parseable response',
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      rawResponse: null,
      processingTimeMs: Date.now() - startTime,
      error: `Pixtral error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
