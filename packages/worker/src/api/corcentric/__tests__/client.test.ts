// ============================================
// Tests for Corcentric DMS Client
// Response parsing & status mapping
// ============================================

import { describe, it, expect } from 'vitest';
import { parseCorResponse, corStatusToSubmissionStatus } from '../client';

describe('parseCorResponse', () => {
  it('parses a successful response (status code 2)', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
    <ProcessResponse>
      <corResponse>
        <corRequestID>REQ-123</corRequestID>
        <corResponseID>RESP-456</corResponseID>
        <corResponseStatusCode>2</corResponseStatusCode>
        <corVendorCode>ACME001</corVendorCode>
        <corCustomerCode>CUST001</corCustomerCode>
        <corTransactionNumber>INV-2026-001</corTransactionNumber>
        <corAuthorizationCode>AUTH-789</corAuthorizationCode>
        <corTransactionAmount>1250.0000</corTransactionAmount>
      </corResponse>
    </ProcessResponse>`;

    const result = parseCorResponse(xml);
    expect(result).not.toBeNull();
    expect(result!.corResponseID).toBe('RESP-456');
    expect(result!.corResponseStatusCode).toBe(2);
    expect(result!.corVendorCode).toBe('ACME001');
    expect(result!.corTransactionNumber).toBe('INV-2026-001');
    expect(result!.corAuthorizationCode).toBe('AUTH-789');
    expect(result!.corTransactionAmount).toBe('1250.0000');
  });

  it('parses a denied response (status code 1) with messages', () => {
    const xml = `<ProcessResponse>
      <corResponse>
        <corResponseID>RESP-789</corResponseID>
        <corResponseStatusCode>1</corResponseStatusCode>
        <corResponseMessages>
          <corResponseMessage>
            <corResponseMessageType>Error</corResponseMessageType>
            <corResponseMessageCode>E100</corResponseMessageCode>
            <corResponseMessage>Vendor code not recognized</corResponseMessage>
          </corResponseMessage>
        </corResponseMessages>
      </corResponse>
    </ProcessResponse>`;

    const result = parseCorResponse(xml);
    expect(result).not.toBeNull();
    expect(result!.corResponseStatusCode).toBe(1);
    expect(result!.corResponseMessages).toBeDefined();
    expect(result!.corResponseMessages!.length).toBeGreaterThanOrEqual(1);
  });

  it('parses an invalid response (status code 0)', () => {
    const xml = `<ProcessResponse>
      <corResponse>
        <corResponseID>RESP-001</corResponseID>
        <corResponseStatusCode>0</corResponseStatusCode>
      </corResponse>
    </ProcessResponse>`;

    const result = parseCorResponse(xml);
    expect(result).not.toBeNull();
    expect(result!.corResponseStatusCode).toBe(0);
  });

  it('parses a warning response (status code 3)', () => {
    const xml = `<ProcessResponse>
      <corResponse>
        <corResponseID>RESP-WARN</corResponseID>
        <corResponseStatusCode>3</corResponseStatusCode>
        <corTransactionNumber>INV-003</corTransactionNumber>
        <corResponseMessages>
          <corResponseMessage>
            <corResponseMessageType>Warning</corResponseMessageType>
            <corResponseMessageCode>W200</corResponseMessageCode>
            <corResponseMessage>Line item quantity exceeds expected range</corResponseMessage>
          </corResponseMessage>
        </corResponseMessages>
      </corResponse>
    </ProcessResponse>`;

    const result = parseCorResponse(xml);
    expect(result).not.toBeNull();
    expect(result!.corResponseStatusCode).toBe(3);
    expect(result!.corTransactionNumber).toBe('INV-003');
  });

  it('returns null for empty string', () => {
    expect(parseCorResponse('')).toBeNull();
  });

  it('returns null for non-XML response', () => {
    expect(parseCorResponse('Internal Server Error')).toBeNull();
  });

  it('returns null for XML without corResponse block', () => {
    expect(parseCorResponse('<html><body>Not found</body></html>')).toBeNull();
  });

  it('handles missing optional fields', () => {
    const xml = `<ProcessResponse>
      <corResponse>
        <corResponseID>RESP-MIN</corResponseID>
        <corResponseStatusCode>2</corResponseStatusCode>
      </corResponse>
    </ProcessResponse>`;

    const result = parseCorResponse(xml);
    expect(result).not.toBeNull();
    expect(result!.corResponseID).toBe('RESP-MIN');
    expect(result!.corVendorCode).toBeUndefined();
    expect(result!.corResponseMessages).toBeUndefined();
  });
});

describe('corStatusToSubmissionStatus', () => {
  it('maps status code 0 to invalid', () => {
    expect(corStatusToSubmissionStatus(0)).toBe('invalid');
  });

  it('maps status code 1 to denied', () => {
    expect(corStatusToSubmissionStatus(1)).toBe('denied');
  });

  it('maps status code 2 to success', () => {
    expect(corStatusToSubmissionStatus(2)).toBe('success');
  });

  it('maps status code 3 to warning', () => {
    expect(corStatusToSubmissionStatus(3)).toBe('warning');
  });
});

describe('auto-submit eligibility', () => {
  // Import here since it's a simple function
  it('requires all three codes and enabled flag', async () => {
    const { isAutoSubmitEligible } = await import('../auto-submit');

    expect(isAutoSubmitEligible({
      cor_ingestion_enabled: true,
      cor_vendor_code: 'V1',
      cor_customer_code: 'C1',
      cor_community_code: 'COM1',
      cor_username: 'user',
      cor_password: 'pass',
    })).toBe(true);

    expect(isAutoSubmitEligible({
      cor_ingestion_enabled: false,
      cor_vendor_code: 'V1',
      cor_customer_code: 'C1',
      cor_community_code: 'COM1',
    })).toBe(false);

    expect(isAutoSubmitEligible({
      cor_ingestion_enabled: true,
      cor_vendor_code: '',
      cor_customer_code: 'C1',
      cor_community_code: 'COM1',
    })).toBe(false);

    expect(isAutoSubmitEligible({
      cor_ingestion_enabled: true,
      cor_vendor_code: 'V1',
      cor_customer_code: null,
      cor_community_code: 'COM1',
    })).toBe(false);
  });
});
