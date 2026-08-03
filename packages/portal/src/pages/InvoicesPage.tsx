import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import type { Invoice, InvoiceStatus } from '../types/invoice';
import { STATUS_LABELS, STATUS_VARIANTS, STATUS_ACTIONS } from '../types/invoice';
import InvoiceUpload from '../components/InvoiceUpload';
import InvoiceReview from './InvoiceReview';
import { AppShell } from '@/components/AppShell';
import { useAppState } from '@/lib/useAppState';
import { Button } from '@/components/ui/button';
import { Pill, type PillProps } from '@/components/ui/pill';
import { KpiCard } from '@/components/ui/kpi-card';
import { FilterChip } from '@/components/ui/filter-chip';
import { BrandedSpinner } from '@/components/ui/branded-spinner';
import { Download, Plus, AlertTriangle } from 'lucide-react';

/**
 * Unified invoice queue, scoped by supplier (URL param ?supplier=<id>) and
 * by status (URL param ?status=...). The sidebar in AppShell drives both.
 *
 * Status enum mapping (DB → display):
 *   processing → "OCR running"
 *   pending    → "Needs review"
 *   processed  → "Submitted"
 *   rejected   → "Rejected"
 */

import type { Role } from '../lib/role';
import { isAdmin as isRoleAdmin } from '../lib/role';

interface InvoicesPageProps {
  role: Role;
  userId: string;
  userEmail: string | undefined;
}

type StatusFilterKey = 'all' | InvoiceStatus;

export default function InvoicesPage({ role, userId, userEmail }: InvoicesPageProps) {
  const isAdmin = isRoleAdmin(role);
  const { supplierScope } = useAppState(role, userId);
  const [params, setParams] = useSearchParams();
  const statusFilter = (params.get('status') as StatusFilterKey) ?? 'all';
  // The optional :invoiceId path segment drives the review overlay so the
  // URL survives refresh + tab-switch. /invoices renders the list,
  // /invoices/:id renders the same list with the review overlaid.
  const { invoiceId } = useParams<{ invoiceId?: string }>();
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // Multi-select state for the CSV bulk export. Set of invoice ids the
  // user has checked. Empty Set = "export all currently filtered" fallback.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  // Used for invoices that were opened directly via deep-link before the
  // list query has run (or the invoice isn't in the current scope's page).
  // We fetch it independently and render the overlay from this fallback.
  const [deepLinkedInvoice, setDeepLinkedInvoice] = useState<Invoice | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  // Helper that preserves the existing search-params (status, supplier, etc)
  // when navigating between list and review.
  const queryString = params.toString();
  function openInvoice(id: string) {
    navigate(`/invoices/${id}${queryString ? `?${queryString}` : ''}`);
  }
  function closeInvoice() {
    navigate(`/invoices${queryString ? `?${queryString}` : ''}`);
  }

  // ── Fetch invoices when scope changes; subscribe to realtime + poll ──
  //
  // Two refresh paths working in parallel:
  //   1. Supabase realtime channel — instant updates when working, but
  //      depends on RLS-compatible realtime config being enabled on the
  //      table. Doesn't always fire reliably in our setup.
  //   2. Polling fallback — refetches every POLL_INTERVAL_MS regardless
  //      of realtime. Guarantees the queue stays fresh during demos.
  //
  // We deliberately pause polling when the document is hidden (tab
  // backgrounded) to avoid wasted DB reads.
  useEffect(() => {
    // Initial mount: show the spinner so first-paint has visible feedback.
    fetchInvoices();

    // Realtime — instant when it works. Silent so it doesn't flash spinner.
    const channel = supabase
      .channel('invoice-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, () => {
        fetchInvoices({ silent: true });
      })
      .subscribe();

    // Polling fallback — 6s is short enough to feel "live" (OCR finishes in
    // 5-15s so users see status transitions) but doesn't hammer the DB.
    // Silent refresh so the table data updates in place without flashing
    // the full-page spinner / logo. Skips when the tab is hidden.
    const POLL_INTERVAL_MS = 6000;
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchInvoices({ silent: true });
      }
    }, POLL_INTERVAL_MS);

    // Also refetch immediately when the tab regains focus, so coming back
    // to the page after switching tabs shows fresh data without waiting
    // for the next poll tick. Also silent.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') fetchInvoices({ silent: true });
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierScope]);

  // ── Deep-link resolution ──
  // If the URL says /invoices/:id but the requested invoice isn't in the
  // current list (e.g. user pasted a URL fresh, or the invoice is outside
  // the active supplier scope), fetch it directly. RLS still protects
  // visibility — a supplier deep-linking to another supplier's invoice
  // gets nothing back.
  useEffect(() => {
    if (!invoiceId) {
      setDeepLinkedInvoice(null);
      return;
    }
    if (invoices.find((i) => i.id === invoiceId)) {
      setDeepLinkedInvoice(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('invoices')
        .select('*, supplier:suppliers(id, name, code)')
        .eq('id', invoiceId)
        .maybeSingle();
      if (cancelled) return;
      setDeepLinkedInvoice((data as Invoice) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, invoices]);

  // The invoice currently displayed in the review overlay (if any).
  const selectedInvoice = invoiceId
    ? invoices.find((i) => i.id === invoiceId) ?? deepLinkedInvoice
    : null;

  async function fetchInvoices(opts?: { silent?: boolean }) {
    // Silent mode skips the loading spinner — used by background polling
    // and realtime updates so the queue refreshes invisibly. The initial
    // page load + scope changes still show the spinner so the user gets
    // feedback that data is being fetched.
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    let query = supabase
      .from('invoices')
      .select('*, supplier:suppliers(id, name, code)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (supplierScope !== 'all') query = query.eq('supplier_id', supplierScope);
    const { data } = await query;
    setInvoices((data as Invoice[]) || []);
    if (!silent) setLoading(false);
  }

  function setStatus(s: StatusFilterKey) {
    const next = new URLSearchParams(params);
    if (s === 'all') next.delete('status');
    else next.set('status', s);
    setParams(next, { replace: false });
  }

  // ── CSV export ──
  // POSTs the selected ids (or, if nothing selected, every currently-filtered
  // invoice id) to /api/invoices/export-csv. The worker returns a single CSV
  // with all line items combined; we trigger a browser download.
  async function handleExportCsv() {
    if (exporting) return;
    // If the user has explicit selections, export those. Otherwise export every
    // invoice currently visible in the table after filters/search.
    const idsToExport =
      selectedIds.size > 0
        ? Array.from(selectedIds)
        : filtered.map((i) => i.id);

    if (idsToExport.length === 0) {
      alert('No invoices to export.');
      return;
    }

    setExporting(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/invoices/export-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ ids: idsToExport }),
      });
      if (!res.ok) {
        let msg = `Export failed (HTTP ${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) msg = body.error;
        } catch { /* fall through */ }
        throw new Error(msg);
      }
      // Stream the response body as a Blob and trigger a download via an
      // anchor click. Filename comes from Content-Disposition or a fallback.
      const blob = await res.blob();
      const cd = res.headers.get('Content-Disposition') || '';
      const match = cd.match(/filename="?([^"]+)"?/);
      const filename = match?.[1] || `invoices_${idsToExport.length}.csv`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      // Clear the selection after a successful export
      setSelectedIds(new Set());
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  // ── Selection helpers ──
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelectAll(currentlyVisible: string[]) {
    setSelectedIds((prev) => {
      // If every visible row is already selected, clear. Otherwise select all visible.
      const allSelected = currentlyVisible.length > 0 && currentlyVisible.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of currentlyVisible) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of currentlyVisible) next.add(id);
      return next;
    });
  }

  // ── Derived ──
  const filtered = useMemo(() => {
    return invoices.filter((inv) => {
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      const data = inv.invoice_data as Record<string, unknown>;
      const haystack = [
        inv.file_name,
        data?.InvoiceNumber,
        data?.CustomerName,
        data?.BillToName,
        data?.PurchaseOrderNumber,
        inv.supplier?.name,
        inv.supplier?.code,
      ]
        .map((v) => String(v ?? '').toLowerCase())
        .join(' ');
      return haystack.includes(q);
    });
  }, [invoices, statusFilter, searchQuery]);

  const counts = useMemo(() => countByStatus(invoices), [invoices]);
  const trends = useMemo(() => buildTrends(invoices), [invoices]);

  return (
    <AppShell
      role={role}
      userId={userId}
      userEmail={userEmail}
      breadcrumb="Invoices"
      counts={counts}
      searchValue={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search invoices, suppliers…"
    >
      <div className="px-7 py-7 max-w-[1400px] mx-auto">
        {/* Page head + actions */}
        <div className="flex items-end gap-4 mb-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Invoices</h1>
            <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
              Email-ingested, OCR-parsed by Mistral, awaiting your review before
              submission to the DMS.
            </p>
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={handleExportCsv}
              disabled={exporting || filtered.length === 0}
              title={
                selectedIds.size > 0
                  ? `Export ${selectedIds.size} selected invoice${selectedIds.size === 1 ? '' : 's'}`
                  : `Export all ${filtered.length} filtered invoice${filtered.length === 1 ? '' : 's'}`
              }
            >
              <Download size={13} aria-hidden />
              {exporting
                ? 'Exporting…'
                : selectedIds.size > 0
                  ? `Export CSV (${selectedIds.size})`
                  : 'Export CSV'}
            </Button>
            <Button variant="primary" size="md" onClick={() => setShowUpload(true)}>
              <Plus size={13} aria-hidden />
              Upload invoice
            </Button>
          </div>
        </div>

        {/* KPI strip — five buckets reflecting the actual lifecycle:
              Total · Awaiting review · Ready to submit · Submitted · Rejected.
              The previous version conflated "OCR-processed" with "submitted
              to DMS" — they are distinct states. `processed` = a human
              has reviewed; `submitted` = the worker actually posted XML
              to Corcentric. */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 mb-5">
          <KpiCard
            active={statusFilter === 'all'}
            label="Total invoices"
            value={counts.total.toString()}
            deltaSubtext={`${counts.processing} processing`}
            sparkline={trends.total}
            tone="ink"
            onClick={() => setStatus('all')}
          />
          <KpiCard
            active={statusFilter === 'pending'}
            label="Awaiting review"
            value={counts.pending.toString()}
            deltaSubtext={`${counts.processing} OCR running`}
            sparkline={trends.pending}
            tone="warning"
            onClick={() => setStatus('pending')}
          />
          <KpiCard
            active={statusFilter === 'processed'}
            label="Ready to submit"
            value={counts.processed.toString()}
            deltaSubtext="reviewed, awaiting DMS"
            sparkline={trends.processed}
            tone="ink"
            onClick={() => setStatus('processed')}
          />
          <KpiCard
            active={statusFilter === 'submitted'}
            label="Submitted to DMS"
            value={
              <>
                {counts.submitted}{' '}
                <span className="text-base font-medium text-zinc-400">/ {counts.total}</span>
              </>
            }
            deltaSubtext={`${pct(counts.submitted, counts.total)}% conversion`}
            sparkline={trends.submitted}
            tone="success"
            onClick={() => setStatus('submitted')}
          />
          <KpiCard
            active={statusFilter === 'rejected'}
            label="Rejected"
            value={counts.rejected.toString()}
            deltaSubtext="needs supplier follow-up"
            sparkline={trends.rejected}
            tone="danger"
            onClick={() => setStatus('rejected')}
          />
        </div>

        {/* Active filter chips */}
        {statusFilter !== 'all' && (
          <div className="flex flex-wrap gap-1.5 items-center mb-3">
            <FilterChip active onClear={() => setStatus('all')}>
              Status · {labelFor(statusFilter as InvoiceStatus)}
            </FilterChip>
          </div>
        )}

        {/* Table */}
        <div className="bg-white border border-line rounded-card shadow-1 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-paper border-b border-line">
                <Th className="w-10">
                  {/* Header checkbox — checks / unchecks all currently-filtered rows */}
                  <input
                    type="checkbox"
                    aria-label="Select all visible invoices"
                    className="cursor-pointer accent-ink"
                    checked={
                      filtered.length > 0 &&
                      filtered.every((i) => selectedIds.has(i.id))
                    }
                    ref={(el) => {
                      // Indeterminate state when SOME but not all are selected
                      if (el) {
                        const visibleSelectedCount = filtered.filter((i) => selectedIds.has(i.id)).length;
                        el.indeterminate = visibleSelectedCount > 0 && visibleSelectedCount < filtered.length;
                      }
                    }}
                    onChange={() => toggleSelectAll(filtered.map((i) => i.id))}
                  />
                </Th>
                <Th>Status</Th>
                <Th>Invoice</Th>
                {isAdmin && <Th>Supplier</Th>}
                <Th>Customer</Th>
                <Th align="right">Amount</Th>
                <Th>Received</Th>
                <Th>DMS</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={isAdmin ? 9 : 8} className="px-4 py-16 text-center">
                    <div className="inline-flex flex-col items-center gap-2">
                      <BrandedSpinner size="md" />
                      <span className="text-sm text-zinc-500">Loading invoices…</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 9 : 8} className="px-4 py-16 text-center">
                    <p className="text-sm font-medium text-zinc-700">
                      {searchQuery || statusFilter !== 'all'
                        ? 'No invoices match your filters'
                        : 'No invoices yet'}
                    </p>
                    <p className="text-xs text-zinc-500 max-w-md mx-auto mt-1.5">
                      {searchQuery || statusFilter !== 'all'
                        ? 'Try clearing filters or expanding your search.'
                        : 'Invoices will appear here as suppliers email them in, or upload one manually.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((inv) => {
                  const data = inv.invoice_data as Record<string, unknown>;
                  const isSelected = selectedIds.has(inv.id);
                  return (
                    <tr
                      key={inv.id}
                      className={`group border-b last:border-b-0 border-line hover:bg-paper transition-colors cursor-pointer ${
                        isSelected ? 'bg-blue-50/40' : ''
                      }`}
                      onClick={() => openInvoice(inv.id)}
                    >
                      <Td onClick={(e) => e.stopPropagation()}>
                        {/* Row checkbox — stopPropagation so click doesn't open the review */}
                        <input
                          type="checkbox"
                          aria-label={`Select invoice ${inv.file_name}`}
                          className="cursor-pointer accent-ink"
                          checked={isSelected}
                          onChange={() => toggleSelect(inv.id)}
                        />
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <Pill
                            variant={variantFor(inv.status)}
                            pulse={inv.status === 'processing'}
                          >
                            {labelFor(inv.status)}
                          </Pill>
                          {hasBlockingFindings(inv) && (
                            <span
                              title={`${blockingFindingCount(inv)} validation error${
                                blockingFindingCount(inv) === 1 ? '' : 's'
                              } — blocks submission`}
                              className="inline-flex"
                            >
                              <AlertTriangle size={14} className="text-danger" aria-hidden />
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="h-5 w-5 rounded bg-zinc-100 text-zinc-700 inline-flex items-center justify-center text-[11px] shrink-0">
                            {inv.source === 'email' ? '✉' : '⤓'}
                          </span>
                          <div className="min-w-0">
                            <div className="font-mono-num font-semibold text-[13px] text-ink truncate">
                              {(data?.InvoiceNumber as string) || '—'}
                            </div>
                            <div className="text-[11px] font-mono text-zinc-500 truncate">
                              {inv.file_name}
                            </div>
                          </div>
                        </div>
                      </Td>
                      {isAdmin && (
                        <Td className="text-zinc-700">
                          {inv.supplier?.name ?? <span className="text-zinc-400">—</span>}
                        </Td>
                      )}
                      <Td className="text-zinc-700">
                        {(data?.CustomerName as string) ||
                          (data?.BillToName as string) || (
                            <span className="text-zinc-400">—</span>
                          )}
                      </Td>
                      <Td align="right" className="font-num font-semibold text-ink">
                        {data?.InvoiceTotal
                          ? `$${Number(data.InvoiceTotal).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}`
                          : <span className="text-zinc-400 font-normal">—</span>}
                      </Td>
                      <Td className="text-zinc-500 font-mono text-[12px]">
                        {formatDate(inv.created_at)}
                      </Td>
                      <Td className="font-mono text-[12px]">
                        {inv.status === 'submitted' ? (
                          <span className="text-success">DMS sent</span>
                        ) : inv.status === 'processed' ? (
                          <span className="text-zinc-700">ready</span>
                        ) : inv.status === 'rejected' ? (
                          <span className="text-danger">rejected</span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </Td>
                      <Td align="right">
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <Button variant="secondary" size="sm">
                            {actionFor(inv.status)}
                          </Button>
                        </span>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-line bg-paper text-xs text-zinc-500">
            <span>
              <span className="font-num">{filtered.length}</span> of{' '}
              <span className="font-num">{counts.total}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Full-screen invoice review — overlay driven by /invoices/:id.
          Closing the overlay navigates back to /invoices and preserves
          existing query params (status filter, supplier scope). */}
      {selectedInvoice && (
        <InvoiceReview
          invoice={selectedInvoice}
          role={role}
          onClose={closeInvoice}
          onChanged={fetchInvoices}
        />
      )}

      {/* Upload modal */}
      {showUpload && (
        <InvoiceUpload
          onClose={() => setShowUpload(false)}
          onUploadComplete={() => {
            setShowUpload(false);
            fetchInvoices();
          }}
        />
      )}
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function Th({
  children,
  align = 'left',
  className = '',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      className={`text-${align} text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.06em] px-4 py-2.5 whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  className = '',
  onClick,
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void;
}) {
  return (
    <td
      className={`text-${align} text-[13px] px-4 py-3 align-middle ${className}`}
      onClick={onClick}
    >
      {children}
    </td>
  );
}

// Pull validation findings off an invoice safely (column is JSONB, can be null).
function findings(inv: Invoice): Array<{ severity?: string }> {
  const raw = (inv as unknown as { validation_findings?: unknown }).validation_findings;
  return Array.isArray(raw) ? (raw as Array<{ severity?: string }>) : [];
}
function hasBlockingFindings(inv: Invoice): boolean {
  return findings(inv).some((f) => f.severity === 'error');
}
function blockingFindingCount(inv: Invoice): number {
  return findings(inv).filter((f) => f.severity === 'error').length;
}

// All three of these used to be locally-defined maps; they now defer
// to the canonical maps in types/invoice.ts. Kept as wrapper functions
// so existing call sites (and JSX templates) don't need to change.
function variantFor(status: InvoiceStatus): PillProps['variant'] {
  return STATUS_VARIANTS[status] as PillProps['variant'];
}

function labelFor(status: InvoiceStatus): string {
  return STATUS_LABELS[status];
}

function actionFor(status: InvoiceStatus): string {
  return STATUS_ACTIONS[status];
}

function pct(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const ms = now.getTime() - d.getTime();
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function countByStatus(invoices: Invoice[]) {
  let total = 0;
  let processing = 0;
  let pending = 0;
  let processed = 0;
  let submitted = 0;
  let rejected = 0;
  for (const inv of invoices) {
    total++;
    if (inv.status === 'processing') processing++;
    else if (inv.status === 'pending') pending++;
    else if (inv.status === 'processed') processed++;
    else if (inv.status === 'submitted') submitted++;
    else if (inv.status === 'rejected') rejected++;
  }
  return { total, processing, pending, processed, submitted, rejected };
}

function buildTrends(invoices: Invoice[]) {
  const days = 30;
  const buckets = {
    total: new Array(days).fill(0),
    processed: new Array(days).fill(0),
    submitted: new Array(days).fill(0),
    pending: new Array(days).fill(0),
    rejected: new Array(days).fill(0),
  };
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const inv of invoices) {
    const created = new Date(inv.created_at);
    const ms =
      todayStart.getTime() -
      new Date(created.getFullYear(), created.getMonth(), created.getDate()).getTime();
    const dayIdx = days - 1 - Math.floor(ms / 86400000);
    if (dayIdx < 0 || dayIdx >= days) continue;
    buckets.total[dayIdx]++;
    if (inv.status === 'processed') buckets.processed[dayIdx]++;
    if (inv.status === 'submitted') buckets.submitted[dayIdx]++;
    if (inv.status === 'pending') buckets.pending[dayIdx]++;
    if (inv.status === 'rejected') buckets.rejected[dayIdx]++;
  }
  const cumulative = (arr: number[]) => {
    let acc = 0;
    return arr.map((n) => (acc += n));
  };
  return {
    total: cumulative(buckets.total),
    processed: cumulative(buckets.processed),
    submitted: cumulative(buckets.submitted),
    pending: cumulative(buckets.pending),
    rejected: cumulative(buckets.rejected),
  };
}
