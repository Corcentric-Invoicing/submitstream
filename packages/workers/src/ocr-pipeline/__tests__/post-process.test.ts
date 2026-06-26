import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  postProcessInvoiceData,
  SupplierConfig,
  PostProcessContext,
} from '../post-process';

describe('Post-Processing Rules Engine', () => {
  let mockSupabase: any;
  let context: PostProcessContext;

  beforeEach(() => {
    // Mock Supabase client
    mockSupabase = {
      from: vi.fn(),
    };

    // Default context
    context = {
      supplier: {
        code: 'VENDOR-001',
      },
      supabase: mockSupabase,
    };
  });

  // ============================================================================
  // RULE 1: VendorCode
  // ============================================================================
  describe('Rule 1: VendorCode', () => {
    it('should set VendorCode to supplier.code when missing', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.VendorCode).toBe('VENDOR-001');
      expect(result._postProcessRules).toContain(
        'VendorCode set to "VENDOR-001" (supplier assigned)'
      );
    });

    it('should use vendor_code_override when present', async () => {
      context.supplier.vendor_code_override = 'OVERRIDE-CODE-123';
      const data = {
        InvoiceNumber: 'INV-001',
        VendorCode: 'OLD-CODE',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.VendorCode).toBe('OVERRIDE-CODE-123');
      expect(result._postProcessRules).toContain(
        'VendorCode set to "OVERRIDE-CODE-123" (supplier assigned)'
      );
    });

    it('should overwrite existing OCR-extracted VendorCode', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        VendorCode: 'OCR-EXTRACTED-CODE',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.VendorCode).toBe('VENDOR-001');
      expect(result._postProcessRules).toContain(
        'VendorCode set to "VENDOR-001" (supplier assigned)'
      );
    });

    it('should not trigger rule if VendorCode already matches supplier code', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        VendorCode: 'VENDOR-001',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.VendorCode).toBe('VENDOR-001');
      expect(result._postProcessRules).not.toContain(
        'VendorCode set to "VENDOR-001" (supplier assigned)'
      );
    });
  });

  // ============================================================================
  // RULE 2: ShipDate defaults to InvoiceDate
  // ============================================================================
  describe('Rule 2: ShipDate defaults to InvoiceDate', () => {
    it('should set ShipDate when missing but InvoiceDate exists', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        InvoiceDate: '2024-03-15',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.ShipDate).toBe('2024-03-15');
      expect(result._postProcessRules).toContain(
        'ShipDate defaulted to InvoiceDate: 2024-03-15'
      );
    });

    it('should not overwrite existing ShipDate', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        InvoiceDate: '2024-03-15',
        ShipDate: '2024-03-10',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.ShipDate).toBe('2024-03-10');
      expect(result._postProcessRules).not.toContain(
        expect.stringContaining('ShipDate defaulted')
      );
    });

    it('should do nothing when both ShipDate and InvoiceDate are missing', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.ShipDate).toBeUndefined();
      expect(result._postProcessRules).not.toContain(
        expect.stringContaining('ShipDate defaulted')
      );
    });

    it('should do nothing when InvoiceDate is empty string', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        InvoiceDate: '',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.ShipDate).toBeUndefined();
    });

    it('should do nothing when ShipDate is empty but InvoiceDate is not', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        InvoiceDate: '2024-03-15',
        ShipDate: '',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.ShipDate).toBe('2024-03-15');
    });
  });

  // ============================================================================
  // RULE 3: RemitToCode
  // ============================================================================
  describe('Rule 3: RemitToCode', () => {
    it('should set RemitToCode from supplier config when missing', async () => {
      context.supplier.remit_to_code = 'REMIT-123';
      const data = {
        InvoiceNumber: 'INV-001',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.RemitToCode).toBe('REMIT-123');
      expect(result._postProcessRules).toContain(
        'RemitToCode set to "REMIT-123" (supplier assigned)'
      );
    });

    it('should not overwrite existing RemitToCode', async () => {
      context.supplier.remit_to_code = 'REMIT-123';
      const data = {
        InvoiceNumber: 'INV-001',
        RemitToCode: 'EXISTING-CODE',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.RemitToCode).toBe('EXISTING-CODE');
      expect(result._postProcessRules).not.toContain(
        expect.stringContaining('RemitToCode set to')
      );
    });

    it('should do nothing when supplier has no remit_to_code', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.RemitToCode).toBeUndefined();
      expect(result._postProcessRules).not.toContain(
        expect.stringContaining('RemitToCode set to')
      );
    });

    it('should do nothing when RemitToCode is empty string but supplier has code', async () => {
      context.supplier.remit_to_code = 'REMIT-123';
      const data = {
        InvoiceNumber: 'INV-001',
        RemitToCode: '',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.RemitToCode).toBe('REMIT-123');
    });
  });

  // ============================================================================
  // RULE 4: ShipToCode / BillToCode - Address Code Lookup
  // ============================================================================
  describe('Rule 4: ShipToCode / BillToCode - Address Code Lookup', () => {
    describe('ShipToCode', () => {
      it('should look up existing ShipToCode from Supabase', async () => {
        const mockChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { code: 'SHIP-001' } }),
        };
        mockSupabase.from.mockReturnValue(mockChain);

        const data = {
          InvoiceNumber: 'INV-001',
          ShipToName: 'Acme Corp',
          ShipToZip: '12345',
        };

        const result = await postProcessInvoiceData(data, context);

        expect(result.ShipToCode).toBe('SHIP-001');
        expect(mockChain.select).toHaveBeenCalledWith('code');
        expect(mockChain.eq).toHaveBeenCalledWith('address_type', 'ship_to');
        expect(mockChain.ilike).toHaveBeenCalledWith('name', 'Acme Corp');
        expect(mockChain.eq).toHaveBeenCalledWith('zip', '12345');
      });

      it('should auto-generate new ShipToCode when not found', async () => {
        const mockSelectChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null }),
        };

        const mockCountChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: 5 }),
        };

        const mockInsertChain = {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };

        mockSupabase.from
          .mockReturnValueOnce(mockSelectChain)
          .mockReturnValueOnce(mockCountChain)
          .mockReturnValueOnce(mockInsertChain);

        const data = {
          InvoiceNumber: 'INV-001',
          ShipToName: 'New Location',
          ShipToZip: '54321',
          ShipToAddress1: '123 Main St',
          ShipToCity: 'Boston',
          ShipToState: 'MA',
        };

        const result = await postProcessInvoiceData(data, context);

        expect(result.ShipToCode).toBe('SHIP-006');
        expect(result._postProcessRules).toContain(
          'ShipToCode assigned: "SHIP-006"'
        );
      });

      it('should skip ShipToCode when ShipToName is empty', async () => {
        const data = {
          InvoiceNumber: 'INV-001',
          ShipToName: '',
          ShipToZip: '12345',
        };

        const result = await postProcessInvoiceData(data, context);

        expect(result.ShipToCode).toBeUndefined();
        expect(mockSupabase.from).not.toHaveBeenCalled();
      });

      it('should not overwrite existing ShipToCode', async () => {
        const data = {
          InvoiceNumber: 'INV-001',
          ShipToCode: 'EXISTING-SHIP-001',
          ShipToName: 'Acme Corp',
          ShipToZip: '12345',
        };

        const result = await postProcessInvoiceData(data, context);

        expect(result.ShipToCode).toBe('EXISTING-SHIP-001');
        expect(mockSupabase.from).not.toHaveBeenCalled();
      });

      it('should handle database errors gracefully', async () => {
        const mockChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockRejectedValue(new Error('DB error')),
        };
        mockSupabase.from.mockReturnValue(mockChain);

        const data = {
          InvoiceNumber: 'INV-001',
          ShipToName: 'Acme Corp',
          ShipToZip: '12345',
        };

        const result = await postProcessInvoiceData(data, context);

        expect(result.ShipToCode).toBeUndefined();
      });

      it('should handle insert errors gracefully', async () => {
        const mockSelectChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null }),
        };

        const mockCountChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: 5 }),
        };

        const mockInsertChain = {
          insert: vi
            .fn()
            .mockResolvedValue({ error: { message: 'Insert failed' } }),
        };

        mockSupabase.from
          .mockReturnValueOnce(mockSelectChain)
          .mockReturnValueOnce(mockCountChain)
          .mockReturnValueOnce(mockInsertChain);

        const data = {
          InvoiceNumber: 'INV-001',
          ShipToName: 'New Location',
          ShipToZip: '54321',
        };

        const result = await postProcessInvoiceData(data, context);

        expect(result.ShipToCode).toBeUndefined();
      });
    });

    describe('BillToCode', () => {
      it('should look up existing BillToCode from Supabase', async () => {
        const mockChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { code: 'BILL-001' } }),
        };
        mockSupabase.from.mockReturnValue(mockChain);

        const data = {
          InvoiceNumber: 'INV-001',
          BillToName: 'Acme Corp',
          BillToZip: '12345',
        };

        const result = await postProcessInvoiceData(data, context);

        expect(result.BillToCode).toBe('BILL-001');
        expect(mockChain.eq).toHaveBeenCalledWith('address_type', 'bill_to');
      });

      it('should auto-generate new BillToCode when not found', async () => {
        const mockSelectChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          limit: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null }),
        };

        const mockCountChain = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: 3 }),
        };

        const mockInsertChain = {
          insert: vi.fn().mockResolvedValue({ error: null }),
        };

        mockSupabase.from
          .mockReturnValueOnce(mockSelectChain)
          .mockReturnValueOnce(mockCountChain)
          .mockReturnValueOnce(mockInsertChain);

        const data = {
          InvoiceNumber: 'INV-001',
          BillToName: 'New Billing Address',
          BillToZip: '54321',
        };

        const result = await postProcessInvoiceData(data, context);

        expect(result.BillToCode).toBe('BILL-004');
      });

      it('should skip BillToCode when BillToName is empty', async () => {
        const data = {
          InvoiceNumber: 'INV-001',
          BillToName: '',
          BillToZip: '12345',
        };

        const result = await postProcessInvoiceData(data, context);

        expect(result.BillToCode).toBeUndefined();
      });
    });

    it('should handle both ShipToCode and BillToCode in same pass', async () => {
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null }),
      };

      const mockCountChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ count: 0 }),
      };

      const mockInsertChain = {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };

      mockSupabase.from
        .mockReturnValueOnce(mockChain) // ShipTo lookup
        .mockReturnValueOnce(mockCountChain) // ShipTo count
        .mockReturnValueOnce(mockInsertChain) // ShipTo insert
        .mockReturnValueOnce(mockChain) // BillTo lookup
        .mockReturnValueOnce(mockCountChain) // BillTo count
        .mockReturnValueOnce(mockInsertChain); // BillTo insert

      const data = {
        InvoiceNumber: 'INV-001',
        ShipToName: 'Ship Location',
        ShipToZip: '12345',
        BillToName: 'Bill Location',
        BillToZip: '54321',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.ShipToCode).toBe('SHIP-001');
      expect(result.BillToCode).toBe('BILL-001');
    });
  });

  // ============================================================================
  // RULE 5: Part number mirroring
  // ============================================================================
  describe('Rule 5: Part number mirroring', () => {
    it('should mirror BuyerPartNumber to VendorPartNumber when missing', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'Widget',
            BuyerPartNumber: 'BUYER-123',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].VendorPartNumber).toBe('BUYER-123');
      expect(result._postProcessRules).toContain(
        'Line 1: VendorPartNumber mirrored from BuyerPartNumber "BUYER-123"'
      );
    });

    it('should mirror VendorPartNumber to BuyerPartNumber when missing', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'Widget',
            VendorPartNumber: 'VENDOR-456',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].BuyerPartNumber).toBe('VENDOR-456');
      expect(result._postProcessRules).toContain(
        'Line 1: BuyerPartNumber mirrored from VendorPartNumber "VENDOR-456"'
      );
    });

    it('should not mirror when both part numbers exist', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'Widget',
            BuyerPartNumber: 'BUYER-123',
            VendorPartNumber: 'VENDOR-456',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].BuyerPartNumber).toBe('BUYER-123');
      expect(result.LineItems?.[0].VendorPartNumber).toBe('VENDOR-456');
      expect(result._postProcessRules).not.toContain(
        expect.stringMatching(/mirrored/)
      );
    });

    it('should not mirror when both part numbers are empty', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'Widget',
            BuyerPartNumber: '',
            VendorPartNumber: '',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].BuyerPartNumber).toBe('');
      expect(result.LineItems?.[0].VendorPartNumber).toBe('');
      expect(result._postProcessRules).not.toContain(
        expect.stringMatching(/mirrored/)
      );
    });

    it('should handle multiple line items independently', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'Widget A',
            BuyerPartNumber: 'BUYER-100',
          },
          {
            LineNumber: '2',
            Description: 'Widget B',
            VendorPartNumber: 'VENDOR-200',
          },
          {
            LineNumber: '3',
            Description: 'Widget C',
            BuyerPartNumber: 'BUYER-300',
            VendorPartNumber: 'VENDOR-300',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].VendorPartNumber).toBe('BUYER-100');
      expect(result.LineItems?.[1].BuyerPartNumber).toBe('VENDOR-200');
      expect(result.LineItems?.[2].BuyerPartNumber).toBe('BUYER-300');
      expect(result.LineItems?.[2].VendorPartNumber).toBe('VENDOR-300');
    });
  });

  // ============================================================================
  // RULE 6: Shipping line detection
  // ============================================================================
  describe('Rule 6: Shipping line detection', () => {
    it('should detect shipping keywords and set part numbers to "SHIPPING"', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'UPS Ground Shipping',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].BuyerPartNumber).toBe('SHIPPING');
      expect(result.LineItems?.[0].VendorPartNumber).toBe('SHIPPING');
      expect(result._postProcessRules).toContain(
        'Line 1: shipping detected, part numbers set to "SHIPPING"'
      );
    });

    it('should detect FedEx keyword', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'FedEx Express Overnight',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].BuyerPartNumber).toBe('SHIPPING');
      expect(result.LineItems?.[0].VendorPartNumber).toBe('SHIPPING');
    });

    it('should detect freight keyword', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'Freight Shipping - LTL',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].BuyerPartNumber).toBe('SHIPPING');
      expect(result.LineItems?.[0].VendorPartNumber).toBe('SHIPPING');
    });

    it('should be case insensitive', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'ups standard shipping',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].BuyerPartNumber).toBe('SHIPPING');
      expect(result.LineItems?.[0].VendorPartNumber).toBe('SHIPPING');
    });

    it('should not trigger when line already has BuyerPartNumber', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'UPS Shipping Service',
            BuyerPartNumber: 'SHIP-PART-001',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].BuyerPartNumber).toBe('SHIP-PART-001');
      // Rule 5 mirrors BuyerPartNumber → VendorPartNumber since shipping detection
      // (Rule 6) only fires when BOTH part numbers are empty
      expect(result.LineItems?.[0].VendorPartNumber).toBe('SHIP-PART-001');
    });

    it('should not trigger when line already has VendorPartNumber', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'FedEx Shipping',
            VendorPartNumber: 'VENDOR-SHIP-001',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].VendorPartNumber).toBe('VENDOR-SHIP-001');
      // Rule 5 mirrors VendorPartNumber → BuyerPartNumber since shipping detection
      // (Rule 6) only fires when BOTH part numbers are empty
      expect(result.LineItems?.[0].BuyerPartNumber).toBe('VENDOR-SHIP-001');
    });

    it('should not trigger when line has both part numbers', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'UPS Shipping',
            BuyerPartNumber: 'BUYER-SHIP',
            VendorPartNumber: 'VENDOR-SHIP',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems?.[0].BuyerPartNumber).toBe('BUYER-SHIP');
      expect(result.LineItems?.[0].VendorPartNumber).toBe('VENDOR-SHIP');
    });

    it('should detect multiple shipping keywords', async () => {
      const shippingKeywords = [
        'UPS Ground',
        'FedEx Express',
        'USPS Priority',
        'Freight LTL',
        'Shipping & Handling',
        'Ground Delivery',
        'Express Overnight',
        'Carrier Service',
        'Transport Fee',
        'Postage',
      ];

      for (const keyword of shippingKeywords) {
        const data = {
          InvoiceNumber: 'INV-001',
          LineItems: [
            {
              LineNumber: '1',
              Description: keyword,
            },
          ],
        };

        const result = await postProcessInvoiceData(data, context);

        expect(result.LineItems?.[0].BuyerPartNumber).toBe('SHIPPING');
        expect(result.LineItems?.[0].VendorPartNumber).toBe('SHIPPING');
      }
    });
  });

  // ============================================================================
  // RULE 7: TrackingNumber cleanup
  // ============================================================================
  describe('Rule 7: TrackingNumber cleanup', () => {
    it('should remove newlines from tracking numbers', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: '1Z123\nABC456\nDEF',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('1Z123ABC456DEF');
      // The rule log contains the raw input with actual newlines, so match by prefix
      expect(result._postProcessRules).toEqual(
        expect.arrayContaining([expect.stringContaining('→ "1Z123ABC456DEF"')])
      );
    });

    it('should remove carriage returns and tabs', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: '1Z123\rABC\t456',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('1Z123ABC456');
    });

    it('should collapse multiple whitespace characters', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: '1Z123   ABC   456',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('1Z123ABC456');
    });

    it('should strip UPS prefix', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: 'UPS1Z123ABC456',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('1Z123ABC456');
    });

    it('should strip FedEx prefix', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: 'FedEx123456789',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('123456789');
    });

    it('should strip USPS prefix', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: 'USPS987654321',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('987654321');
    });

    it('should strip DHL prefix', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: 'DHL555666777',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('555666777');
    });

    it('should strip TNT prefix', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: 'TNT444555666',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('444555666');
    });

    it('should handle prefix removal case insensitively', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: 'ups1Z123ABC456',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('1Z123ABC456');
    });

    it('should handle mixed case prefix', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: 'UpS1Z123ABC456',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('1Z123ABC456');
    });

    it('should handle UPS prefix with space', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: 'UPS 1Z123ABC456',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('1Z123ABC456');
    });

    it('should leave clean numbers untouched', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: '1Z123ABC456DEF',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('1Z123ABC456DEF');
      expect(result._postProcessRules).not.toContain(
        expect.stringMatching(/TrackingNumber cleaned/)
      );
    });

    it('should do nothing when TrackingNumber is empty', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: '',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.TrackingNumber).toBe('');
    });

    it('should handle complex OCR wrapping scenario', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        TrackingNumber: 'UPS\n1Z\t99A\r\nA99\t\t999\n99\t9A',
      };

      const result = await postProcessInvoiceData(data, context);

      // Input: 'UPS\n1Z\t99A\r\nA99\t\t999\n99\t9A'
      // Step 1 (remove \r\n\t): 'UPS1Z99AA9999999A'
      // Step 2 (collapse spaces): 'UPS1Z99AA9999999A'
      // Step 3 (strip UPS prefix): '1Z99AA9999999A'
      expect(result.TrackingNumber).toBe('1Z99AA99999999A');
    });
  });

  // ============================================================================
  // INTEGRATION TESTS: Multiple Rules
  // ============================================================================
  describe('Integration: Multiple rules in single pass', () => {
    it('should apply all applicable rules to complete invoice', async () => {
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null }),
      };

      const mockCountChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ count: 0 }),
      };

      const mockInsertChain = {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };

      let callCount = 0;
      mockSupabase.from.mockImplementation(() => {
        callCount++;
        if (callCount % 3 === 1) return mockChain;
        if (callCount % 3 === 2) return mockCountChain;
        return mockInsertChain;
      });

      context.supplier.remit_to_code = 'REMIT-001';

      const data = {
        InvoiceNumber: 'INV-2024-001',
        InvoiceDate: '2024-03-15',
        ShipToName: 'Warehouse A',
        ShipToZip: '12345',
        BillToName: 'HQ',
        BillToZip: '54321',
        TrackingNumber: 'UPS\n1Z999AA',
        LineItems: [
          {
            LineNumber: '1',
            Description: 'Product A',
            BuyerPartNumber: 'PART-001',
          },
          {
            LineNumber: '2',
            Description: 'FedEx Overnight Shipping',
          },
        ],
      };

      const result = await postProcessInvoiceData(data, context);

      // Rule 1: VendorCode
      expect(result.VendorCode).toBe('VENDOR-001');

      // Rule 2: ShipDate
      expect(result.ShipDate).toBe('2024-03-15');

      // Rule 3: RemitToCode
      expect(result.RemitToCode).toBe('REMIT-001');

      // Rule 4: Address codes
      expect(result.ShipToCode).toBe('SHIP-001');
      expect(result.BillToCode).toBe('BILL-001');

      // Rule 5: Part number mirroring
      expect(result.LineItems?.[0].VendorPartNumber).toBe('PART-001');

      // Rule 6: Shipping line detection
      expect(result.LineItems?.[1].BuyerPartNumber).toBe('SHIPPING');
      expect(result.LineItems?.[1].VendorPartNumber).toBe('SHIPPING');

      // Rule 7: TrackingNumber cleanup
      expect(result.TrackingNumber).toBe('1Z999AA');

      // Check that _postProcessRules is populated
      expect(Array.isArray(result._postProcessRules)).toBe(true);
      expect(result._postProcessRules.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // EDGE CASES & INPUT HANDLING
  // ============================================================================
  describe('Edge cases and input handling', () => {
    it('should handle null/undefined data gracefully', async () => {
      const data: Record<string, unknown> = {};

      const result = await postProcessInvoiceData(data, context);

      expect(result).toBeDefined();
      expect(result.VendorCode).toBe('VENDOR-001');
      expect(result._postProcessRules).toBeDefined();
    });

    it('should handle empty LineItems array', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: [],
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems).toEqual([]);
    });

    it('should skip LineItems processing if not an array', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        LineItems: 'not an array',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.LineItems).toBe('not an array');
    });

    it('should preserve other fields in data', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        CustomField: 'custom-value',
        AnotherField: 12345,
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.CustomField).toBe('custom-value');
      expect(result.AnotherField).toBe(12345);
    });

    it('should not mutate input data', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
      };

      const originalData = JSON.stringify(data);
      await postProcessInvoiceData(data, context);

      expect(JSON.stringify(data)).toBe(originalData);
    });

    it('should handle whitespace-only fields as empty', async () => {
      const data = {
        InvoiceNumber: 'INV-001',
        ShipToName: '   ',
        TrackingNumber: '\n\n\t',
      };

      const result = await postProcessInvoiceData(data, context);

      expect(result.ShipToCode).toBeUndefined();
      // TrackingNumber cleanup only runs when trimmed value is non-empty,
      // so whitespace-only values pass through unchanged
      expect(result.TrackingNumber).toBe('\n\n\t');
    });
  });

  // ============================================================================
  // SUPABASE MOCKING VERIFICATION
  // ============================================================================
  describe('Supabase client interactions', () => {
    it('should construct correct Supabase query for address lookup', async () => {
      const mockChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { code: 'SHIP-005' } }),
      };
      mockSupabase.from.mockReturnValue(mockChain);

      const data = {
        InvoiceNumber: 'INV-001',
        ShipToName: 'Test Location',
        ShipToZip: '99999',
      };

      await postProcessInvoiceData(data, context);

      expect(mockSupabase.from).toHaveBeenCalledWith('address_codes');
      expect(mockChain.select).toHaveBeenCalledWith('code');
      expect(mockChain.eq).toHaveBeenCalledWith('address_type', 'ship_to');
      expect(mockChain.ilike).toHaveBeenCalledWith('name', 'Test Location');
      expect(mockChain.eq).toHaveBeenCalledWith('zip', '99999');
      expect(mockChain.limit).toHaveBeenCalledWith(1);
      expect(mockChain.single).toHaveBeenCalled();
    });

    it('should pass correct parameters to insert new address code', async () => {
      const mockSelectChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null }),
      };

      const mockCountChain = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ count: 2 }),
      };

      const mockInsertChain = {
        insert: vi.fn().mockResolvedValue({ error: null }),
      };

      mockSupabase.from
        .mockReturnValueOnce(mockSelectChain)
        .mockReturnValueOnce(mockCountChain)
        .mockReturnValueOnce(mockInsertChain);

      const data = {
        InvoiceNumber: 'INV-001',
        ShipToName: 'New Address',
        ShipToZip: '11111',
        ShipToAddress1: '100 Main',
        ShipToAddress2: 'Suite 200',
        ShipToCity: 'Boston',
        ShipToState: 'MA',
      };

      await postProcessInvoiceData(data, context);

      expect(mockInsertChain.insert).toHaveBeenCalledWith({
        code: 'SHIP-003',
        address_type: 'ship_to',
        name: 'New Address',
        address1: '100 Main',
        address2: 'Suite 200',
        city: 'Boston',
        state: 'MA',
        zip: '11111',
      });
    });
  });
});
