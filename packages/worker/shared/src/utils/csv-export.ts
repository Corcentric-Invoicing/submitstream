// ============================================
// EDI CSV Export Utility
// Generates Corcentric-compatible 79-column CSV
// Maps internal extraction field names → Corcentric column names
// ============================================

import { CSV_COLUMN_ORDER, CSV_FIELD_MAP } from './edi-schema';

/**
 * Compute A-slot values for extended fields per line item.
 * A-slots carry data that doesn't fit in the base 79-column Corcentric spec.
 * Each A pair: Q = qualifier code, D = data value.
 */
function computeASlots(
  invoiceData: Record<string, unknown>,
  lineItem: Record<string, string>,
): Record<string, string> {
  const slots: Record<string, string> = {};

  // A1: Line Item Amount
  if (lineItem.LineItemAmount) {
    slots.A1Q = 'LIA';
    slots.A1D = lineItem.LineItemAmount;
  }

  // A2: Container Number
  if (lineItem.ContainerNumber) {
    slots.A2Q = 'CN';
    slots.A2D = lineItem.ContainerNumber;
  }

  // A3: Packaging (combined qty + UOM)
  if (lineItem.PackagingQuantity) {
    slots.A3Q = 'PKG';
    slots.A3D = `${lineItem.PackagingQuantity}${lineItem.PackagingUOM ? ' ' + lineItem.PackagingUOM : ''}`.trim();
  }

  // A4: Net Weight (combined weight + UOM)
  if (lineItem.NetWeight) {
    slots.A4Q = 'NWT';
    slots.A4D = `${lineItem.NetWeight}${lineItem.WeightUOM ? ' ' + lineItem.WeightUOM : ''}`.trim();
  }

  // A5: Gross Weight (combined weight + UOM) OR header-level extended data
  if (lineItem.GrossWeight) {
    slots.A5Q = 'GWT';
    slots.A5D = `${lineItem.GrossWeight}${lineItem.WeightUOM ? ' ' + lineItem.WeightUOM : ''}`.trim();
  } else if (invoiceData.SalesOrderNumber) {
    // If no gross weight, use slot for Sales Order Number
    slots.A5Q = 'SO';
    slots.A5D = String(invoiceData.SalesOrderNumber);
  }

  return slots;
}

/**
 * Generate a Corcentric-compatible EDI CSV string from invoice data.
 * One row per line item, header data repeats on each row.
 * Column names match Corcentric's exact 79-column spec.
 */
export function generateEDICSV(invoiceData: Record<string, unknown>): string {
  const lineItems = (invoiceData.LineItems as Array<Record<string, string>>) || [{}];

  // CSV header row — exact Corcentric column names
  const headerRow = CSV_COLUMN_ORDER.join(',');

  // Generate one row per line item
  const dataRows = lineItems.map((lineItem) => {
    const aSlots = computeASlots(invoiceData, lineItem);

    return CSV_COLUMN_ORDER.map((csvCol) => {
      let value = '';
      const mapping = CSV_FIELD_MAP[csvCol];

      if (!mapping) {
        value = '';
      } else if (mapping.startsWith('static:')) {
        // Hardcoded qualifier values (e.g., "BM", "PK", "ZZ")
        // Only output the qualifier if the corresponding data field has a value
        const staticVal = mapping.slice(7);
        if (csvCol === 'RefQualBM') {
          value = invoiceData.BillOfLading ? staticVal : '';
        } else if (csvCol === 'RefQualPK') {
          value = invoiceData.PackingSlip ? staticVal : '';
        } else if (csvCol === 'RefQualZZ') {
          value = invoiceData.ReferenceZZ ? staticVal : '';
        } else {
          value = staticVal;
        }
      } else if (mapping.startsWith('computed:')) {
        // A-slot computed values
        const slotKey = mapping.slice(9);
        value = aSlots[slotKey] || '';
      } else if (mapping.startsWith('line.')) {
        // Line item field
        const lineKey = mapping.slice(5);
        value = String(lineItem[lineKey] || '');
      } else {
        // Top-level invoice data field
        value = String(invoiceData[mapping] || '');
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
