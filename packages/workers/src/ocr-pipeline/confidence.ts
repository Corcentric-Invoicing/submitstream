// ============================================
// Confidence Scoring for OCR Extractions
// Determines if extraction quality is sufficient
// ============================================

import type { ConfidenceLevel } from '../../../../shared/src/types/invoice';

export interface ConfidenceResult {
  score: number;           // 0-100
  level: ConfidenceLevel;  // 'high' | 'medium' | 'low'
  issues: string[];        // List of detected problems
}

// Critical fields that must be present for a valid invoice
const CRITICAL_FIELDS = [
  'InvoiceNumber',
  'InvoiceDate',
  'VendorName',
  'InvoiceTotal',
];

// Important fields that should be present
const IMPORTANT_FIELDS = [
  'PONumber',
  'VendorCode',
  'ShipToName',
  'BillToName',
  'DueDate',
  'Currency',
];

// Date fields that should match YYYYMMDD format
const DATE_FIELDS = [
  'InvoiceDate', 'PODate', 'ShipDate', 'DueDate', 'DiscountDueDate',
];

const YYYYMMDD_REGEX = /^\d{8}$/;
const NUMERIC_REGEX = /^-?\d+\.?\d*$/;

/**
 * Calculate confidence score for an OCR extraction result.
 * Returns a score 0-100 and categorizes as high/medium/low.
 */
export function calculateConfidence(data: Record<string, unknown>): ConfidenceResult {
  const issues: string[] = [];
  let totalPoints = 0;
  let earnedPoints = 0;

  // Check critical fields (40 points)
  for (const field of CRITICAL_FIELDS) {
    totalPoints += 10;
    const value = String(data[field] || '').trim();
    if (value && value !== 'N/A' && value !== 'null') {
      earnedPoints += 10;
    } else {
      issues.push(`Missing critical field: ${field}`);
    }
  }

  // Check important fields (30 points)
  for (const field of IMPORTANT_FIELDS) {
    totalPoints += 5;
    const value = String(data[field] || '').trim();
    if (value && value !== 'N/A' && value !== 'null') {
      earnedPoints += 5;
    } else {
      issues.push(`Missing important field: ${field}`);
    }
  }

  // Check date format compliance (15 points)
  for (const field of DATE_FIELDS) {
    const value = String(data[field] || '').trim();
    if (value) {
      totalPoints += 3;
      if (YYYYMMDD_REGEX.test(value)) {
        earnedPoints += 3;
      } else {
        issues.push(`Date format incorrect for ${field}: "${value}" (expected YYYYMMDD)`);
        // Give partial credit if it looks like a date
        if (value.match(/\d{4}[-/]\d{2}[-/]\d{2}/)) {
          earnedPoints += 1; // ISO format, can be converted
        }
      }
    }
  }

  // Check numeric fields (10 points)
  const numericFields = ['InvoiceTotal', 'FreightAmount', 'DiscountAmount'];
  for (const field of numericFields) {
    const value = String(data[field] || '').trim();
    if (value) {
      totalPoints += 3;
      // Strip currency symbols and commas for check
      const cleaned = value.replace(/[$,€£]/g, '');
      if (NUMERIC_REGEX.test(cleaned)) {
        earnedPoints += 3;
      } else {
        issues.push(`Non-numeric value for ${field}: "${value}"`);
        earnedPoints += 1; // Partial credit
      }
    }
  }

  // Check line items exist (5 points)
  totalPoints += 5;
  const lineItems = data.LineItems;
  if (Array.isArray(lineItems) && lineItems.length > 0) {
    earnedPoints += 5;
    // Check line items have descriptions
    const hasDescriptions = lineItems.every(
      (item: Record<string, unknown>) => String(item.Description || '').trim().length > 0
    );
    if (!hasDescriptions) {
      issues.push('Some line items missing descriptions');
    }
  } else {
    issues.push('No line items found');
  }

  // Calculate final score
  const score = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;

  let level: ConfidenceLevel;
  if (score > 80) {
    level = 'high';
  } else if (score >= 50) {
    level = 'medium';
  } else {
    level = 'low';
  }

  return { score, level, issues };
}

/**
 * Normalize dates from various formats to YYYYMMDD.
 * Attempts to fix common date format issues from OCR.
 */
export function normalizeDates(data: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...data };

  for (const field of DATE_FIELDS) {
    const value = String(normalized[field] || '').trim();
    if (!value) continue;

    // Already correct format
    if (YYYYMMDD_REGEX.test(value)) continue;

    // Try to convert ISO format (2024-02-15)
    const isoMatch = value.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
    if (isoMatch) {
      normalized[field] = `${isoMatch[1]}${isoMatch[2]}${isoMatch[3]}`;
      continue;
    }

    // Try US format (02/15/2024 or 02-15-2024)
    const usMatch = value.match(/(\d{2})[-/](\d{2})[-/](\d{4})/);
    if (usMatch) {
      normalized[field] = `${usMatch[3]}${usMatch[1]}${usMatch[2]}`;
      continue;
    }
  }

  return normalized;
}
