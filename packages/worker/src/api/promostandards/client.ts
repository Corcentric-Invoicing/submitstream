// ============================================
// PromoStandards Invoice 1.0.0 — HTTP Client
//
// Posts the SOAP envelope to a supplier's endpoint and parses
// the XML response into typed objects. Runs inside Cloudflare
// Workers with no XML-parser dependency — we use a namespace-
// stripping regex parser (same approach as the Corcentric
// client). Element casing from the WSDL/XSD is preserved.
//
// Response structure (abridged, per GetInvoicesResponse.xsd +
// SharedObjectsInvoice.xsd):
//
//   <GetInvoicesResponse>
//     <InvoiceArray>
//       <Invoice>
//         <invoiceNumber>…</invoiceNumber>
//         …
//         <BillTo>
//           <AccountInfo>
//             <accountName>…</accountName>
//             <Address1>…</Address1>       ← note PascalCase
//             …
//           </AccountInfo>
//         </BillTo>
//         <SoldTo><AccountInfo>…</AccountInfo></SoldTo>
//         …
//         <fob>…</fob>                      ← not fobId
//         …
//         <InvoiceLineItemsArray>
//           <InvoiceLineItem>…</InvoiceLineItem>…
//         </InvoiceLineItemsArray>
//         <SalesOrderNumbersArray>
//           <salesOrderNumber>…</salesOrderNumber>…  ← repeated leaf
//         </SalesOrderNumbersArray>
//         <TaxArray>
//           <tax>                            ← lowercase
//             <taxType>…</taxType>
//             <taxJurisdiction>…</taxJurisdiction>
//             <taxAmount>…</taxAmount>
//           </tax>…
//         </TaxArray>
//       </Invoice>…
//     </InvoiceArray>
//     <ServiceMessageArray>
//       <ServiceMessage>
//         <code>…</code><description>…</description><severity>…</severity>
//       </ServiceMessage>…
//     </ServiceMessageArray>
//   </GetInvoicesResponse>
// ============================================

import {
  buildGetInvoicesEnvelope,
  buildGetVoidedInvoicesEnvelope,
  soapActionFor,
} from './serializer';
import type {
  GetInvoiceRequest,
  GetVoidedInvoiceRequest,
  GetInvoiceResponse,
  GetVoidedInvoiceResponse,
  Invoice,
  VoidedInvoice,
  InvoiceLineItem,
  AccountInfo,
  Tax,
  SalesOrderNumber,
  ServiceMessage,
  InvoiceType,
  TaxType,
  QuantityUOM,
  ServiceMessageSeverity,
} from './types';

export interface PromostandardsClientConfig {
  endpointUrl: string;
  timeoutMs?: number;
}

export interface PromostandardsCallResult<T> {
  httpSuccess: boolean;
  httpStatus: number;
  responseXml: string;
  response: T | null;
  error?: string;
  durationMs: number;
}

// ── Public entry points ─────────────────────────────────────────

export async function callGetInvoices(
  req: GetInvoiceRequest,
  config: PromostandardsClientConfig,
): Promise<PromostandardsCallResult<GetInvoiceResponse>> {
  const xml = buildGetInvoicesEnvelope(req);
  return postSoap(xml, 'getInvoices', config, parseGetInvoicesResponse);
}

export async function callGetVoidedInvoices(
  req: GetVoidedInvoiceRequest,
  config: PromostandardsClientConfig,
): Promise<PromostandardsCallResult<GetVoidedInvoiceResponse>> {
  const xml = buildGetVoidedInvoicesEnvelope(req);
  return postSoap(xml, 'getVoidedInvoices', config, parseGetVoidedInvoicesResponse);
}

// ── HTTP transport ──────────────────────────────────────────────

async function postSoap<T>(
  xml: string,
  op: 'getInvoices' | 'getVoidedInvoices',
  config: PromostandardsClientConfig,
  parser: (xml: string) => T | null,
): Promise<PromostandardsCallResult<T>> {
  const started = Date.now();
  const timeoutMs = config.timeoutMs ?? 45000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(config.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Accept': 'text/xml',
        'SOAPAction': soapActionFor(op),
      },
      body: xml,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const responseXml = await res.text();
    const parsed = parser(responseXml);

    return {
      httpSuccess: res.ok,
      httpStatus: res.status,
      responseXml,
      response: parsed,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const durationMs = Date.now() - started;
    if (err instanceof DOMException && err.name === 'AbortError') {
      return {
        httpSuccess: false,
        httpStatus: 0,
        responseXml: '',
        response: null,
        error: `Request timed out after ${timeoutMs}ms`,
        durationMs,
      };
    }
    const message = err instanceof Error ? err.message : 'Unknown network error';
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

// ── XML parser (tolerant; ignores namespace prefixes) ───────────

/** Remove `nsN:` prefixes but preserve element casing. */
function stripPrefixes(xml: string): string {
  return xml
    .replace(/<\/([a-zA-Z0-9]+):/g, '</')
    .replace(/<([a-zA-Z0-9]+):/g, '<');
}

function innerOf(xml: string, tag: string): string {
  const rx = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`);
  const m = xml.match(rx);
  return m ? m[1] : '';
}

function textOf(xml: string, tag: string): string {
  const inner = innerOf(xml, tag);
  if (!inner) return '';
  if (/<[a-zA-Z]/.test(inner)) return '';
  return decodeEntities(inner.trim());
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function allOf(xml: string, tag: string): string[] {
  const rx = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** Extract repeated leaf tags into their text content (for `<tag>value</tag>…`). */
function allTextOf(xml: string, tag: string): string[] {
  const rx = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(xml)) !== null) out.push(decodeEntities(m[1].trim()));
  return out;
}

function toNumber(v: string): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function toOptNumber(v: string): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

// ── Response parsers ────────────────────────────────────────────

export function parseGetInvoicesResponse(rawXml: string): GetInvoiceResponse | null {
  if (!rawXml) return null;
  const xml = stripPrefixes(rawXml);

  const respBlock = innerOf(xml, 'GetInvoicesResponse') || xml;
  const invoiceArray = innerOf(respBlock, 'InvoiceArray');
  const invoiceBlocks = invoiceArray ? allOf(invoiceArray, 'Invoice') : [];
  const invoices: Invoice[] = invoiceBlocks.map(parseInvoice);

  const smArray = innerOf(respBlock, 'ServiceMessageArray');
  const smBlocks = smArray ? allOf(smArray, 'ServiceMessage') : [];
  const messages: ServiceMessage[] = smBlocks
    .map(parseServiceMessage)
    .filter((m): m is ServiceMessage => m !== null);

  // If we parsed nothing and no response envelope was found, treat as parse miss.
  if (!invoices.length && !messages.length && !respBlock.includes('<')) return null;

  return {
    InvoiceArray: invoices.length ? invoices : undefined,
    ServiceMessageArray: messages.length ? messages : undefined,
  };
}

export function parseGetVoidedInvoicesResponse(rawXml: string): GetVoidedInvoiceResponse | null {
  if (!rawXml) return null;
  const xml = stripPrefixes(rawXml);

  const respBlock = innerOf(xml, 'GetVoidedInvoicesResponse') || xml;
  const vArray = innerOf(respBlock, 'VoidedInvoiceArray');
  const vBlocks = vArray ? allOf(vArray, 'VoidedInvoice') : [];
  const voided: VoidedInvoice[] = vBlocks.map(block => ({
    invoiceNumber: textOf(block, 'invoiceNumber'),
    voidDate: textOf(block, 'voidDate'),
  })).filter(v => v.invoiceNumber);

  const smArray = innerOf(respBlock, 'ServiceMessageArray');
  const smBlocks = smArray ? allOf(smArray, 'ServiceMessage') : [];
  const messages: ServiceMessage[] = smBlocks
    .map(parseServiceMessage)
    .filter((m): m is ServiceMessage => m !== null);

  return {
    VoidedInvoiceArray: voided.length ? voided : undefined,
    ServiceMessageArray: messages.length ? messages : undefined,
  };
}

/**
 * AccountInfo inside BillTo/SoldTo uses PascalCase address fields
 * (Address1/2/3) but camelCase for everything else.
 */
function parseAccountInfo(block: string): AccountInfo {
  return {
    accountName:   textOf(block, 'accountName')   || undefined,
    accountNumber: textOf(block, 'accountNumber') || undefined,
    attentionTo:   textOf(block, 'attentionTo')   || undefined,
    address1:      textOf(block, 'Address1')      || undefined,
    address2:      textOf(block, 'Address2')      || undefined,
    address3:      textOf(block, 'Address3')      || undefined,
    city:          textOf(block, 'city')          || undefined,
    region:        textOf(block, 'region')        || undefined,
    postalCode:    textOf(block, 'postalCode')    || undefined,
    country:       textOf(block, 'country')       || undefined,
    email:         textOf(block, 'email')         || undefined,
    phone:         textOf(block, 'phone')         || undefined,
  };
}

/** BillTo/SoldTo wraps an <AccountInfo> child — unwrap one level. */
function parseAccountWrapper(outerBlock: string): AccountInfo | undefined {
  if (!outerBlock) return undefined;
  const inner = innerOf(outerBlock, 'AccountInfo');
  // Some suppliers in the wild emit fields directly under BillTo;
  // fall back to parsing the wrapper block itself.
  return parseAccountInfo(inner || outerBlock);
}

function parseLineItem(block: string): InvoiceLineItem {
  return {
    invoiceLineItemNumber:       toOptNumber(textOf(block, 'invoiceLineItemNumber')),
    productId:                   textOf(block, 'productId')                   || undefined,
    partId:                      textOf(block, 'partId')                      || undefined,
    chargeId:                    textOf(block, 'chargeId')                    || undefined,
    purchaseOrderLineItemNumber: textOf(block, 'purchaseOrderLineItemNumber') || undefined,
    orderedQuantity:             toOptNumber(textOf(block, 'orderedQuantity')),
    invoiceQuantity:             toNumber(textOf(block, 'invoiceQuantity')),
    backOrderedQuantity:         toOptNumber(textOf(block, 'backOrderedQuantity')),
    quantityUOM:                 (textOf(block, 'quantityUOM') || 'EA') as QuantityUOM,
    lineItemDescription:         textOf(block, 'lineItemDescription'),
    unitPrice:                   toNumber(textOf(block, 'unitPrice')),
    discountAmount:              toOptNumber(textOf(block, 'discountAmount')),
    extendedPrice:               toNumber(textOf(block, 'extendedPrice')),
    distributorProductId:        textOf(block, 'distributorProductId')        || undefined,
    distributorPartId:           textOf(block, 'distributorPartId')           || undefined,
  };
}

function parseTax(block: string): Tax {
  return {
    taxType:         (textOf(block, 'taxType') || 'SALES') as TaxType,
    taxJurisdiction: textOf(block, 'taxJurisdiction'),
    taxAmount:       toNumber(textOf(block, 'taxAmount')),
  };
}

function parseServiceMessage(block: string): ServiceMessage | null {
  const code = parseInt(textOf(block, 'code'), 10);
  const description = textOf(block, 'description');
  const severity = (textOf(block, 'severity') || 'Information') as ServiceMessageSeverity;
  if (!description && !Number.isFinite(code)) return null;
  return {
    code: Number.isFinite(code) ? code : 999,
    description,
    severity,
  };
}

function parseInvoice(block: string): Invoice {
  // BillTo / SoldTo wrap AccountInfo (per XSD); unwrap one level.
  const billToBlock = innerOf(block, 'BillTo');
  const soldToBlock = innerOf(block, 'SoldTo');

  // InvoiceLineItemsArray → InvoiceLineItem* (repeated)
  const lineItemsWrapper = innerOf(block, 'InvoiceLineItemsArray');
  const lineItems = allOf(lineItemsWrapper, 'InvoiceLineItem').map(parseLineItem);

  // SalesOrderNumbersArray → salesOrderNumber* (direct repeated leaf, per XSD)
  const salesOrdersWrapper = innerOf(block, 'SalesOrderNumbersArray');
  const salesOrderTexts = allTextOf(salesOrdersWrapper, 'salesOrderNumber');
  const salesOrders: SalesOrderNumber[] = salesOrderTexts.map(n => ({ salesOrderNumber: n }));

  // TaxArray → tax* (lowercase, repeated)
  const taxesWrapper = innerOf(block, 'TaxArray');
  const taxes = allOf(taxesWrapper, 'tax').map(parseTax);

  return {
    invoiceNumber:        textOf(block, 'invoiceNumber'),
    invoiceType:          (textOf(block, 'invoiceType') || 'INVOICE') as InvoiceType,
    invoiceDate:          textOf(block, 'invoiceDate'),
    purchaseOrderNumber:  textOf(block, 'purchaseOrderNumber')  || undefined,
    purchaseOrderVersion: textOf(block, 'purchaseOrderVersion') || undefined,
    BillTo: parseAccountWrapper(billToBlock),
    SoldTo: parseAccountWrapper(soldToBlock),
    invoiceComments:      textOf(block, 'invoiceComments')      || undefined,
    paymentTerms:         textOf(block, 'paymentTerms')         || undefined,
    paymentDueDate:       textOf(block, 'paymentDueDate'),
    currency:             textOf(block, 'currency') || 'USD',
    fobId:                textOf(block, 'fob')                  || undefined,
    salesAmount:          toNumber(textOf(block, 'salesAmount')),
    shippingAmount:       toNumber(textOf(block, 'shippingAmount')),
    handlingAmount:       toNumber(textOf(block, 'handlingAmount')),
    taxAmount:            toNumber(textOf(block, 'taxAmount')),
    invoiceAmount:        toNumber(textOf(block, 'invoiceAmount')),
    advancePaymentAmount: toNumber(textOf(block, 'advancePaymentAmount')),
    invoiceAmountDue:     toNumber(textOf(block, 'invoiceAmountDue')),
    invoiceDocumentUrl:   textOf(block, 'invoiceDocumentUrl')   || undefined,
    InvoiceLineItemsArray: lineItems,
    SalesOrderNumbersArray: salesOrders.length ? salesOrders : undefined,
    TaxArray: taxes.length ? taxes : undefined,
    invoicePaymentUrl:    textOf(block, 'invoicePaymentUrl')    || undefined,
  };
}

// ── Extra helpers ───────────────────────────────────────────────

/** Extract a SOAP Fault reason (if any) from a raw response. */
export function extractSoapFault(rawXml: string): string | null {
  if (!rawXml) return null;
  const xml = stripPrefixes(rawXml);
  if (!/<Fault[\s>]/.test(xml)) return null;
  const reason = innerOf(xml, 'faultstring') || innerOf(xml, 'Reason') || innerOf(xml, 'faultcode');
  return reason ? decodeEntities(reason.replace(/<[^>]+>/g, '').trim()) : 'SOAP Fault';
}

/** Classify a ServiceMessageArray into (errors, warnings, info). */
export function bucketServiceMessages(messages: ServiceMessage[] | undefined) {
  const errors: ServiceMessage[] = [];
  const warnings: ServiceMessage[] = [];
  const info: ServiceMessage[] = [];
  if (!messages) return { errors, warnings, info };
  for (const m of messages) {
    if (m.severity === 'Error') errors.push(m);
    else if (m.severity === 'Warning') warnings.push(m);
    else info.push(m);
  }
  return { errors, warnings, info };
}
