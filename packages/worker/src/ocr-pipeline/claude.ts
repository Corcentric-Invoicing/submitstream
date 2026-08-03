// ============================================
// Claude Vision API Integration
// Fallback OCR provider for low-confidence extractions
// ============================================

export interface ClaudeOCRResult {
  success: boolean;
  data: Record<string, unknown> | null;
  rawResponse: unknown;
  processingTimeMs: number;
  error?: string;
}

const CLAUDE_EXTRACTION_PROMPT = `You are an expert invoice data extraction system. Extract all available information from this invoice image into a structured JSON format.

CRITICAL REQUIREMENTS:
- All dates must be in YYYYMMDD format (e.g., 20240215 not 2024-02-15)
- All monetary amounts should be plain numbers (e.g., "1234.56" not "$1,234.56")
- Empty/missing fields should be empty strings, not null or "N/A"
- Return ONLY valid JSON, no markdown formatting

SUBTOTAL vs DISCOUNTABLE AMOUNT:
- Write the visible "Subtotal" / "Sub-total" / "Net amount" / "Net total" line to the Subtotal field. This is the standard pre-tax sum of line items.
- Write to DiscountableAmount ONLY when the invoice explicitly labels a "discountable amount" or shows a separate amount eligible for an early-payment discount. Do NOT use DiscountableAmount as a generic subtotal.
- Most invoices have Subtotal but no DiscountableAmount.

Extract the following fields:
{
  "InvoiceDate": "", "InvoiceNumber": "", "PODate": "", "PONumber": "", "Currency": "", "ShipDate": "",
  "ShipToName": "", "ShipToCode": "", "ShipToAddress1": "", "ShipToAddress2": "", "ShipToCity": "", "ShipToState": "", "ShipToZip": "",
  "VendorName": "", "VendorCode": "", "VendorAddress1": "", "VendorAddress2": "", "VendorCity": "", "VendorState": "", "VendorZip": "",
  "RemitToName": "", "RemitToCode": "", "RemitToAddress1": "", "RemitToAddress2": "", "RemitToCity": "", "RemitToState": "",
  "BillToName": "", "BillToCode": "", "BillToAddress1": "", "BillToAddress2": "", "BillToCity": "", "BillToState": "",
  "DueDate": "", "NetDays": "", "TermsDescription": "", "DiscountPercent": "", "DiscountAmount": "", "DiscountDueDate": "",
  "LineItems": [{"LineNumber": "", "Quantity": "", "UOM": "", "UnitPrice": "", "BuyerPartNumber": "", "VendorPartNumber": "", "Description": ""}],
  "Subtotal": "", "InvoiceTotal": "", "DiscountableAmount": "",
  "LocalTaxCode": "", "LocalTaxAmount": "", "StateTaxCode": "", "StateTaxAmount": "",
  "FederalTaxCode": "", "FederalTaxAmount": "", "TaxExemptCode": "", "TaxExemptAmount": "",
  "FreightAmount": "", "FreightDescription": "", "MiscChargeCode": "", "MiscChargeAmount": "", "MiscChargeDescription": "",
  "BillOfLading": "", "PackingSlip": "", "ReferenceNumber1": "", "ReferenceQualifier1": "", "ReferenceNumber2": "", "ReferenceQualifier2": ""
}`;

/**
 * Process a PDF through Claude API as fallback OCR.
 * Uses the document content block type for native PDF support.
 */
export async function extractWithClaude(
  pdfBase64: string,
  apiKey: string,
  mediaType: string = 'application/pdf',
  extractionTemplate?: string
): Promise<ClaudeOCRResult> {
  const startTime = Date.now();

  try {
    // Determine if this is a PDF or image and use the correct content block type
    const isPdf = mediaType === 'application/pdf';
    const contentBlock = isPdf
      ? {
          type: 'document' as const,
          source: {
            type: 'base64' as const,
            media_type: mediaType,
            data: pdfBase64,
          },
        }
      : {
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: mediaType,
            data: pdfBase64,
          },
        };

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        // Haiku 4.5 — purpose-built for fast/cheap structured extraction.
        // ~3x cheaper than Sonnet 4.5 (~$0.008 vs $0.024 per Fedrigoni-sized
        // invoice). Still has full vision support; OCR is mostly pattern-
        // matching so the smaller model is more than sufficient. This is
        // the LAST fallback tier (after Mistral OCR + Pixtral both fail).
        model: 'claude-haiku-4-5',
        max_tokens: 4000,
        messages: [
          {
            role: 'user',
            content: [
              contentBlock,
              {
                type: 'text',
                text: extractionTemplate
                  ? `${CLAUDE_EXTRACTION_PROMPT}\n\nSUPPLIER-SPECIFIC EXTRACTION GUIDE:\n${extractionTemplate}`
                  : CLAUDE_EXTRACTION_PROMPT,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        data: null,
        rawResponse: errorText,
        processingTimeMs: Date.now() - startTime,
        error: `Claude API error ${response.status}: ${errorText}`,
      };
    }

    const result = await response.json() as Record<string, unknown>;

    // Extract JSON from Claude's response
    let extractedData: Record<string, unknown> | null = null;
    const content = result.content as Array<{ type: string; text?: string }>;

    if (content && content.length > 0) {
      const textBlock = content.find(c => c.type === 'text');
      if (textBlock?.text) {
        // Try to parse JSON directly
        try {
          extractedData = JSON.parse(textBlock.text);
        } catch {
          // Try to extract JSON from markdown code blocks
          const jsonMatch = textBlock.text.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (jsonMatch) {
            try {
              extractedData = JSON.parse(jsonMatch[1].trim());
            } catch {
              // Try finding JSON object in the text
              const objMatch = textBlock.text.match(/\{[\s\S]*\}/);
              if (objMatch) {
                try {
                  extractedData = JSON.parse(objMatch[0]);
                } catch {
                  // Give up
                }
              }
            }
          }
        }
      }
    }

    return {
      success: !!extractedData,
      data: extractedData,
      rawResponse: result,
      processingTimeMs: Date.now() - startTime,
      error: extractedData ? undefined : 'Could not parse JSON from Claude response',
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      rawResponse: null,
      processingTimeMs: Date.now() - startTime,
      error: `Claude OCR error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
