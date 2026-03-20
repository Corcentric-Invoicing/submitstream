// ============================================
// EDI CSV Export Utility
// Generates 79-column CSV from invoice data
// ============================================

import { CSV_COLUMN_ORDER } from './edi-schema';

/**
 * Generate an EDI-compliant CSV string from invoice data.
 * One row per line item, header data repeats on each row.
 */
export function generateEDICSV(invoiceData: Record<string, unknown>): string {
  const lineItems = (invoiceData.LineItems as Array<Record<string, string>>) || [{}];

  // CSV header row
  const headerRow = CSV_COLUMN_ORDER.join(',');

  // Generate one row per line item
  const dataRows = lineItems.map((lineItem) => {
    return CSV_COLUMN_ORDER.map((col) => {
      let value = '';

      // Line item fields come from the line item object
      if (['LineNumber', 'Quantity', 'UOM', 'UnitPrice', 'BuyerPartNumber', 'VendorPartNumber'].includes(col)) {
        value = String(lineItem[col] || '');
      } else if (col === 'LineDescription') {
        value = String(lineItem.Description || '');
      } else {
        // All other fields come from the top-level invoice data
        value = String(invoiceData[col] || '');
      }

      // CSV escape: wrap in quotes if contains comma, quote, or newline
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        value = `"${value.replace(/"/g, '""')}"`;
      }

      return value;
    }).join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}
