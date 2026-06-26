// ============================================
// OCR Pipeline Orchestrator
// Mistral primary → confidence check → Claude fallback
// ============================================

import { extractWithMistral } from './mistral';
import { extractWithClaude } from './claude';
import { calculateConfidence, normalizeDates } from './confidence';
import type { InvoiceStatus, ConfidenceLevel, OCRProvider } from '../../shared/src/types/invoice';

export interface OCRPipelineResult {
  success: boolean;
  data: Record<string, unknown>;
  status: InvoiceStatus;
  confidence: ConfidenceLevel;
  confidenceScore: number;
  provider: OCRProvider;
  issues: string[];
  processingTimeMs: number;
  rawResponses: {
    mistral?: unknown;
    claude?: unknown;
  };
  error?: string;
}

export interface OCRPipelineEnv {
  MISTRAL_API_KEY: string;
  ANTHROPIC_API_KEY: string;
}

export interface OCRPipelineOptions {
  extractionTemplate?: string;  // Supplier-specific extraction hints
}

/**
 * Main OCR pipeline: Mistral primary with Claude fallback.
 *
 * Flow:
 * 1. Send PDF to Mistral OCR 3 for structured extraction
 * 2. Calculate confidence score on result
 * 3. If high confidence (>80%) → processed (green)
 * 4. If medium confidence (50-80%) → pending (yellow), flag for review
 * 5. If low confidence (<50%) → try Claude fallback
 * 6. Compare results, take better extraction
 */
export async function processInvoicePDF(
  pdfBytes: ArrayBuffer,
  env: OCRPipelineEnv,
  options?: OCRPipelineOptions
): Promise<OCRPipelineResult> {
  const startTime = Date.now();
  const rawResponses: { mistral?: unknown; claude?: unknown } = {};

  // Step 1: Try Mistral OCR
  console.log('[OCR] Starting Mistral extraction...');
  const mistralResult = await extractWithMistral(pdfBytes, env.MISTRAL_API_KEY, options?.extractionTemplate);
  rawResponses.mistral = mistralResult.rawResponse;

  if (mistralResult.success && mistralResult.data) {
    // Normalize dates
    const normalizedData = normalizeDates(mistralResult.data);
    const confidence = calculateConfidence(normalizedData);

    console.log(`[OCR] Mistral extraction complete. Confidence: ${confidence.score}% (${confidence.level})`);

    // High confidence → processed (green)
    if (confidence.level === 'high') {
      return {
        success: true,
        data: normalizedData,
        status: 'processed',
        confidence: confidence.level,
        confidenceScore: confidence.score,
        provider: 'mistral',
        issues: confidence.issues,
        processingTimeMs: Date.now() - startTime,
        rawResponses,
      };
    }

    // Medium confidence → pending (yellow), but still usable
    if (confidence.level === 'medium') {
      return {
        success: true,
        data: normalizedData,
        status: 'pending',
        confidence: confidence.level,
        confidenceScore: confidence.score,
        provider: 'mistral',
        issues: confidence.issues,
        processingTimeMs: Date.now() - startTime,
        rawResponses,
      };
    }

    // Low confidence → try Claude fallback
    console.log(`[OCR] Low confidence from Mistral (${confidence.score}%), trying Claude fallback...`);
  } else {
    console.log(`[OCR] Mistral extraction failed: ${mistralResult.error}`);
  }

  // Step 2: Claude fallback
  try {
    // Convert PDF to base64 for Claude
    const uint8Array = new Uint8Array(pdfBytes);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const pdfBase64 = btoa(binary);

    console.log('[OCR] Starting Claude fallback extraction...');
    const claudeResult = await extractWithClaude(pdfBase64, env.ANTHROPIC_API_KEY, 'application/pdf', options?.extractionTemplate);
    rawResponses.claude = claudeResult.rawResponse;

    if (claudeResult.success && claudeResult.data) {
      const normalizedData = normalizeDates(claudeResult.data);
      const claudeConfidence = calculateConfidence(normalizedData);

      console.log(`[OCR] Claude extraction complete. Confidence: ${claudeConfidence.score}% (${claudeConfidence.level})`);

      // If we also had Mistral data, compare and take the better one
      if (mistralResult.success && mistralResult.data) {
        const mistralNormalized = normalizeDates(mistralResult.data);
        const mistralConfidence = calculateConfidence(mistralNormalized);

        if (mistralConfidence.score >= claudeConfidence.score) {
          // Mistral was actually better despite being "low"
          return {
            success: true,
            data: mistralNormalized,
            status: mistralConfidence.level === 'high' ? 'processed' : 'pending',
            confidence: mistralConfidence.level,
            confidenceScore: mistralConfidence.score,
            provider: 'mistral',
            issues: mistralConfidence.issues,
            processingTimeMs: Date.now() - startTime,
            rawResponses,
          };
        }
      }

      // Claude result is better (or only result)
      const status: InvoiceStatus = claudeConfidence.level === 'high' ? 'processed' : 'pending';
      return {
        success: true,
        data: normalizedData,
        status,
        confidence: claudeConfidence.level,
        confidenceScore: claudeConfidence.score,
        provider: 'claude',
        issues: claudeConfidence.issues,
        processingTimeMs: Date.now() - startTime,
        rawResponses,
      };
    }
  } catch (error) {
    console.error('[OCR] Claude fallback failed:', error);
  }

  // Both failed — return whatever we have with pending status
  const fallbackData = mistralResult.data ? normalizeDates(mistralResult.data) : {};
  return {
    success: false,
    data: fallbackData,
    status: 'pending',
    confidence: 'low',
    confidenceScore: 0,
    provider: 'mistral',
    issues: ['Both OCR providers failed or returned low confidence'],
    processingTimeMs: Date.now() - startTime,
    rawResponses,
    error: 'OCR extraction failed with both providers',
  };
}
