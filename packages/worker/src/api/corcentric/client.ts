// ============================================
// Corcentric DMS Web Service HTTP Client
//
// Handles the actual HTTP POST to Corcentric's
// DMS API endpoint and parses the XML response.
// ============================================

import type { CorResponse, CorResponseStatusCode, CorResponseMessage } from './types';

export interface CorcentricClientConfig {
  /** Corcentric DMS API endpoint URL (e.g. https://dmsservice-uat.corcentric.com/IPW/RequestProcessor.svc) */
  apiUrl: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
}

export interface CorcentricSubmitResult {
  /** Whether the HTTP request succeeded (not necessarily accepted by Corcentric) */
  httpSuccess: boolean;
  /** HTTP status code from Corcentric's server */
  httpStatus: number;
  /** Raw XML response body */
  responseXml: string;
  /** Parsed response (null if XML parsing failed) */
  response: CorResponse | null;
  /** Error message if something went wrong on our side */
  error?: string;
  /** Time taken for the HTTP roundtrip in ms */
  durationMs: number;
}


/**
 * Submit a Corcentric DMS XML request to their API endpoint.
 *
 * @param xml - Serialized ProcessRequest XML string
 * @param config - API URL and optional timeout
 * @returns Parsed result with response details
 */
export async function submitToCorcentricApi(
  xml: string,
  config: CorcentricClientConfig,
): Promise<CorcentricSubmitResult> {
  const startTime = Date.now();
  const timeoutMs = config.timeoutMs ?? 30000;

  const apiUrl = config.apiUrl;

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Accept': 'text/xml',
      },
      body: xml,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseXml = await response.text();
    const durationMs = Date.now() - startTime;

    // Parse the response XML
    const parsed = parseCorResponse(responseXml);

    return {
      httpSuccess: response.ok,
      httpStatus: response.status,
      responseXml,
      response: parsed,
      durationMs,
    };
  } catch (error) {
    const durationMs = Date.now() - startTime;

    if (error instanceof DOMException && error.name === 'AbortError') {
      return {
        httpSuccess: false,
        httpStatus: 0,
        responseXml: '',
        response: null,
        error: `Request timed out after ${timeoutMs}ms`,
        durationMs,
      };
    }

    const message = error instanceof Error ? error.message : 'Unknown network error';
    return {
      httpSuccess: false,
      httpStatus: 0,
      responseXml: '',
      response: null,
      error: `Network error: ${message}`,
      durationMs,
    };
  }
}

// ── XML Response Parser ──

/**
 * Parse Corcentric DMS XML response into structured data.
 *
 * Response format (from DMS spec v2.2):
 * <?xml version='1.0' encoding='UTF-8' ?>
 * <corResponse>
 *   <corRequestID>...</corRequestID>
 *   <corResponseID>...</corResponseID>
 *   <corResponseStatusCode>2</corResponseStatusCode>
 *   <corVendorCode>...</corVendorCode>
 *   <corCustomerCode>...</corCustomerCode>
 *   <corTransactionNumber>...</corTransactionNumber>
 *   <corAuthorizationCode>...</corAuthorizationCode>
 *   <corTransactionAmount>...</corTransactionAmount>
 *   <corResponseMessages>
 *     <corResponseMessage>
 *       <corResponseMessageType>...</corResponseMessageType>
 *       <corResponseMessageCode>...</corResponseMessageCode>
 *       <corResponseMessageComment>...</corResponseMessageComment>
 *     </corResponseMessage>
 *   </corResponseMessages>
 * </corResponse>
 */
export function parseCorResponse(xml: string): CorResponse | null {
  try {
    if (!xml || !xml.includes('corResponse')) return null;

    const getTag = (tag: string, source: string): string => {
      const match = source.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return match ? match[1].trim() : '';
    };

    // Extract the corResponse block (tag may have xmlns attributes)
    const corResponseMatch = xml.match(/<corResponse[^>]*>([\s\S]*?)<\/corResponse>/);
    if (!corResponseMatch) return null;
    const block = corResponseMatch[1];

    const statusCode = parseInt(getTag('corResponseStatusCode', block), 10);

    // Parse response messages (tag may have attributes)
    const messages: CorResponseMessage[] = [];
    const msgRegex = /<corResponseMessage[^>]*>([\s\S]*?)<\/corResponseMessage>/g;
    let msgMatch;
    while ((msgMatch = msgRegex.exec(block)) !== null) {
      const msgBlock = msgMatch[1];
      // Inner corResponseMessage tag has same name — look for typed children
      const msgType = getTag('corResponseMessageType', msgBlock);
      const msgCode = getTag('corResponseMessageCode', msgBlock);
      // DMS spec uses corResponseMessageComment for message text
      const msgText = getTag('corResponseMessageComment', msgBlock) || getTag('corResponseMessage', msgBlock);
      // Avoid self-reference: only add if we got meaningful content
      if (msgType || msgCode || (msgText && msgText !== msgBlock.trim())) {
        messages.push({
          corResponseMessageType: msgType,
          corResponseMessageCode: msgCode,
          corResponseMessage: msgText,
        });
      }
    }

    return {
      corRequestID: getTag('corRequestID', block) || undefined,
      corResponseID: getTag('corResponseID', block),
      corResponseStatusCode: (isNaN(statusCode) ? 0 : statusCode) as CorResponseStatusCode,
      corVendorCode: getTag('corVendorCode', block) || undefined,
      corCustomerCode: getTag('corCustomerCode', block) || undefined,
      corTransactionNumber: getTag('corTransactionNumber', block) || undefined,
      corAuthorizationCode: getTag('corAuthorizationCode', block) || undefined,
      corTransactionAmount: getTag('corTransactionAmount', block) || undefined,
      corResponseMessages: messages.length > 0 ? messages : undefined,
    };
  } catch (err) {
    console.error('[Corcentric Client] Failed to parse response XML:', err);
    return null;
  }
}

/**
 * Map Corcentric status code to our submission status string.
 */
export function corStatusToSubmissionStatus(
  statusCode: CorResponseStatusCode,
): 'invalid' | 'denied' | 'success' | 'warning' {
  switch (statusCode) {
    case 0: return 'invalid';
    case 1: return 'denied';
    case 2: return 'success';
    case 3: return 'warning';
    default: return 'invalid';
  }
}
