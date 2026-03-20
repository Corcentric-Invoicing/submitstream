import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Invoice } from '../types/invoice';
import StatusBadge from '../components/StatusBadge';
import InvoiceDetailDrawer from '../components/InvoiceDetailDrawer';
import InvoiceUpload from '../components/InvoiceUpload';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    fetchInvoices();
    fetchStats();

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
    // Update selected invoice if it's the one being changed
    if (selectedInvoice?.id === invoiceId) {
      setSelectedInvoice(null);
    }
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
  }

  // Filter by search query
  const filtered = invoices.filter(inv => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const data = inv.invoice_data as Record<string, unknown>;
    return (
      inv.file_name.toLowerCase().includes(q) ||
      String(data?.InvoiceNumber || '').toLowerCase().includes(q) ||
      inv.supplier?.name?.toLowerCase().includes(q) ||
      inv.supplier?.code?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 bg-blue-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm">C</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900">Corcentric Invoicing</h1>
              <p className="text-xs text-gray-500">Team Dashboard</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowUpload(true)}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Upload Invoice
            </button>
            <button onClick={handleSignOut} className="text-sm text-gray-500 hover:text-gray-700">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Stats cards */}
      <div className="px-6 py-6 grid grid-cols-4 gap-4">
        <StatCard
          label="Total"
          count={stats.total}
          color="bg-gray-50 border-gray-200"
          textColor="text-gray-700"
          onClick={() => setStatusFilter('all')}
          active={statusFilter === 'all'}
        />
        <StatCard
          label="Processed"
          count={stats.processed}
          color="bg-green-50 border-green-200"
          textColor="text-green-700"
          onClick={() => setStatusFilter(statusFilter === 'processed' ? 'all' : 'processed')}
          active={statusFilter === 'processed'}
        />
        <StatCard
          label="Pending"
          count={stats.pending}
          color="bg-yellow-50 border-yellow-200"
          textColor="text-yellow-700"
          onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}
          active={statusFilter === 'pending'}
        />
        <StatCard
          label="Rejected"
          count={stats.rejected}
          color="bg-red-50 border-red-200"
          textColor="text-red-700"
          onClick={() => setStatusFilter(statusFilter === 'rejected' ? 'all' : 'rejected')}
          active={statusFilter === 'rejected'}
        />
      </div>

      {/* Search + table */}
      <div className="px-6">
        {/* Search bar */}
        <div className="mb-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search invoices by number, file name, or supplier..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Invoice table */}
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
                <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400" />
                    <span className="text-sm">Loading invoices...</span>
                  </div>
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="text-4xl">📋</div>
                    <div>
                      <p className="text-sm font-medium text-gray-700">
                        {searchQuery ? 'No invoices match your search' : 'No invoices yet'}
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {searchQuery
                          ? 'Try adjusting your search terms'
                          : 'Invoices will appear here as suppliers email them in, or upload one manually.'}
                      </p>
                    </div>
                    {!searchQuery && (
                      <button
                        onClick={() => setShowUpload(true)}
                        className="mt-2 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                      >
                        Upload Invoice
                      </button>
                    )}
                  </div>
                </td></tr>
              ) : (
                filtered.map((inv) => {
                  const data = inv.invoice_data as Record<string, unknown>;
                  return (
                    <tr
                      key={inv.id}
                      className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                      onClick={() => setSelectedInvoice(inv)}
                    >
                      <td className="px-4 py-3"><StatusBadge status={inv.status} /></td>
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">
                        {(data?.InvoiceNumber as string) || inv.file_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{inv.supplier?.name || '—'}</td>
                      <td className="px-4 py-3 text-sm font-medium">
                        {data?.InvoiceTotal ? `$${Number(data.InvoiceTotal).toLocaleString(undefined, { minimumFractionDigits: 2 })}` : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          inv.source === 'email' ? 'bg-purple-50 text-purple-700' : 'bg-blue-50 text-blue-700'
                        }`}>
                          {inv.source === 'email' ? '📧 Email' : '📤 Upload'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {inv.confidence && (
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            inv.confidence === 'high' ? 'bg-green-50 text-green-700' :
                            inv.confidence === 'medium' ? 'bg-yellow-50 text-yellow-700' :
                            'bg-red-50 text-red-700'
                          }`}>
                            {inv.confidence}
                          </span>
                        ) || <span className="text-xs text-gray-400">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">
                        {new Date(inv.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 space-x-2" onClick={e => e.stopPropagation()}>
                        {inv.status !== 'processed' && (
                          <button
                            onClick={() => handleStatusChange(inv.id, 'processed')}
                            className="text-xs font-medium text-green-600 hover:text-green-800 bg-green-50 px-2 py-1 rounded"
                          >
                            Approve
                          </button>
                        )}
                        {inv.status !== 'rejected' && (
                          <button
                            onClick={() => {
                              const feedback = prompt('Enter feedback for supplier:');
                              if (feedback) handleStatusChange(inv.id, 'rejected', feedback);
                            }}
                            className="text-xs font-medium text-red-600 hover:text-red-800 bg-red-50 px-2 py-1 rounded"
                          >
                            Reject
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
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
          onStatusChange={handleStatusChange}
          isTeamView
        />
      )}

      {/* Upload modal */}
      {showUpload && (
        <InvoiceUpload
          onClose={() => setShowUpload(false)}
          onUploadComplete={() => { setShowUpload(false); fetchInvoices(); fetchStats(); }}
        />
      )}
    </div>
  );
}

function StatCard({ label, count, color, textColor = 'text-gray-700', onClick, active }: {
  label: string; count: number; color: string; textColor?: string; onClick: () => void; active: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition-all ${color} ${active ? 'ring-2 ring-blue-500 shadow-sm' : 'hover:shadow-sm'}`}
    >
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${textColor}`}>{count}</p>
    </button>
  );
}
