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

  // ===== Header fields — order from working sample =====
  lines.push(`${i2}${el('corRequestID', r.corRequestID)}`);
  lines.push(`${i2}${el('corRequestType', r.corRequestType)}`);
  lines.push(`${i2}${el('corVendorCode', r.corVendorCode)}`);
  lines.push(`${i2}${el('corCustomerCode', r.corCustomerCode)}`);
  lines.push(`${i2}${el('corCommunityCode', r.corCommunityCode)}`);
  lines.push(`${i2}${el('corTransactionType', r.corTransactionType)}`);
  lines.push(`${i2}${el('corTransactionNumber', r.corTransactionNumber)}`);
  lines.push(`${i2}${optEl('corOriginatingDocumentNumber', r.corOriginatingDocumentNumber)}`);
  lines.push(`${i2}${el('corTransactionDate', r.corTransactionDate)}`);
  lines.push(`${i2}${optEl('corPurchaseOrderNumber', r.corPurchaseOrderNumber)}`);
  lines.push(`${i2}${el('corTransactionAmount', r.corTransactionAmount)}`);
  lines.push(`${i2}${el('corAuthorizationAmount', r.corAuthorizationAmount)}`);
  lines.push(`${i2}${el('corCurrencyCode', r.corCurrencyCode)}`);

  // corPaymentTerms — empty container
  lines.push(`${i2}${emptyEl('corPaymentTerms')}`);

  // corPointOfSale — empty container or populated
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

  // corReferences
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

  // corAsset — comes BEFORE corSections per working sample
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

  // ===== Sections (line items) =====
  lines.push(`${i2}<corSections>`);
  for (const section of r.corSections) {
    const i3 = i2 + indent;
    lines.push(`${i3}<corSection>`);
    const i4 = i3 + indent;
    lines.push(`${i4}${el('corSectionNumber', section.corSectionNumber)}`);

    // corComments — per working sample, no corSectionInfo, just corComments directly
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

    // corLineDetails
    lines.push(`${i4}<corLineDetails>`);
    for (const line of section.corLineDetails) {
      const i5 = i4 + indent;
      lines.push(`${i5}<corLineDetail>`);
      const i6 = i5 + indent;

      // Line detail elements — order from working sample
      lines.push(`${i6}${el('corLineDetailSequence', line.corLineDetailSequence)}`);
      lines.push(`${i6}${el('corLineDetailType', line.corLineDetailType)}`);
      lines.push(`${i6}${el('corLineDetailItem', line.corLineDetailItem)}`);
      lines.push(`${i6}${optEl('corLineDetailBuyerItem', line.corLineDetailBuyerItem)}`);

      // nvarchar(80) — truncate to 80 chars max
      const desc = String(line.corLineDetailDescription || line.corLineDetailItem || '').substring(0, 80);
      lines.push(`${i6}${el('corLineDetailDescription', desc)}`);

      // corPartCategories — required per working sample, empty if not provided
      lines.push(`${i6}<corPartCategories>`);
      lines.push(`${i6}${indent}<corPartCategory>`);
      lines.push(`${i6}${indent}${indent}${emptyEl('corCategoryType')}`);
      lines.push(`${i6}${indent}${indent}${emptyEl('corCategory')}`);
      lines.push(`${i6}${indent}</corPartCategory>`);
      lines.push(`${i6}</corPartCategories>`);

      lines.push(`${i6}${el('corLineDetailQuantity', line.corLineDetailQuantity)}`);
      lines.push(`${i6}${el('corLineDetailUnitPrice', line.corLineDetailUnitPrice)}`);
      lines.push(`${i6}${optEl('corLineDetailFET', line.corLineDetailFET)}`);

      // corLineDetailNotes
      if (line.corLineDetailNotes && line.corLineDetailNotes.length > 0) {
        lines.push(`${i6}<corLineDetailNotes>`);
        for (const note of line.corLineDetailNotes) {
          lines.push(`${i6}${indent}${el('corLineDetailNote', note)}`);
        }
        lines.push(`${i6}</corLineDetailNotes>`);
      } else {
        lines.push(`${i6}<corLineDetailNotes>`);
        lines.push(`${i6}${indent}${emptyEl('corLineDetailNote')}`);
        lines.push(`${i6}</corLineDetailNotes>`);
      }

      lines.push(`${i6}${el('corLineDetailUOM', line.corLineDetailUOM)}`);

      // corTransactionInfo — at LINE level per working sample
      lines.push(`${i6}${emptyEl('corTransactionInfo')}`);

      lines.push(`${i5}</corLineDetail>`);
    }
    lines.push(`${i4}</corLineDetails>`);

    lines.push(`${i3}</corSection>`);
  }
  lines.push(`${i2}</corSections>`);

  // corTaxes — invoice-level
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
