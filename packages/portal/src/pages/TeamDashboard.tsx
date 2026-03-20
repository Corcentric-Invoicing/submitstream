import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Invoice } from '../types/invoice';
import StatusBadge from '../components/StatusBadge';

interface Stats {
  processed: number;
  pending: number;
  rejected: number;
  total: number;
}

export default function TeamDashboard() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [stats, setStats] = useState<Stats>({ processed: 0, pending: 0, rejected: 0, total: 0 });
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchInvoices();
    fetchStats();

    // Real-time subscription for invoice updates
    const channel = supabase
      .channel('invoice-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        fetchInvoices();
        fetchStats();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [statusFilter]);

  async function fetchInvoices() {
    let query = supabase
      .from('invoices')
      .select('*, supplier:suppliers(name, code)')
      .order('created_at', { ascending: false })
      .limit(50);

    if (statusFilter !== 'all') {
      query = query.eq('status', statusFilter);
    }

    const { data } = await query;
    setInvoices((data as Invoice[]) || []);
    setLoading(false);
  }

  async function fetchStats() {
    const [processed, pending, rejected, total] = await Promise.all([
      supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'processed'),
      supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      supabase.from('invoices').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
      supabase.from('invoices').select('id', { count: 'exact', head: true }),
    ]);
    setStats({
      processed: processed.count || 0,
      pending: pending.count || 0,
      rejected: rejected.count || 0,
      total: total.count || 0,
    });
  }

  async function handleStatusChange(invoiceId: string, newStatus: string, feedback?: string) {
    const updateData: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'rejected' && feedback) {
      updateData.feedback = feedback;
      updateData.needs_supplier_review = true;
      updateData.feedback_date = new Date().toISOString();
    }
    if (newStatus === 'processed') {
      updateData.needs_supplier_review = false;
    }

    await supabase.from('invoices').update(updateData).eq('id', invoiceId);
    fetchInvoices();
    fetchStats();
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Corcentric Invoicing — Team Dashboard</h1>
          <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-700">
            Sign Out
          </button>
        </div>
      </header>

      {/* Stats cards */}
      <div className="px-6 py-6 grid grid-cols-4 gap-4">
        <StatCard label="Total" count={stats.total} color="bg-gray-100" onClick={() => setStatusFilter('all')} active={statusFilter === 'all'} />
        <StatCard label="Processed" count={stats.processed} color="bg-green-50 border-green-200" textColor="text-green-700" onClick={() => setStatusFilter('processed')} active={statusFilter === 'processed'} />
        <StatCard label="Pending" count={stats.pending} color="bg-yellow-50 border-yellow-200" textColor="text-yellow-700" onClick={() => setStatusFilter('pending')} active={statusFilter === 'pending'} />
        <StatCard label="Rejected" count={stats.rejected} color="bg-red-50 border-red-200" textColor="text-red-700" onClick={() => setStatusFilter('rejected')} active={statusFilter === 'rejected'} />
      </div>

      {/* Invoice table */}
      <div className="px-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Invoice #</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Confidence</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Received</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">Loading...</td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No invoices found</td></tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                    <td className="px-4 py-3 text-sm font-medium">{(inv.invoice_data as Record<string, unknown>)?.InvoiceNumber as string || inv.file_name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{inv.supplier?.name || '—'}</td>
                    <td className="px-4 py-3 text-sm">{(inv.invoice_data as Record<string, unknown>)?.InvoiceTotal ? `$${(inv.invoice_data as Record<string, unknown>).InvoiceTotal}` : '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{inv.source}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{inv.confidence || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(inv.created_at).toLocaleDateString()}</td>
                    <td className="px-4 py-3 space-x-2">
                      {inv.status !== 'processed' && (
                        <button onClick={() => handleStatusChange(inv.id, 'processed')} className="text-xs text-green-600 hover:text-green-800">Approve</button>
                      )}
                      {inv.status !== 'rejected' && (
                        <button onClick={() => {
                          const feedback = prompt('Enter feedback for supplier:');
                          if (feedback) handleStatusChange(inv.id, 'rejected', feedback);
                        }} className="text-xs text-red-600 hover:text-red-800">Reject</button>
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

function StatCard({ label, count, color, textColor = 'text-gray-700', onClick, active }: {
  label: string; count: number; color: string; textColor?: string; onClick: () => void; active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-all ${color} ${active ? 'ring-2 ring-blue-500' : ''}`}
    >
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${textColor}`}>{count}</p>
    </button>
  );
}
