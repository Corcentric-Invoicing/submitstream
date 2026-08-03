# PromoStandards Invoice 1.0.0 — WSDL/XSD reference

Authoritative schema files for the PromoStandards Invoice 1.0.0 service,
committed here so the serializer/client in `src/api/promostandards/`
can be diffed against the spec at any time.

Source: https://services.promostandards.org/ (released 2019-10-11,
spec v1.0.0 dated 2020-01-27).

## Files

- `InvoiceService.wsdl` — service definition, binding, SOAPAction values
- `GetInvoicesRequest.xsd` — request payload schema
- `GetInvoicesResponse.xsd` — response payload schema
- `GetVoidedInvoicesRequest.xsd` / `GetVoidedInvoicesResponse.xsd` — voided-invoice variants
- `SharedObjectsInvoice.xsd` — all leaf elements (wsVersion, id, AccountInfo, InvoiceLineItem, etc.)
- `iso3166-country-code.xsd` — ISO 3166 country-code enumeration
- `iso4217-currency-code.xsd` — ISO 4217 currency-code enumeration

## Namespaces in play

| Prefix | URI | What lives here |
| ------ | --- | --------------- |
| `tns`  | `http://www.promostandards.org/WSDL/Invoice/1.0.0/` | Request/response root elements (`GetInvoicesRequest`, `Invoice`, `BillTo`, `SoldTo`, `InvoiceArray`, …) |
| `shar` | `http://www.promostandards.org/WSDL/Invoice/1.0.0/SharedObjects/` | All leaf elements (`wsVersion`, `id`, `password`, `queryType`, `invoiceNumber`, `accountName`, `Address1`, `invoiceQuantity`, …) |

Because `elementFormDefault="qualified"` is set on every schema, every
element we emit or parse must carry the correct prefix.

## Gotchas our parser/serializer accounts for

1. **Request element is `GetInvoicesRequest`** (PascalCase), not
   `getInvoicesRequest`. The WSDL's operation name is `getInvoices`.
2. **SOAPAction is `"getInvoices"`** (quoted), per the binding.
3. **`password` is declared without `minOccurs="0"`** — required in
   the XSD even though the narrative spec table lists it as optional.
4. **BillTo / SoldTo wrap an `<AccountInfo>` child** — they are not
   flat containers for the address fields.
5. **Address fields are PascalCase** (`Address1`, `Address2`, `Address3`)
   while everything else in `AccountInfo` is camelCase.
6. **Invoice header uses `<fob>`**, not `fobId`.
7. **`TaxArray` contains `<tax>` elements** (lowercase singular).
8. **`SalesOrderNumbersArray` contains repeated `<salesOrderNumber>`
   leaves** — there is no wrapper element per entry.
9. Strict sequence order in `GetInvoicesRequest`:
   `wsVersion → id → password → queryType → referenceNumber?
   → requestedDate? → availableTimeStamp?`

## Validating an implementation

PromoStandards provides a free validator:
https://services.promostandards.org/webserviceValidator/home

Select service = Invoice, version = 1.0.0, method = getInvoices,
paste the endpoint URL, and it will confirm whether the response is
spec-compliant. Useful for onboarding new suppliers.
