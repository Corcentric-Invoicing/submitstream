import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Invoice } from '../types/invoice';
import StatusBadge from '../components/StatusBadge';
import InvoiceDetailDrawer from '../components/InvoiceDetailDrawer';

export default function SupplierDashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState({ processed: 0, pending: 0, rejected: 0 });
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    fetchInvoices();

    const channel = supabase
      .channel('supplier-invoice-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        fetchInvoices();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [statusFilter]);

  async function fetchInvoices() {
    let query = supabase
      .from('invoices')
      .select('*')
      .order('created_at', { ascending: false });

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data } = await query;
    const invoiceList = (data as Invoice[]) || [];
    setInvoices(invoiceList);
    setStats({
      processed: invoiceList.filter(i => i.status === 'processed').length,
      pending: invoiceList.filter(i => i.status === 'pending').length,
      rejected: invoiceList.filter(i => i.status === 'rejected').length,
    });
    setLoading(false);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-green-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Corcentric Invoicing</h1>
              <p className="text-xs text-gray-500">Supplier Portal</p>
            </div>
          </div>
          <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-700">
            Sign Out
          </button>
        </div>
      </header>

      {/* Summary pills */}
      <div className="px-6 py-6 flex gap-4">
        <SummaryPill emoji="🟢" label="Processed" count={stats.processed} onClick={() => setStatusFilter(statusFilter === 'processed' ? 'all' : 'processed')} active={statusFilter === 'processed'} />
        <SummaryPill emoji="🟡" label="Pending" count={stats.pending} onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')} active={statusFilter === 'pending'} />
        <SummaryPill emoji="🔴" label="Rejected" count={stats.rejected} onClick={() => setStatusFilter(statusFilter === 'rejected' ? 'all' : 'rejected')} active={statusFilter === 'rejected'} />
      </div>

      {/* Invoice list */}
      <div className="px-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice #</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">File</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Received</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400" />
                    <span className="text-sm">Loading invoices...</span>
                  </div>
                </td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="text-4xl">📋</div>
                    <p className="text-sm font-medium text-gray-700">No invoices found</p>
                    <p className="text-xs text-gray-500">Your submitted invoices will appear here.</p>
                  </div>
                </td></tr>
              ) : (
                invoices.map((inv) => (
                  <tr
                    key={inv.id}
                    className="hover:bg-green-50/50 cursor-pointer transition-colors"
                    onClick={() => setSelectedInvoice(inv)}
                  >
                    <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {(inv.invoice_data as Record<string, unknown>)?.InvoiceNumber as string || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{inv.file_name}</td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {(inv.invoice_data as Record<string, unknown>)?.InvoiceTotal
                        ? `$${Number((inv.invoice_data as Record<string, unknown>).InvoiceTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {inv.status === 'pending' && (
                        <span className="text-yellow-600">Under review</span>
                      )}
                      {inv.status === 'rejected' && inv.feedback && (
                        <span className="text-red-600 font-medium">Action needed</span>
                      )}
                      {inv.status === 'processed' && (
                        <span className="text-green-600">Complete</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invoice detail drawer */}
      {selectedInvoice && (
        <InvoiceDetailDrawer
          invoice={selectedInvoice}
          onClose={() => setSelectedInvoice(null)}
        />
      )}
    </div>
  );
}

function SummaryPill({ emoji, label, count, onClick, active }: {
  emoji: string; label: string; count: number; onClick: () => void; active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
        active ? 'bg-gray-200 ring-2 ring-blue-500' : 'bg-white border border-gray-200 hover:bg-gray-50'
      }`}
    >
      <span>{emoji}</span>
      <span>{label}</span>
      <span className="ml-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-bold">{count}</span>
    </button>
  );
}
