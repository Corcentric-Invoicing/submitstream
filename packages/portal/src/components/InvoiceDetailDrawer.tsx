import type { Invoice } from '../types/invoice';
import StatusBadge from './StatusBadge';

interface Props {
  invoice: Invoice | null;
  onClose: () => void;
  onStatusChange?: (invoiceId: string, newStatus: string, feedback?: string) => void;
  isTeamView?: boolean;
}

export default function InvoiceDetailDrawer({ invoice, onClose, onStatusChange, isTeamView = false }: Props) {
  if (!invoice) return null;

  const data = (invoice.invoice_data || {}) as Record<string, unknown>;

  const fields: { label: string; key: string; format?: (v: unknown) => string }[] = [
    { label: 'Invoice Number', key: 'InvoiceNumber' },
    { label: 'Invoice Date', key: 'InvoiceDate' },
    { label: 'Due Date', key: 'DueDate' },
    { label: 'PO Number', key: 'PurchaseOrderNumber' },
    { label: 'Subtotal', key: 'SubTotal', format: (v) => `$${Number(v).toFixed(2)}` },
    { label: 'Tax', key: 'TaxAmount', format: (v) => `$${Number(v).toFixed(2)}` },
    { label: 'Total', key: 'InvoiceTotal', format: (v) => `$${Number(v).toFixed(2)}` },
  ];

  const vendorFields: { label: string; key: string }[] = [
    { label: 'Vendor Name', key: 'VendorName' },
    { label: 'Vendor Address', key: 'VendorAddress' },
    { label: 'Vendor Tax ID', key: 'VendorTaxId' },
  ];

  const buyerFields: { label: string; key: string }[] = [
    { label: 'Customer Name', key: 'CustomerName' },
    { label: 'Customer Address', key: 'CustomerAddress' },
    { label: 'Customer Tax ID', key: 'CustomerTaxId' },
  ];

  const lineItems = (data.Items || data.LineItems || []) as Record<string, unknown>[];

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative w-full max-w-xl bg-white shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold text-gray-900">Invoice Details</h2>
            <StatusBadge status={invoice.status} />
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Meta info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">Source</span>
              <span className="font-medium text-gray-900 capitalize">{invoice.source}</span>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">OCR Provider</span>
              <span className="font-medium text-gray-900 capitalize">{invoice.ocr_provider}</span>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">Confidence</span>
              <span className={`font-medium ${
                invoice.confidence === 'high' ? 'text-green-700' :
                invoice.confidence === 'medium' ? 'text-yellow-700' :
                invoice.confidence === 'low' ? 'text-red-700' : 'text-gray-500'
              }`}>
                {invoice.confidence ? invoice.confidence.charAt(0).toUpperCase() + invoice.confidence.slice(1) : '—'}
              </span>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-1">File</span>
              <span className="font-medium text-gray-900 truncate block">{invoice.file_name}</span>
            </div>
          </div>

          {/* Invoice fields */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Invoice Information</h3>
            <div className="space-y-2">
              {fields.map(f => {
                const val = data[f.key];
                if (val === undefined || val === null || val === '') return null;
                return (
                  <div key={f.key} className="flex justify-between py-1.5 border-b border-gray-100">
                    <span className="text-sm text-gray-500">{f.label}</span>
                    <span className="text-sm font-medium text-gray-900">{f.format ? f.format(val) : String(val)}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Vendor info */}
          {vendorFields.some(f => data[f.key]) && (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Vendor</h3>
              <div className="space-y-2">
                {vendorFields.map(f => {
                  const val = data[f.key];
                  if (!val) return null;
                  return (
                    <div key={f.key} className="flex justify-between py-1.5 border-b border-gray-100">
                      <span className="text-sm text-gray-500">{f.label}</span>
                      <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">{String(val)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Buyer info */}
          {buyerFields.some(f => data[f.key]) && (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Customer</h3>
              <div className="space-y-2">
                {buyerFields.map(f => {
                  const val = data[f.key];
                  if (!val) return null;
                  return (
                    <div key={f.key} className="flex justify-between py-1.5 border-b border-gray-100">
                      <span className="text-sm text-gray-500">{f.label}</span>
                      <span className="text-sm font-medium text-gray-900 text-right max-w-[60%]">{String(val)}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* Line items */}
          {lineItems.length > 0 && (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Line Items</h3>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Description</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Qty</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Unit Price</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {lineItems.map((item, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-gray-700">{String(item.Description || item.description || '—')}</td>
                        <td className="px-3 py-2 text-right text-gray-700">{String(item.Quantity || item.quantity || '—')}</td>
                        <td className="px-3 py-2 text-right text-gray-700">
                          {item.UnitPrice || item.unitPrice ? `$${Number(item.UnitPrice || item.unitPrice).toFixed(2)}` : '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">
                          {item.Amount || item.amount ? `$${Number(item.Amount || item.amount).toFixed(2)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Feedback section */}
          {invoice.feedback && (
            <section>
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Feedback</h3>
              <div className={`rounded-lg p-3 text-sm ${
                invoice.status === 'rejected' ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-700'
              }`}>
                {invoice.feedback}
                {invoice.feedback_date && (
                  <p className="text-xs mt-2 opacity-70">
                    {new Date(invoice.feedback_date).toLocaleString()}
                  </p>
                )}
              </div>
            </section>
          )}

          {/* Dates */}
          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Timeline</h3>
            <div className="space-y-2">
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-sm text-gray-500">Received</span>
                <span className="text-sm text-gray-900">{new Date(invoice.created_at).toLocaleString()}</span>
              </div>
              <div className="flex justify-between py-1.5 border-b border-gray-100">
                <span className="text-sm text-gray-500">Last Updated</span>
                <span className="text-sm text-gray-900">{new Date(invoice.updated_at).toLocaleString()}</span>
              </div>
            </div>
          </section>

          {/* Team actions */}
          {isTeamView && onStatusChange && invoice.status !== 'processed' && (
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => onStatusChange(invoice.id, 'processed')}
                className="flex-1 py-2.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors"
              >
                Approve Invoice
              </button>
              <button
                onClick={() => {
                  const feedback = prompt('Enter feedback for supplier:');
                  if (feedback) onStatusChange(invoice.id, 'rejected', feedback);
                }}
                className="flex-1 py-2.5 bg-white border border-red-300 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors"
              >
                Reject Invoice
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
