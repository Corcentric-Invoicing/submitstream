#!/usr/bin/env node
// ============================================
// PromoStandards Invoice 1.0.0 — Onboarding Probe
//
// Standalone Node script for testing a supplier's endpoint end to
// end before wiring them into the Worker. No TypeScript toolchain
// needed — just `node`. Intended use:
//
//   node scripts/promostandards-probe.mjs \
//     --endpoint https://promostandards.example.com/Invoice/1.0.0/Service.svc \
//     --id       1234567 \
//     --password s3cret \
//     --query-type 4 \
//     --since    2026-04-01T00:00:00Z
//
// Output:
//   1. The SOAP envelope we sent
//   2. HTTP status + duration
//   3. Raw XML response (pretty-printed)
//   4. Parsed invoice summary table
//   5. Mapped-to-EDI preview for the first invoice (JSON)
//
// Flags:
//   --endpoint   <url>        REQUIRED  supplier's SOAP endpoint
//   --id         <string>     REQUIRED  customerId the supplier issued us
//   --password   <string>     required-by-XSD; empty string if unknown
//   --ws-version <string>     default 1.0.0
//   --query-type 1|2|3|4      default 4 (availableTimeStamp)
//   --ref        <string>     referenceNumber for qt=1 (PO#) or qt=2 (invoice#)
//   --date       YYYY-MM-DD   requestedDate for qt=3
//   --since      ISO-8601     availableTimeStamp for qt=4 (default: 7 days ago)
//   --out        <path>       write raw response XML here for later inspection
//   --timeout    <ms>         request timeout, default 45000
//   --voided                  use getVoidedInvoices instead of getInvoices
// ============================================

import { writeFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';

// ── CLI parsing ─────────────────────────────────────────────────
const args = Object.create(null);
for (let i = 2; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  const next = argv[i + 1];
  if (next === undefined || next.startsWith('--')) {
    args[key] = true;
  } else {
    args[key] = next;
    i++;
  }
}

if (!args.endpoint || !args.id) {
  console.error('Usage: node scripts/promostandards-probe.mjs --endpoint <url> --id <customerId> [--password …] [--query-type 1|2|3|4] [--since ISO | --date YYYY-MM-DD | --ref …]');
  exit(2);
}

const endpoint   = args.endpoint;
const id         = args.id;
const password   = args.password ?? '';
const wsVersion  = args['ws-version'] ?? '1.0.0';
const queryType  = Number(args['query-type'] ?? 4);
const timeout    = Number(args.timeout ?? 45000);
const isVoided   = !!args.voided;

const NS_INVOICE = 'http://www.promostandards.org/WSDL/Invoice/1.0.0/';
const NS_SHARED  = 'http://www.promostandards.org/WSDL/Invoice/1.0.0/SharedObjects/';

// ── Build the SOAP envelope ─────────────────────────────────────
function xmlEscape(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function shar(tag, value, required) {
  if (value === undefined || value === null || value === '') {
    return required ? `<shar:${tag}/>` : '';
  }
  return `<shar:${tag}>${xmlEscape(value)}</shar:${tag}>`;
}

const defaultSince = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

const bodyFields =
  shar('wsVersion', wsVersion, true) +
  shar('id', id, true) +
  shar('password', password, true) +
  shar('queryType', String(queryType), true) +
  shar('referenceNumber', args.ref, false) +
  shar('requestedDate', args.date, false) +
  shar('availableTimeStamp', queryType === 4 ? (args.since ?? defaultSince) : args.since, false);

const rootLocal = isVoided ? 'GetVoidedInvoicesRequest' : 'GetInvoicesRequest';
const envelope =
`<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope
  xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
  xmlns:ns="${NS_INVOICE}"
  xmlns:shar="${NS_SHARED}">
  <soapenv:Header/>
  <soapenv:Body>
    <ns:${rootLocal}>${bodyFields}</ns:${rootLocal}>
  </soapenv:Body>
</soapenv:Envelope>`;

const soapAction = isVoided ? '"getVoidedInvoices"' : '"getInvoices"';

// ── Fire ────────────────────────────────────────────────────────
console.log('── Request ──────────────────────────────────────────');
console.log(`POST ${endpoint}`);
console.log(`SOAPAction: ${soapAction}`);
console.log(envelope);
console.log();

const controller = new AbortController();
const tid = setTimeout(() => controller.abort(), timeout);
const started = Date.now();

let res, body, netErr;
try {
  res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'Accept': 'text/xml',
      'SOAPAction': soapAction,
    },
    body: envelope,
    signal: controller.signal,
  });
  body = await res.text();
} catch (err) {
  netErr = err;
} finally {
  clearTimeout(tid);
}

const durationMs = Date.now() - started;

console.log('── Response ─────────────────────────────────────────');
if (netErr) {
  console.log(`Network error after ${durationMs}ms:`, netErr.message || netErr);
  exit(1);
}
console.log(`HTTP ${res.status} (${durationMs}ms, ${body.length} bytes)`);
console.log();

if (args.out) {
  writeFileSync(args.out, body, 'utf8');
  console.log(`Raw response saved to ${args.out}`);
  console.log();
}

console.log('── Raw XML (pretty) ─────────────────────────────────');
stdout.write(prettyXml(body));
console.log('\n');

// ── Parse response ──────────────────────────────────────────────
const stripped = body
  .replace(/<\/([a-zA-Z0-9]+):/g, '</')
  .replace(/<([a-zA-Z0-9]+):/g, '<');

const fault = extractFault(stripped);
if (fault) console.log(`⚠  SOAP Fault: ${fault}\n`);

const smArray = innerOf(stripped, 'ServiceMessageArray');
const smBlocks = smArray ? allOf(smArray, 'ServiceMessage') : [];
if (smBlocks.length) {
  console.log('── ServiceMessages ──────────────────────────────────');
  for (const b of smBlocks) {
    console.log(`  [${textOf(b, 'severity')}] ${textOf(b, 'code')}: ${textOf(b, 'description')}`);
  }
  console.log();
}

if (isVoided) {
  const vArr = innerOf(stripped, 'VoidedInvoiceArray');
  const vBlocks = vArr ? allOf(vArr, 'VoidedInvoice') : [];
  console.log(`── Voided invoices: ${vBlocks.length} ─────────────────`);
  for (const b of vBlocks) {
    console.log(`  ${textOf(b, 'invoiceNumber')}  voided ${textOf(b, 'voidDate')}`);
  }
  exit(0);
}

const invArr = innerOf(stripped, 'InvoiceArray');
const invBlocks = invArr ? allOf(invArr, 'Invoice') : [];
console.log(`── Invoices returned: ${invBlocks.length} ─────────────────`);
for (const b of invBlocks) {
  const num = textOf(b, 'invoiceNumber');
  const type = textOf(b, 'invoiceType');
  const date = textOf(b, 'invoiceDate');
  const po = textOf(b, 'purchaseOrderNumber') || '—';
  const amt = textOf(b, 'invoiceAmount');
  const cur = textOf(b, 'currency');
  const due = textOf(b, 'invoiceAmountDue');
  const lines = allOf(innerOf(b, 'InvoiceLineItemsArray'), 'InvoiceLineItem').length;
  console.log(`  ${num.padEnd(16)}  ${type.padEnd(11)} ${date}  PO ${po.padEnd(12)} ${cur} ${amt} (due ${due})  lines=${lines}`);
}

// ── Map the first invoice to EDI for preview ────────────────────
if (invBlocks.length) {
  console.log('\n── EDI preview (first invoice) ─────────────────────');
  const first = parseInvoice(invBlocks[0]);
  const edi = mapToEdi(first, { shipToEqualsBillTo: true });
  console.log(JSON.stringify(edi, null, 2));
}

exit(0);

// ────────────────────────────────────────────────────────────────
// Parsing + mapping helpers (intentionally duplicated inline so
// this script is self-contained and can be handed to ops without
// a toolchain). Logic mirrors src/api/promostandards/{client,mapper}.ts.
// ────────────────────────────────────────────────────────────────

function innerOf(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1] : '';
}
function textOf(xml, tag) {
  const i = innerOf(xml, tag);
  if (!i || /<[a-zA-Z]/.test(i)) return '';
  return decodeEntities(i.trim());
}
function allOf(xml, tag) {
  const rx = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = rx.exec(xml)) !== null) out.push(m[1]);
  return out;
}
function allTextOf(xml, tag) {
  return allOf(xml, tag).map(s => decodeEntities(s.trim()));
}
function decodeEntities(s) {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function extractFault(xml) {
  if (!/<Fault[\s>]/.test(xml)) return null;
  const r = innerOf(xml, 'faultstring') || innerOf(xml, 'Reason') || innerOf(xml, 'faultcode');
  return r ? r.replace(/<[^>]+>/g, '').trim() : 'SOAP Fault';
}
function toNum(v) { if (!v) return 0; const n = Number(v); return Number.isFinite(n) ? n : 0; }
function optNum(v) { if (!v) return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; }

function parseAccountInfo(block) {
  if (!block) return undefined;
  const inner = innerOf(block, 'AccountInfo') || block;
  return {
    accountName:   textOf(inner, 'accountName')   || undefined,
    accountNumber: textOf(inner, 'accountNumber') || undefined,
    attentionTo:   textOf(inner, 'attentionTo')   || undefined,
    address1:      textOf(inner, 'Address1')      || undefined,
    address2:      textOf(inner, 'Address2')      || undefined,
    address3:      textOf(inner, 'Address3')      || undefined,
    city:          textOf(inner, 'city')          || undefined,
    region:        textOf(inner, 'region')        || undefined,
    postalCode:    textOf(inner, 'postalCode')    || undefined,
    country:       textOf(inner, 'country')       || undefined,
    email:         textOf(inner, 'email')         || undefined,
    phone:         textOf(inner, 'phone')         || undefined,
  };
}

function parseInvoice(block) {
  const billToBlock = innerOf(block, 'BillTo');
  const soldToBlock = innerOf(block, 'SoldTo');
  const lineItems = allOf(innerOf(block, 'InvoiceLineItemsArray'), 'InvoiceLineItem').map(b => ({
    invoiceLineItemNumber: optNum(textOf(b, 'invoiceLineItemNumber')),
    productId: textOf(b, 'productId') || undefined,
    partId: textOf(b, 'partId') || undefined,
    chargeId: textOf(b, 'chargeId') || undefined,
    purchaseOrderLineItemNumber: textOf(b, 'purchaseOrderLineItemNumber') || undefined,
    orderedQuantity: optNum(textOf(b, 'orderedQuantity')),
    invoiceQuantity: toNum(textOf(b, 'invoiceQuantity')),
    backOrderedQuantity: optNum(textOf(b, 'backOrderedQuantity')),
    quantityUOM: textOf(b, 'quantityUOM') || 'EA',
    lineItemDescription: textOf(b, 'lineItemDescription'),
    unitPrice: toNum(textOf(b, 'unitPrice')),
    discountAmount: optNum(textOf(b, 'discountAmount')),
    extendedPrice: toNum(textOf(b, 'extendedPrice')),
    distributorProductId: textOf(b, 'distributorProductId') || undefined,
    distributorPartId: textOf(b, 'distributorPartId') || undefined,
  }));
  const taxes = allOf(innerOf(block, 'TaxArray'), 'tax').map(b => ({
    taxType: textOf(b, 'taxType') || 'SALES',
    taxJurisdiction: textOf(b, 'taxJurisdiction'),
    taxAmount: toNum(textOf(b, 'taxAmount')),
  }));
  const salesOrders = allTextOf(innerOf(block, 'SalesOrderNumbersArray'), 'salesOrderNumber')
    .map(n => ({ salesOrderNumber: n }));
  return {
    invoiceNumber: textOf(block, 'invoiceNumber'),
    invoiceType: textOf(block, 'invoiceType') || 'INVOICE',
    invoiceDate: textOf(block, 'invoiceDate'),
    purchaseOrderNumber: textOf(block, 'purchaseOrderNumber') || undefined,
    purchaseOrderVersion: textOf(block, 'purchaseOrderVersion') || undefined,
    BillTo: parseAccountInfo(billToBlock),
    SoldTo: parseAccountInfo(soldToBlock),
    invoiceComments: textOf(block, 'invoiceComments') || undefined,
    paymentTerms: textOf(block, 'paymentTerms') || undefined,
    paymentDueDate: textOf(block, 'paymentDueDate'),
    currency: textOf(block, 'currency') || 'USD',
    fobId: textOf(block, 'fob') || undefined,
    salesAmount: toNum(textOf(block, 'salesAmount')),
    shippingAmount: toNum(textOf(block, 'shippingAmount')),
    handlingAmount: toNum(textOf(block, 'handlingAmount')),
    taxAmount: toNum(textOf(block, 'taxAmount')),
    invoiceAmount: toNum(textOf(block, 'invoiceAmount')),
    advancePaymentAmount: toNum(textOf(block, 'advancePaymentAmount')),
    invoiceAmountDue: toNum(textOf(block, 'invoiceAmountDue')),
    invoiceDocumentUrl: textOf(block, 'invoiceDocumentUrl') || undefined,
    InvoiceLineItemsArray: lineItems,
    SalesOrderNumbersArray: salesOrders.length ? salesOrders : undefined,
    TaxArray: taxes.length ? taxes : undefined,
  };
}

function toYYYYMMDD(iso) {
  if (!iso) return '';
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : '';
}
function money(n) { return (n === undefined || n === null || !Number.isFinite(n)) ? '' : n.toFixed(2); }
function bucketForTax(t) {
  switch (t.taxType) {
    case 'HST/GST': case 'VAT': return 'federal';
    case 'PST': return 'state';
    case 'SALES': default:
      return /^[A-Za-z]{2,3}$/.test((t.taxJurisdiction || '').trim()) ? 'state' : 'local';
  }
}
function bucketTaxes(taxes) {
  const b = { localCode: '', localAmount: 0, stateCode: '', stateAmount: 0, federalCode: '', federalAmount: 0 };
  if (!taxes) return b;
  for (const t of taxes) {
    const code = t.taxJurisdiction || t.taxType;
    const bucket = bucketForTax(t);
    if (bucket === 'local') { b.localAmount += t.taxAmount; if (!b.localCode) b.localCode = code; }
    else if (bucket === 'state') { b.stateAmount += t.taxAmount; if (!b.stateCode) b.stateCode = code; }
    else { b.federalAmount += t.taxAmount; if (!b.federalCode) b.federalCode = code; }
  }
  return b;
}
function accountToAddress(a) {
  if (!a) return { Name: '', Code: '', Address1: '', Address2: '', City: '', State: '', Zip: '' };
  return {
    Name: a.accountName ?? '', Code: a.accountNumber ?? '',
    Address1: a.address1 ?? '', Address2: a.address2 ?? '',
    City: a.city ?? '', State: a.region ?? '', Zip: a.postalCode ?? '',
  };
}
function accountToBillTo(a) {
  if (!a) return { Name: '', Code: '', Address1: '', Address2: '', City: '', State: '' };
  return {
    Name: a.accountName ?? '', Code: a.accountNumber ?? '',
    Address1: a.address1 ?? '', Address2: a.address2 ?? '',
    City: a.city ?? '', State: a.region ?? '',
  };
}
function mapToEdi(inv, opts = {}) {
  const shipBill = opts.shipToEqualsBillTo !== false;
  const billAddr = accountToAddress(inv.BillTo);
  const buckets = bucketTaxes(inv.TaxArray);
  return {
    header: {
      InvoiceDate: toYYYYMMDD(inv.invoiceDate),
      InvoiceNumber: inv.invoiceNumber,
      PODate: '',
      PONumber: inv.purchaseOrderNumber ?? '',
      Currency: inv.currency || 'USD',
      ShipDate: '',
    },
    shipTo: shipBill ? billAddr : { Name: '', Code: '', Address1: '', Address2: '', City: '', State: '', Zip: '' },
    vendor: { Name: '', Code: '', Address1: '', Address2: '', City: '', State: '', Zip: '' },
    remitTo: { Name: '', Code: '', Address1: '', Address2: '', City: '', State: '' },
    billTo: accountToBillTo(inv.BillTo),
    paymentTerms: {
      DueDate: toYYYYMMDD(inv.paymentDueDate),
      NetDays: '',
      Description: inv.paymentTerms ?? '',
      DiscountPercent: '', DiscountAmount: '', DiscountDueDate: '',
    },
    lineItems: inv.InvoiceLineItemsArray.map((li, idx) => {
      const isCharge = !!li.chargeId && !li.productId && !li.partId;
      return {
        LineNumber: li.invoiceLineItemNumber != null ? String(li.invoiceLineItemNumber) : String(idx + 1),
        Quantity: String(li.invoiceQuantity),
        UOM: li.quantityUOM || 'EA',
        UnitPrice: money(li.unitPrice),
        BuyerPartNumber: li.distributorPartId ?? li.distributorProductId ?? (isCharge ? (li.chargeId ?? '') : ''),
        VendorPartNumber: li.partId ?? li.productId ?? '',
        Description: isCharge ? `[CHARGE] ${li.lineItemDescription}` : li.lineItemDescription ?? '',
      };
    }),
    totals: {
      InvoiceTotal: money(inv.invoiceAmount),
      DiscountableAmount: money(inv.salesAmount),
      LocalTaxCode: buckets.localCode, LocalTaxAmount: money(buckets.localAmount),
      StateTaxCode: buckets.stateCode, StateTaxAmount: money(buckets.stateAmount),
      FederalTaxCode: buckets.federalCode, FederalTaxAmount: money(buckets.federalAmount),
      TaxExemptCode: '', TaxExemptAmount: '',
      FreightAmount: money(inv.shippingAmount),
      FreightDescription: inv.shippingAmount > 0 ? 'Shipping' : '',
      MiscChargeCode: inv.handlingAmount > 0 ? 'HANDLING' : '',
      MiscChargeAmount: money(inv.handlingAmount),
      MiscChargeDescription: inv.handlingAmount > 0 ? 'Handling' : '',
    },
    references: {
      BillOfLading: '', PackingSlip: '',
      ReferenceNumber1: inv.SalesOrderNumbersArray?.[0]?.salesOrderNumber ?? '',
      ReferenceQualifier1: inv.SalesOrderNumbersArray?.[0]?.salesOrderNumber ? 'SO' : '',
      ReferenceNumber2: inv.purchaseOrderVersion ?? '',
      ReferenceQualifier2: inv.purchaseOrderVersion ? 'POV' : '',
    },
    placeholders: { A1Q: '', A1D: '', A2Q: '', A2D: '', A3Q: '', A3D: '', A4Q: '', A4D: '', A5Q: '', A5D: '' },
  };
}

function prettyXml(xml) {
  // Very basic pretty-printer for readable console output.
  let out = '';
  let indent = 0;
  xml
    .replace(/>\s*</g, '>\n<')
    .split('\n')
    .forEach(line => {
      if (/^<\/.+/.test(line)) indent = Math.max(0, indent - 1);
      out += '  '.repeat(indent) + line + '\n';
      if (/^<[^!?/][^>]*[^/]>$/.test(line)) indent++;
    });
  return out;
}
