// ============================================
// OCR Pipeline Orchestrator
// Mistral primary → confidence check → Claude fallback
// ============================================

import { extractWithMistral } from './mistral';
import { extractWithPixtral } from './pixtral';
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
    pixtral?: unknown;
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
 * Main OCR pipeline: 3-tier cascade.
 *
 * Tier 1 — Mistral OCR (dedicated /v1/ocr endpoint, free, primary)
 *   • High confidence → return immediately
 *   • Medium confidence → return as pending (still usable)
 *   • Low confidence or failed → fall through to Tier 2
 *
 * Tier 2 — Pixtral (Mistral vision LLM via /v1/chat/completions, free, fallback 1)
 *   • Same Mistral API key, same free tier
 *   • Can handle PDFs Mistral OCR can't (sees visually rather than parsing text layer)
 *   • Same confidence gating; low/failed → fall through to Tier 3
 *
 * Tier 3 — Claude Haiku (paid, last resort, fallback 2)
 *   • Anthropic API
 *   • Final extraction attempt; compare against any prior partial result
 *   • Pick the highest-scoring of (Mistral, Pixtral, Claude)
 */
export async function processInvoicePDF(
  pdfBytes: ArrayBuffer,
  env: OCRPipelineEnv,
  options?: OCRPipelineOptions
): Promise<OCRPipelineResult> {
  const startTime = Date.now();
  const rawResponses: { mistral?: unknown; pixtral?: unknown; claude?: unknown } = {};

  // ── Tier 1: Mistral OCR ────────────────────────────────────────────
  console.log('[OCR] Starting Mistral OCR extraction...');
  const mistralResult = await extractWithMistral(pdfBytes, env.MISTRAL_API_KEY, options?.extractionTemplate);
  rawResponses.mistral = mistralResult.rawResponse;

  if (mistralResult.success && mistralResult.data) {
    const normalizedData = normalizeDates(mistralResult.data);
    const confidence = calculateConfidence(normalizedData);
    console.log(`[OCR] Mistral OCR complete. Confidence: ${confidence.score}% (${confidence.level})`);

    if (confidence.level === 'high' || confidence.level === 'medium') {
      return {
        success: true,
        data: normalizedData,
        status: confidence.level === 'high' ? 'processed' : 'pending',
        confidence: confidence.level,
        confidenceScore: confidence.score,
        provider: 'mistral',
        issues: confidence.issues,
        processingTimeMs: Date.now() - startTime,
        rawResponses,
      };
    }
    console.log(`[OCR] Low confidence from Mistral OCR (${confidence.score}%), trying Pixtral...`);
  } else {
    console.log(`[OCR] Mistral OCR failed: ${mistralResult.error}`);
  }

  // ── Tier 2: Pixtral (Mistral vision LLM, same free tier) ───────────
  console.log('[OCR] Starting Pixtral extraction...');
  const pixtralResult = await extractWithPixtral(pdfBytes, env.MISTRAL_API_KEY, options?.extractionTemplate);
  rawResponses.pixtral = pixtralResult.rawResponse;

  if (pixtralResult.success && pixtralResult.data) {
    const pixtralNormalized = normalizeDates(pixtralResult.data);
    const pixtralConfidence = calculateConfidence(pixtralNormalized);
    console.log(`[OCR] Pixtral complete. Confidence: ${pixtralConfidence.score}% (${pixtralConfidence.level})`);

    if (pixtralConfidence.level === 'high' || pixtralConfidence.level === 'medium') {
      return {
        success: true,
        data: pixtralNormalized,
        status: pixtralConfidence.level === 'high' ? 'processed' : 'pending',
        confidence: pixtralConfidence.level,
        confidenceScore: pixtralConfidence.score,
        provider: 'pixtral',
        issues: pixtralConfidence.issues,
        processingTimeMs: Date.now() - startTime,
        rawResponses,
      };
    }
    console.log(`[OCR] Low confidence from Pixtral (${pixtralConfidence.score}%), trying Claude...`);
  } else {
    console.log(`[OCR] Pixtral failed: ${pixtralResult.error}`);
  }

  // ── Tier 3: Claude Haiku (paid, last resort) ──────────────────────
  try {
    // Convert PDF to base64 for Claude
    const uint8Array = new Uint8Array(pdfBytes);
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const pdfBase64 = btoa(binary);

    console.log('[OCR] Starting Claude Haiku fallback extraction...');
    const claudeResult = await extractWithClaude(pdfBase64, env.ANTHROPIC_API_KEY, 'application/pdf', options?.extractionTemplate);
    rawResponses.claude = claudeResult.rawResponse;

    if (claudeResult.success && claudeResult.data) {
      const claudeNormalized = normalizeDates(claudeResult.data);
      const claudeConfidence = calculateConfidence(claudeNormalized);
      console.log(`[OCR] Claude complete. Confidence: ${claudeConfidence.score}% (${claudeConfidence.level})`);

      // Compare against any prior partial results — pick the highest score
      // so we never throw away a better Mistral/Pixtral extraction in favor
      // of a worse Claude one (rare but possible on tricky PDFs).
      type Candidate = { data: Record<string, unknown>; score: number; level: ConfidenceLevel; issues: string[]; provider: OCRProvider };
      const candidates: Candidate[] = [];
      candidates.push({
        data: claudeNormalized,
        score: claudeConfidence.score,
        level: claudeConfidence.level,
        issues: claudeConfidence.issues,
        provider: 'claude',
      });
      if (mistralResult.success && mistralResult.data) {
        const n = normalizeDates(mistralResult.data);
        const c = calculateConfidence(n);
        candidates.push({ data: n, score: c.score, level: c.level, issues: c.issues, provider: 'mistral' });
      }
      if (pixtralResult.success && pixtralResult.data) {
        const n = normalizeDates(pixtralResult.data);
        const c = calculateConfidence(n);
        candidates.push({ data: n, score: c.score, level: c.level, issues: c.issues, provider: 'pixtral' });
      }
      candidates.sort((a, b) => b.score - a.score);
      const best = candidates[0];

      return {
        success: true,
        data: best.data,
        status: best.level === 'high' ? 'processed' : 'pending',
        confidence: best.level,
        confidenceScore: best.score,
        provider: best.provider,
        issues: best.issues,
        processingTimeMs: Date.now() - startTime,
        rawResponses,
      };
    }
  } catch (error) {
    console.error('[OCR] Claude fallback failed:', error);
  }

  // ── All three failed — return whatever we have with pending status ──
  // Prefer Pixtral data over Mistral data if both partial (Pixtral usually
  // produces more complete output even at low confidence).
  const fallbackData = pixtralResult.data
    ? normalizeDates(pixtralResult.data)
    : mistralResult.data
      ? normalizeDates(mistralResult.data)
      : {};
  const fallbackProvider: OCRProvider = pixtralResult.data ? 'pixtral' : 'mistral';
  return {
    success: false,
    data: fallbackData,
    status: 'pending',
    confidence: 'low',
    confidenceScore: 0,
    provider: fallbackProvider,
    issues: ['All three OCR tiers (Mistral OCR, Pixtral, Claude) failed or returned low confidence'],
    processingTimeMs: Date.now() - startTime,
    rawResponses,
    error: 'OCR extraction failed across all tiers',
  };
}
