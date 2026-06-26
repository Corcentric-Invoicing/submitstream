import { describe, it, expect } from 'vitest';
import { mapInvoiceToCorRequest, validateCorRequest, toCorDate, toCorAmount } from '../mapper';
import { serializeCorRequest } from '../serializer';

describe('Corcentric Mapper + Serializer', () => {
  const supplierConfig = {
    corVendorCode: 'VENDOR-ABC',
    corCustomerCode: 'FLEET-XYZ',
    corCommunityCode: 'FLT',
    defaultTransactionType: 'P' as const,
    defaultCurrencyCode: 'USD' as const,
  };

  const sampleInvoice = {
    InvoiceNumber: 'INV-2026-0042',
    InvoiceDate: '03/25/2026',
    InvoiceTotal: '$1,537.53',
    PONumber: 'PO-88712',
    PODate: '03/20/2026',
    TrackingNumber: '1Z999AA10123456784',
    UnitNumber: 'UNIT-4521',
    LineItems: [
      { VendorPartNumber: 'BRK-PAD-001', BuyerPartNumber: 'BP-9987', Description: 'Brake Pads - Front', Quantity: '4', UnitPrice: '189.99', UOM: 'EA' },
      { VendorPartNumber: 'LBR-INST-BRK', Description: 'Brake Labor', Quantity: '1', UnitPrice: '375.00', LineType: 'L', UOM: 'HR' },
      { VendorPartNumber: 'RTR-RESURFACE', Description: 'Rotor Resurfacing', Quantity: '2', UnitPrice: '85.00', UOM: 'EA' },
    ],
    TaxAmount: '232.57',
  };

  // ── Date conversion ──
  describe('toCorDate', () => {
    it('converts MM/DD/YYYY', () => expect(toCorDate('03/25/2026')).toBe('20260325'));
    it('converts YYYY-MM-DD', () => expect(toCorDate('2026-03-25')).toBe('20260325'));
    it('passes through yyyymmdd', () => expect(toCorDate('20260325')).toBe('20260325'));
    it('handles empty', () => expect(toCorDate('')).toBe(''));
    it('handles null', () => expect(toCorDate(null)).toBe(''));
  });

  // ── Amount conversion ──
  describe('toCorAmount', () => {
    it('strips $ and commas', () => expect(toCorAmount('$2,847.53')).toBe('2847.5300'));
    it('handles plain number', () => expect(toCorAmount('189.99')).toBe('189.9900'));
    it('handles integer', () => expect(toCorAmount('4')).toBe('4.0000'));
    it('handles null', () => expect(toCorAmount(null)).toBe('0.0000'));
    it('2 decimal places', () => expect(toCorAmount('232.57', 2)).toBe('232.57'));
  });

  // ── Full mapper ──
  describe('mapInvoiceToCorRequest', () => {
    const result = mapInvoiceToCorRequest(sampleInvoice, {
      username: 'TEST_USER',
      password: 'TEST_PASS',
      supplierConfig,
      requestId: 'TEST-001',
    });

    it('sets auth credentials', () => {
      expect(result.UserName).toBe('TEST_USER');
      expect(result.Password).toBe('TEST_PASS');
    });

    it('sets request type to S (submission)', () => {
      expect(result.corRequest.corRequestType).toBe('S');
    });

    it('maps vendor/customer/community codes', () => {
      expect(result.corRequest.corVendorCode).toBe('VENDOR-ABC');
      expect(result.corRequest.corCustomerCode).toBe('FLEET-XYZ');
      expect(result.corRequest.corCommunityCode).toBe('FLT');
    });

    it('maps invoice number and date', () => {
      expect(result.corRequest.corTransactionNumber).toBe('INV-2026-0042');
      expect(result.corRequest.corTransactionDate).toBe('20260325');
    });

    it('maps amounts', () => {
      expect(result.corRequest.corTransactionAmount).toBe('1537.5300');
      expect(result.corRequest.corAuthorizationAmount).toBe('1537.5300');
    });

    it('maps PO number', () => {
      expect(result.corRequest.corPurchaseOrderNumber).toBe('PO-88712');
    });

    it('maps references (tracking + unit)', () => {
      expect(result.corRequest.corReferences).toHaveLength(2);
      expect(result.corRequest.corReferences![0]).toEqual({
        corReferenceType: 'BM',
        corReferenceValue: '1Z999AA10123456784',
      });
      expect(result.corRequest.corReferences![1]).toEqual({
        corReferenceType: 'UN',
        corReferenceValue: 'UNIT-4521',
      });
    });

    it('maps 3 line items', () => {
      const lines = result.corRequest.corSections[0].corLineDetails;
      expect(lines).toHaveLength(3);
    });

    it('maps line item types correctly', () => {
      const lines = result.corRequest.corSections[0].corLineDetails;
      expect(lines[0].corLineDetailType).toBe('P'); // Default (parts)
      expect(lines[1].corLineDetailType).toBe('L'); // Labor
      expect(lines[2].corLineDetailType).toBe('P'); // Default
    });

    it('maps line item UOM correctly', () => {
      const lines = result.corRequest.corSections[0].corLineDetails;
      expect(lines[0].corLineDetailUOM).toBe('EA');
      expect(lines[1].corLineDetailUOM).toBe('HR');
    });

    it('creates a tax entry from TaxAmount', () => {
      expect(result.corRequest.corTaxes).toHaveLength(1);
      expect(result.corRequest.corTaxes![0].corTaxType).toBe('SALES');
      expect(result.corRequest.corTaxes![0].corTaxAmount).toBe('232.57');
    });

    it('puts weight data in line notes (not description)', () => {
      const invoiceWithWeights = {
        ...sampleInvoice,
        LineItems: [
          { VendorPartNumber: 'PAPER-001', Description: 'C1S LITHO BW 35lb', Quantity: '21.439', UnitPrice: '1490.00', UOM: 'ST', NetWeight: '21.439', GrossWeight: '21.439', WeightUOM: 'ST' },
        ],
      };
      const r = mapInvoiceToCorRequest(invoiceWithWeights, {
        username: 'TEST', password: 'PASS', supplierConfig,
      });
      const line = r.corRequest.corSections[0].corLineDetails[0];
      // Description stays clean
      expect(line.corLineDetailDescription).toBe('C1S LITHO BW 35lb');
      // Weight goes to notes
      expect(line.corLineDetailNotes).toBeDefined();
      expect(line.corLineDetailNotes![0]).toContain('Net: 21.439 ST');
    });

    it('includes both net and gross in notes when they differ', () => {
      const invoiceWithWeights = {
        ...sampleInvoice,
        LineItems: [
          { VendorPartNumber: 'STEEL-001', Description: 'Steel plate', Quantity: '5', UnitPrice: '200.00', UOM: 'EA', NetWeight: '100', GrossWeight: '120', WeightUOM: 'LB' },
        ],
      };
      const r = mapInvoiceToCorRequest(invoiceWithWeights, {
        username: 'TEST', password: 'PASS', supplierConfig,
      });
      const line = r.corRequest.corSections[0].corLineDetails[0];
      expect(line.corLineDetailDescription).toBe('Steel plate');
      expect(line.corLineDetailNotes![0]).toContain('Net: 100 LB / Gross: 120 LB');
    });

    it('does not add notes when no weight fields exist', () => {
      // sampleInvoice line items have no NetWeight/GrossWeight
      const line = result.corRequest.corSections[0].corLineDetails[0];
      expect(line.corLineDetailDescription).toBe('Brake Pads - Front');
      expect(line.corLineDetailNotes).toBeUndefined();
    });

    it('puts DeliveryTerms in last line notes (not description)', () => {
      const invoiceWithTerms = {
        ...sampleInvoice,
        DeliveryTerms: 'DDP',
      };
      const r = mapInvoiceToCorRequest(invoiceWithTerms, {
        username: 'TEST', password: 'PASS', supplierConfig,
      });
      const lines = r.corRequest.corSections[0].corLineDetails;
      // First line should NOT have delivery term note
      expect(lines[0].corLineDetailNotes).toBeUndefined();
      // Last line should have it in notes
      const lastLine = lines[lines.length - 1];
      expect(lastLine.corLineDetailNotes).toBeDefined();
      expect(lastLine.corLineDetailNotes!.some(n => n.includes('Delivery Term: DDP'))).toBe(true);
      // Description stays clean
      expect(lastLine.corLineDetailDescription).not.toContain('Delivery Term');
    });

    it('combines weight and delivery terms in notes on single-line invoice', () => {
      const invoice = {
        ...sampleInvoice,
        DeliveryTerms: 'FOB',
        LineItems: [
          { VendorPartNumber: 'P-001', Description: 'Paper rolls', Quantity: '10', UnitPrice: '500.00', UOM: 'ST', NetWeight: '50', GrossWeight: '55', WeightUOM: 'ST' },
        ],
      };
      const r = mapInvoiceToCorRequest(invoice, {
        username: 'TEST', password: 'PASS', supplierConfig,
      });
      const line = r.corRequest.corSections[0].corLineDetails[0];
      expect(line.corLineDetailDescription).toBe('Paper rolls');
      expect(line.corLineDetailNotes).toBeDefined();
      expect(line.corLineDetailNotes!.some(n => n.includes('Net: 50 ST / Gross: 55 ST'))).toBe(true);
      expect(line.corLineDetailNotes!.some(n => n.includes('Delivery Term: FOB'))).toBe(true);
    });
  });

  // ── Validation ──
  describe('validateCorRequest', () => {
    it('passes validation with complete data', () => {
      const result = mapInvoiceToCorRequest(sampleInvoice, {
        username: 'TEST',
        password: 'PASS',
        supplierConfig,
      });
      const v = validateCorRequest(result);
      expect(v.valid).toBe(true);
      expect(v.errors).toHaveLength(0);
    });

    it('flags missing vendor code', () => {
      const result = mapInvoiceToCorRequest(sampleInvoice, {
        username: 'TEST',
        password: 'PASS',
        supplierConfig: { ...supplierConfig, corVendorCode: '' },
      });
      const v = validateCorRequest(result);
      expect(v.valid).toBe(false);
      expect(v.errors.some(e => e.includes('corVendorCode'))).toBe(true);
    });

    it('warns on zero amount', () => {
      const result = mapInvoiceToCorRequest({ ...sampleInvoice, InvoiceTotal: '0' }, {
        username: 'TEST',
        password: 'PASS',
        supplierConfig,
      });
      const v = validateCorRequest(result);
      expect(v.warnings.some(w => w.includes('zero'))).toBe(true);
    });
  });

  // ── Serializer ──
  describe('serializeCorRequest', () => {
    it('produces valid XML', () => {
      const result = mapInvoiceToCorRequest(sampleInvoice, {
        username: 'TEST_USER',
        password: 'TEST_PASS',
        supplierConfig,
        requestId: 'TEST-001',
      });
      const xml = serializeCorRequest(result);

      expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xml).toContain('<ProcessRequest>');
      expect(xml).toContain('</ProcessRequest>');
      expect(xml).toContain('<UserName>TEST_USER</UserName>');
      expect(xml).toContain('<corRequestType>S</corRequestType>');
      expect(xml).toContain('<corVendorCode>VENDOR-ABC</corVendorCode>');
      expect(xml).toContain('<corTransactionNumber>INV-2026-0042</corTransactionNumber>');
      expect(xml).toContain('<corTransactionDate>20260325</corTransactionDate>');
      expect(xml).toContain('<corTransactionAmount>1537.5300</corTransactionAmount>');
      expect(xml).toContain('<corLineDetailItem>BRK-PAD-001</corLineDetailItem>');
      expect(xml).toContain('<corLineDetailType>L</corLineDetailType>');
      expect(xml).toContain('<corReferenceType>BM</corReferenceType>');
      expect(xml).toContain('<corReferenceValue>1Z999AA10123456784</corReferenceValue>');
      expect(xml).toContain('<corTaxAmount>232.57</corTaxAmount>');
    });

    it('escapes XML special characters', () => {
      const result = mapInvoiceToCorRequest({
        ...sampleInvoice,
        InvoiceNumber: 'INV<>&"test',
      }, {
        username: 'TEST',
        password: 'PASS',
        supplierConfig,
      });
      const xml = serializeCorRequest(result);
      expect(xml).toContain('INV&lt;&gt;&amp;&quot;test');
      expect(xml).not.toContain('<INV');
    });
  });
});
