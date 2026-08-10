// ============================================
// Corcentric DMS XML Serializer
//
// Converts a CorProcessRequest into valid XML
// per the Corcentric DMS Web Service.
//
// Element order is based on a KNOWN WORKING sample XML
// from Corcentric (not the spec doc, which has wrong order).
//
// Zero dependencies — builds XML string directly.
// ============================================

import { CorProcessRequest } from './types';

/**
 * Escape XML special characters in text content.
 */
function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Create an XML element with a value. Returns empty string if no value.
 */
function el(tag: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  return `<${tag}>${esc(value)}</${tag}>`;
}

/**
 * Create an element that is always present — empty self-closing tag when no value.
 */
function optEl(tag: string, value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return `<${tag} />`;
  }
  return `<${tag}>${esc(value)}</${tag}>`;
}

/**
 * Create a non-nillable container element — empty self-closing tag.
 */
function emptyEl(tag: string): string {
  return `<${tag} />`;
}

/**
 * Serialize a CorProcessRequest into Corcentric DMS XML.
 *
 * Element order matches a known working sample XML from Corcentric.
 *
 * @param req - Fully populated CorProcessRequest from the mapper
 * @param prettyPrint - If true, adds indentation for readability (default: true)
 * @returns Valid XML string ready for API submission
 */
export function serializeCorRequest(req: CorProcessRequest, prettyPrint = true): string {
  const r = req.corRequest;
  const lines: string[] = [];
  const indent = prettyPrint ? '  ' : '';
  const nl = prettyPrint ? '\n' : '';

  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<ProcessRequest>');

  // Auth
  lines.push(`${indent}${el('UserName', req.UserName)}`);
  lines.push(`${indent}${el('Password', req.Password)}`);

  // Request container
  lines.push(`${indent}<corRequest>`);
  const i2 = indent + indent;

  // ===== Header fields =====
  // Order per CORCENTRIC-DMS-GUIDE.md §3b "Confirmed Element Order (Tested
  // via Curl)". The endpoint is XSD-strict — missing elements or wrong
  // order produce a "1002" error with no descriptive body, because the
  // WCF parser bails on the first mismatch. Emit every element in the
  // sequence, as empty self-closing tags when we have no value.

  // (1) core identity
  lines.push(`${i2}${el('corRequestID', r.corRequestID)}`);
  lines.push(`${i2}${el('corRequestType', r.corRequestType)}`);
  lines.push(`${i2}${el('corVendorCode', r.corVendorCode)}`);
  lines.push(`${i2}${el('corCustomerCode', r.corCustomerCode)}`);
  lines.push(`${i2}${el('corCommunityCode', r.corCommunityCode)}`);

  // (2) authorization + transaction identity
  lines.push(`${i2}${optEl('corAuthorizationCode', r.corAuthorizationCode)}`);
  lines.push(`${i2}${el('corTransactionType', r.corTransactionType)}`);
  lines.push(`${i2}${el('corTransactionNumber', r.corTransactionNumber)}`);

  // (3) originating doc + dates + PO
  lines.push(`${i2}${optEl('corOriginatingDocumentNumber', r.corOriginatingDocumentNumber)}`);
  lines.push(`${i2}${el('corTransactionDate', r.corTransactionDate)}`);
  lines.push(`${i2}${optEl('corPurchaseOrderNumber', r.corPurchaseOrderNumber)}`);
  lines.push(`${i2}${optEl('corPurchaseOrderDate', r.corPurchaseOrderDate)}`);

  // (4) amounts + currency + billing ref
  lines.push(`${i2}${el('corTransactionAmount', r.corTransactionAmount)}`);
  lines.push(`${i2}${el('corAuthorizationAmount', r.corAuthorizationAmount)}`);
  lines.push(`${i2}${el('corCurrencyCode', r.corCurrencyCode)}`);
  lines.push(`${i2}${optEl('corBillingReference', r.corBillingReference)}`);

  // (5) payment/acceleration terms + point of sale
  lines.push(`${i2}${emptyEl('corPaymentTerms')}`);
  lines.push(`${i2}${emptyEl('corAccelerationTerms')}`);

  if (r.corPointOfSale) {
    const pos = r.corPointOfSale;
    const i3 = i2 + indent;
    lines.push(`${i2}<corPointOfSale>`);
    if (pos.corPointOfSaleName) lines.push(`${i3}${el('corPointOfSaleName', pos.corPointOfSaleName)}`);
    if (pos.corPointOfSaleAddress1) lines.push(`${i3}${el('corPointOfSaleAddress1', pos.corPointOfSaleAddress1)}`);
    if (pos.corPointOfSaleAddress2) lines.push(`${i3}${el('corPointOfSaleAddress2', pos.corPointOfSaleAddress2)}`);
    if (pos.corPointOfSaleCity) lines.push(`${i3}${el('corPointOfSaleCity', pos.corPointOfSaleCity)}`);
    if (pos.corPointOfSaleStateProvince) lines.push(`${i3}${el('corPointOfSaleStateProvince', pos.corPointOfSaleStateProvince)}`);
    if (pos.corPointOfSalePostalCode) lines.push(`${i3}${el('corPointOfSalePostalCode', pos.corPointOfSalePostalCode)}`);
    if (pos.corPointOfSaleCountryCode) lines.push(`${i3}${el('corPointOfSaleCountryCode', pos.corPointOfSaleCountryCode)}`);
    lines.push(`${i2}</corPointOfSale>`);
  } else {
    lines.push(`${i2}${emptyEl('corPointOfSale')}`);
  }

  // (6) references → transactionInfo → asset — BEFORE sections per the
  // XSD-enforced order confirmed by an actual DMS response ("List of
  // possible elements expected: 'corReferences'" when we put sections
  // first). Note: this contradicts DMS-GUIDE.md §3b as originally
  // documented — the guide's listed sequence was incorrect. Trust the
  // server's response over the doc.
  if (r.corReferences && r.corReferences.length > 0) {
    const i3 = i2 + indent;
    lines.push(`${i2}<corReferences>`);
    for (const ref of r.corReferences) {
      lines.push(`${i3}<corReference>`);
      lines.push(`${i3}${indent}${el('corReferenceType', ref.corReferenceType)}`);
      lines.push(`${i3}${indent}${el('corReferenceValue', ref.corReferenceValue)}`);
      lines.push(`${i3}</corReference>`);
    }
    lines.push(`${i2}</corReferences>`);
  } else {
    lines.push(`${i2}${emptyEl('corReferences')}`);
  }
  lines.push(`${i2}${emptyEl('corTransactionInfo')}`);
  if (r.corAsset) {
    const a = r.corAsset;
    const i3 = i2 + indent;
    lines.push(`${i2}<corAsset>`);
    if (a.corAssetSerialNumber) lines.push(`${i3}${el('corAssetSerialNumber', a.corAssetSerialNumber)}`);
    if (a.corAssetCustomerUnitNumber) lines.push(`${i3}${el('corAssetCustomerUnitNumber', a.corAssetCustomerUnitNumber)}`);
    if (a.corAssetVendorUnitNumber) lines.push(`${i3}${el('corAssetVendorUnitNumber', a.corAssetVendorUnitNumber)}`);
    if (a.corAssetYear) lines.push(`${i3}${el('corAssetYear', a.corAssetYear)}`);
    if (a.corAssetMake) lines.push(`${i3}${el('corAssetMake', a.corAssetMake)}`);
    if (a.corAssetModel) lines.push(`${i3}${el('corAssetModel', a.corAssetModel)}`);
    if (a.corAssetType) lines.push(`${i3}${el('corAssetType', a.corAssetType)}`);
    if (a.corAssetDescription) lines.push(`${i3}${el('corAssetDescription', a.corAssetDescription)}`);
    lines.push(`${i2}</corAsset>`);
  } else {
    lines.push(`${i2}${emptyEl('corAsset')}`);
  }

  // (7) sections (line items) — after references/transactionInfo/asset.
  // Order INSIDE corSection: corSectionNumber → corSectionInfo →
  // corComments → corLineDetails
  lines.push(`${i2}<corSections>`);
  for (const section of r.corSections) {
    const i3 = i2 + indent;
    lines.push(`${i3}<corSection>`);
    const i4 = i3 + indent;
    lines.push(`${i4}${el('corSectionNumber', section.corSectionNumber)}`);
    lines.push(`${i4}${emptyEl('corSectionInfo')}`);

    if (section.corComments && section.corComments.length > 0) {
      const i5 = i4 + indent;
      lines.push(`${i4}<corComments>`);
      for (const comment of section.corComments) {
        lines.push(`${i5}<corComment>`);
        lines.push(`${i5}${indent}${el('corSectionCommentSequence', comment.corSectionCommentSequence)}`);
        lines.push(`${i5}${indent}${el('corSectionCommentType', comment.corSectionCommentType)}`);
        lines.push(`${i5}${indent}${el('corSectionComment', comment.corSectionComment)}`);
        lines.push(`${i5}</corComment>`);
      }
      lines.push(`${i4}</corComments>`);
    } else {
      lines.push(`${i4}${emptyEl('corComments')}`);
    }

    // corLineDetails — element order per guide:
    //   Sequence → Type → Item → BuyerItem → ManufacturerCode →
    //   Description → VMRSCode → PartCategories →
    //   Quantity → UnitPrice → CorePrice → FET → Notes → UOM
    lines.push(`${i4}<corLineDetails>`);
    for (const line of section.corLineDetails) {
      const i5 = i4 + indent;
      lines.push(`${i5}<corLineDetail>`);
      const i6 = i5 + indent;

      lines.push(`${i6}${el('corLineDetailSequence', line.corLineDetailSequence)}`);
      lines.push(`${i6}${el('corLineDetailType', line.corLineDetailType)}`);
      lines.push(`${i6}${el('corLineDetailItem', line.corLineDetailItem)}`);
      lines.push(`${i6}${optEl('corLineDetailBuyerItem', line.corLineDetailBuyerItem)}`);
      lines.push(`${i6}${optEl('corLineDetailManufacturerCode', line.corLineDetailManufacturerCode)}`);

      const desc = String(line.corLineDetailDescription || line.corLineDetailItem || '').substring(0, 80);
      lines.push(`${i6}${el('corLineDetailDescription', desc)}`);
      lines.push(`${i6}${optEl('corLineDetailVMRSCode', line.corLineDetailVMRSCode)}`);

      // corPartCategories — self-closing when empty is the working-sample
      // pattern (Vijay's tested XML); nesting an empty corPartCategory
      // inside was producing extra noise the XSD didn't demand.
      lines.push(`${i6}${emptyEl('corPartCategories')}`);

      lines.push(`${i6}${el('corLineDetailQuantity', line.corLineDetailQuantity)}`);
      lines.push(`${i6}${el('corLineDetailUnitPrice', line.corLineDetailUnitPrice)}`);
      lines.push(`${i6}${optEl('corLineDetailCorePrice', line.corLineDetailCorePrice)}`);
      lines.push(`${i6}${optEl('corLineDetailFET', line.corLineDetailFET)}`);

      // corLineDetailNotes — self-close when empty (matches working sample)
      if (line.corLineDetailNotes && line.corLineDetailNotes.length > 0) {
        lines.push(`${i6}<corLineDetailNotes>`);
        for (const note of line.corLineDetailNotes) {
          lines.push(`${i6}${indent}${el('corLineDetailNote', note)}`);
        }
        lines.push(`${i6}</corLineDetailNotes>`);
      } else {
        lines.push(`${i6}${emptyEl('corLineDetailNotes')}`);
      }

      lines.push(`${i6}${el('corLineDetailUOM', line.corLineDetailUOM)}`);
      lines.push(`${i5}</corLineDetail>`);
    }
    lines.push(`${i4}</corLineDetails>`);

    lines.push(`${i3}</corSection>`);
  }
  lines.push(`${i2}</corSections>`);

  // corTaxes — invoice-level (after sections)
  if (r.corTaxes && r.corTaxes.length > 0) {
    const i3 = i2 + indent;
    lines.push(`${i2}<corTaxes>`);
    for (const tax of r.corTaxes) {
      lines.push(`${i3}<corTax>`);
      lines.push(`${i3}${indent}${el('corTaxType', tax.corTaxType)}`);
      lines.push(`${i3}${indent}${el('corTaxAmount', tax.corTaxAmount)}`);
      if (tax.corTaxID) lines.push(`${i3}${indent}${el('corTaxID', tax.corTaxID)}`);
      if (tax.corTaxDescription) lines.push(`${i3}${indent}${el('corTaxDescription', tax.corTaxDescription)}`);
      lines.push(`${i3}</corTax>`);
    }
    lines.push(`${i2}</corTaxes>`);
  } else {
    lines.push(`${i2}${emptyEl('corTaxes')}`);
  }

  // corBaseImage — base64-encoded PDF of the invoice (optional for submissions, mandatory for delivery receipts)
  if (r.corBaseImage) {
    // Base64 content is NOT XML-escaped — it's raw base64 text, safe for XML as-is
    lines.push(`${i2}<corBaseImage>${r.corBaseImage}</corBaseImage>`);
  } else {
    lines.push(`${i2}${emptyEl('corBaseImage')}`);
  }

  lines.push(`${indent}</corRequest>`);
  lines.push('</ProcessRequest>');

  return lines.filter(l => l.trim()).join(nl);
}
