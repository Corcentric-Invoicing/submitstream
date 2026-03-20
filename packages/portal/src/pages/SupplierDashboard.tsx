import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Invoice } from '../types/invoice';
import StatusBadge from '../components/StatusBadge';

export default function SupplierDashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState({ processed: 0, pending: 0, rejected: 0 });
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

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
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Corcentric Invoicing — Supplier Portal</h1>
          <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-700">
            Sign Out
          </button>
        </div>
      </header>

      {/* Summary bar */}
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
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No invoices found</td></tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {(inv.invoice_data as Record<string, unknown>)?.InvoiceNumber as string || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{inv.file_name}</td>
                    <td className="px-4 py-3 text-sm">
                      {(inv.invoice_data as Record<string, unknown>)?.InvoiceTotal
                        ? `$${(inv.invoice_data as Record<string, unknown>).InvoiceTotal}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {inv.status === 'pending' && (
                        <span className="text-yellow-600">Under review — we'll update you when resolved</span>
                      )}
                      {inv.status === 'rejected' && inv.feedback && (
                        <div>
                          <span className="text-red-600 font-medium">Action needed: </span>
                          <span className="text-gray-700">{inv.feedback}</span>
                        </div>
                      )}
                      {inv.status === 'processed' && (
                        <span className="text-green-600">Processed successfully</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
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
