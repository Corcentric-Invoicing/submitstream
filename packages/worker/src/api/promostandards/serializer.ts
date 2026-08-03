// ============================================
// PromoStandards SOAP Envelope Serializer
//
// Builds SOAP 1.1 envelopes for the two operations in the
// PromoStandards Invoice 1.0.0 service:
//
//   - getInvoices          (SOAPAction: "getInvoices")
//   - getVoidedInvoices    (SOAPAction: "getVoidedInvoices")
//
// Authoritative source for structure/naming: the official
// WSDL + XSDs at `worker-deploy/wsdl/promostandards-invoice/`
// (shipped with this repo). Two things to know:
//
//  1) Two namespaces are in play.
//       ns  = http://www.promostandards.org/WSDL/Invoice/1.0.0/
//             → wraps the request root element (GetInvoicesRequest)
//       shar= http://www.promostandards.org/WSDL/Invoice/1.0.0/SharedObjects/
//             → holds every leaf element (wsVersion, id, password, …)
//       With elementFormDefault="qualified", every element must
//       carry the correct prefix.
//
//  2) Element order inside GetInvoicesRequest is strict:
//       wsVersion, id, password, queryType, referenceNumber,
//       requestedDate, availableTimeStamp.
//     The XSD declares password as required (no minOccurs=0), so
//     we always emit the element; we pass "" when no password is
//     configured and let the supplier reject it.
// ============================================

import type {
  GetInvoiceRequest,
  GetVoidedInvoiceRequest,
  InvoiceQueryType,
} from './types';

export const NS_INVOICE = 'http://www.promostandards.org/WSDL/Invoice/1.0.0/';
export const NS_SHARED  = 'http://www.promostandards.org/WSDL/Invoice/1.0.0/SharedObjects/';

/** Escape a value so it is safe to embed between XML tags. */
function xmlEscape(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Emit `<shar:tag>value</shar:tag>`; when value is empty emit `<shar:tag/>`. */
function shar(tag: string, value: string | number | undefined, required: boolean): string {
  if (value === undefined || value === null || value === '') {
    return required ? `<shar:${tag}/>` : '';
  }
  return `<shar:${tag}>${xmlEscape(value)}</shar:${tag}>`;
}

/**
 * Build a getInvoices SOAP 1.1 envelope.
 *
 * Sequence (from GetInvoicesRequest.xsd):
 *   wsVersion → id → password → queryType → referenceNumber?
 *   → requestedDate? → availableTimeStamp?
 */
export function buildGetInvoicesEnvelope(req: GetInvoiceRequest): string {
  const body =
    shar('wsVersion',          req.wsVersion,          true) +
    shar('id',                 req.id,                 true) +
    shar('password',           req.password ?? '',     true) +
    shar('queryType',          req.queryType,          true) +
    shar('referenceNumber',    req.referenceNumber,    false) +
    shar('requestedDate',      req.requestedDate,      false) +
    shar('availableTimeStamp', req.availableTimeStamp, false);

  return envelope('GetInvoicesRequest', body);
}

/** Build a getVoidedInvoices SOAP 1.1 envelope (same shape as getInvoices). */
export function buildGetVoidedInvoicesEnvelope(req: GetVoidedInvoiceRequest): string {
  const body =
    shar('wsVersion',          req.wsVersion,          true) +
    shar('id',                 req.id,                 true) +
    shar('password',           req.password ?? '',     true) +
    shar('queryType',          req.queryType,          true) +
    shar('referenceNumber',    req.referenceNumber,    false) +
    shar('requestedDate',      req.requestedDate,      false) +
    shar('availableTimeStamp', req.availableTimeStamp, false);

  return envelope('GetVoidedInvoicesRequest', body);
}

function envelope(rootLocalName: string, innerXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns="${NS_INVOICE}"
  xmlns:shar="${NS_SHARED}">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:${rootLocalName}>${innerXml}</ns:${rootLocalName}>
  </soapenv:Body>
</soapenv:Envelope>`;
}

/**
 * SOAPAction header value per the WSDL binding:
 *   <soap:operation soapAction="getInvoices" …/>
 * HTTP clients must quote the value.
 */
export function soapActionFor(op: 'getInvoices' | 'getVoidedInvoices'): string {
  return `"${op}"`;
}

export type { InvoiceQueryType };
