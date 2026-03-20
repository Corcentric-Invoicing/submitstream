// ============================================
// Mistral OCR 3 Integration
// Primary OCR provider for invoice extraction
// ============================================

import { EDI_EXTRACTION_SCHEMA } from '../../../../shared/src/utils/edi-schema';

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
 */
export async function extractWithMistral(
  pdfBytes: ArrayBuffer,
  apiKey: string
): Promise<MistralOCRResult> {
  const startTime = Date.now();

  try {
    // Step 1: Upload PDF to Mistral's OCR endpoint
    const formData = new FormData();
    formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'invoice.pdf');
    formData.append('model', 'mistral-ocr-latest');

    // Use document_annotation for structured extraction
    formData.append('document_annotation_format', JSON.stringify({
      type: 'json_schema',
      json_schema: {
        name: 'edi_invoice',
        schema: EDI_EXTRACTION_SCHEMA
      }
    }));

    const response = await fetch('https://api.mistral.ai/v1/ocr', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: formData,
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

    // Extract the structured annotation from the response
    let extractedData: Record<string, unknown> | null = null;

    // The response structure includes pages with annotations
    if (result.pages && Array.isArray(result.pages)) {
      const pages = result.pages as Array<Record<string, unknown>>;
      for (const page of pages) {
        if (page.document_annotation) {
          extractedData = page.document_annotation as Record<string, unknown>;
          break;
        }
      }
    }

    // Fallback: check top-level document_annotation
    if (!extractedData && result.document_annotation) {
      extractedData = result.document_annotation as Record<string, unknown>;
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
