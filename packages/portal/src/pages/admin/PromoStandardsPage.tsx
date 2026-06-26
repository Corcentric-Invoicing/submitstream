import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import type { Invoice, InvoiceStatus } from '../../types/invoice';
import { STATUS_LABELS, STATUS_VARIANTS } from '../../types/invoice';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Segmented } from '@/components/ui/segmented';
import { Download, RefreshCw, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import InvoiceReview from '../InvoiceReview';
import { AppShell } from '@/components/AppShell';

/**
 * PromoStandards admin (Wave 6b, v1 scope).
 *
 * API contracts (unchanged from promostandards-admin-inject):
 *   GET  /api/promostandards/health           per-supplier connection state
 *   POST /api/promostandards/pull/:supplierId trigger an on-demand pull
 *   GET  /api/invoices?ingestion_source=promostandards&...
 *
 * v1 scope: connection-health cards + queue table scoped to PromoStandards-
 * sourced invoices, filterable by supplier and status. Click a row → opens
 * the same InvoiceReview surface used everywhere else.
 *
 * Out of scope for v1: bulk multi-select on the queue, source/EDI/Corcentric
 * three-panel diff viewer (port post-meeting if needed).
 */

type HealthStatus = 'green' | 'yellow' | 'red' | 'idle';

interface ServiceMessage {
  severity?: 'Information' | 'Warning' | 'Error' | string;
  code?: string;
  description?: string;
}

interface LatestPull {
  pulled_at?: string;
  invoices_pulled?: number;
  invoices_skipped?: number;
  error_message?: string | null;
  service_messages?: ServiceMessage[];
}

interface HealthRow {
  supplier_id: string;
  code: string;
  name: string;
  status: HealthStatus;
  poll_interval_seconds?: number;
  next_pull_at?: string;
  latest_pull?: LatestPull | null;
}

const STATUS_LABEL: Record<HealthStatus, string> = {
  green: 'Healthy',
  yellow: 'Attention',
  red: 'Failing',
  idle: 'Idle',
};

const STATUS_DOT: Record<HealthStatus, string> = {
  green: 'bg-success',
  yellow: 'bg-warning',
  red: 'bg-danger',
  idle: 'bg-zinc-300',
};

type StatusFilter = 'all' | 'pending' | 'processed' | 'rejected';

interface PageProps {
  role: 'admin' | 'team' | 'supplier';
  userId: string;
  userEmail: string | undefined;
}

export default function PromoStandardsPage({ role, userId, userEmail }: PageProps) {
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [pullingId, setPullingId] = useState<string | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    loadQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierFilter, statusFilter]);

  async function authFetch(path: string, init?: RequestInit) {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }

  async function loadAll() {
    await Promise.all([loadHealth(), loadQueue()]);
  }

  async function loadHealth() {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const res = await authFetch('/api/promostandards/health');
      const body = await res.json();
      if (!res.ok) {
        setHealthError(body?.error || `HTTP ${res.status}`);
        return;
      }
      setHealth((body?.data as HealthRow[]) ?? []);
    } catch (err) {
      setHealthError(err instanceof Error ? err.message : String(err));
    } finally {
      setHealthLoading(false);
    }
  }

  async function loadQueue() {
    setQueueLoading(true);
    setQueueError(null);
    try {
      const params = new URLSearchParams({
        ingestion_source: 'promostandards',
        limit: '50',
      });
      if (supplierFilter !== 'all') params.set('supplier_id', supplierFilter);
      if (statusFilter !== 'all') params.set('status', statusFilter);
      const res = await authFetch(`/api/invoices?${params.toString()}`);
      const body = await res.json();
      if (!res.ok) {
        setQueueError(body?.error || `HTTP ${res.status}`);
        return;
      }
      const list: Invoice[] = Array.isArray(body) ? body : body?.data ?? [];
      setInvoices(list);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : String(err));
    } finally {
      setQueueLoading(false);
    }
  }

  async function pullNow(supplierId: string) {
    setPullingId(supplierId);
    try {
      const res = await authFetch(`/api/promostandards/pull/${supplierId}`, {
        method: 'POST',
        body: '{}',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(body?.error || `Pull failed: HTTP ${res.status}`);
        return;
      }
      // Refresh both panels — health updates, new invoices may have come in.
      await loadAll();
    } finally {
      setPullingId(null);
    }
  }

  const counts = useMemo(() => {
    let total = 0;
    let pending = 0;
    let processed = 0;
    let rejected = 0;
    for (const inv of invoices) {
      total++;
      if (inv.status === 'pending') pending++;
      else if (inv.status === 'processed') processed++;
      else if (inv.status === 'rejected') rejected++;
    }
    return { total, pending, processed, rejected };
  }, [invoices]);

  return (
    <AppShell role={role} userId={userId} userEmail={userEmail} breadcrumb="PromoStandards">
    <div className="px-7 py-7 max-w-[1280px] mx-auto space-y-6">
      {/* ── Page head ── */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">PromoStandards</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-prose">
          Per-supplier connection health for the PromoStandards Invoice spec
          and the queue of invoices pulled in via that integration. Click a
          supplier card to pull now; click a queue row to review.
        </p>
      </div>

      {/* ── Connection health cards ── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-[0.06em]">
            Connection health
          </h2>
          <Button variant="secondary" size="sm" onClick={loadHealth} disabled={healthLoading}>
            <RefreshCw size={12} aria-hidden className={healthLoading ? 'animate-spin' : ''} />
            Refresh
          </Button>
        </div>

        {healthError && (
          <div className="bg-danger-soft border border-danger/20 rounded-card px-3 py-2.5 text-xs text-danger mb-3">
            {healthError}
          </div>
        )}

        {healthLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="bg-white border border-line rounded-card shadow-1 p-4 h-32 animate-pulse"
              />
            ))}
          </div>
        ) : health.length === 0 ? (
          <div className="bg-white border border-line rounded-card shadow-1 p-6 text-center">
            <p className="text-sm text-zinc-500">
              No suppliers have PromoStandards ingestion enabled yet. Enable it
              from the Suppliers tab.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {health.map((s) => (
              <HealthCard
                key={s.supplier_id}
                row={s}
                onPullNow={() => pullNow(s.supplier_id)}
                pulling={pullingId === s.supplier_id}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Queue ── */}
      <section>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <h2 className="text-sm font-semibold text-zinc-700 uppercase tracking-[0.06em]">
            Pulled queue
          </h2>
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={supplierFilter}
              onChange={(e) => setSupplierFilter(e.target.value)}
              className="h-8 pl-2.5 pr-8 bg-white border border-line-2 rounded-control text-[13px] text-ink shadow-1 focus:border-brand focus:shadow-ring-brand outline-none"
            >
              <option value="all">All suppliers</option>
              {health.map((s) => (
                <option key={s.supplier_id} value={s.supplier_id}>
                  {s.name}
                </option>
              ))}
            </select>
            <Segmented>
              <Segmented.Item active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
                All <Segmented.Count>{counts.total}</Segmented.Count>
              </Segmented.Item>
              <Segmented.Item
                active={statusFilter === 'pending'}
                onClick={() => setStatusFilter('pending')}
              >
                Review <Segmented.Count>{counts.pending}</Segmented.Count>
              </Segmented.Item>
              <Segmented.Item
                active={statusFilter === 'processed'}
                onClick={() => setStatusFilter('processed')}
              >
                Submitted <Segmented.Count>{counts.processed}</Segmented.Count>
              </Segmented.Item>
              <Segmented.Item
                active={statusFilter === 'rejected'}
                onClick={() => setStatusFilter('rejected')}
              >
                Rejected <Segmented.Count>{counts.rejected}</Segmented.Count>
              </Segmented.Item>
            </Segmented>
          </div>
        </div>

        {queueError && (
          <div className="bg-danger-soft border border-danger/20 rounded-card px-3 py-2.5 text-xs text-danger mb-3">
            {queueError}
          </div>
        )}

        <div className="bg-white border border-line rounded-card shadow-1 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-paper border-b border-line">
                <Th>Status</Th>
                <Th>Invoice</Th>
                <Th>Supplier</Th>
                <Th align="right">Amount</Th>
                <Th>Pulled</Th>
              </tr>
            </thead>
            <tbody>
              {queueLoading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <div className="inline-flex items-center gap-2 text-sm text-zinc-500">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-zinc-200 border-t-ink" />
                      Loading queue…
                    </div>
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-12 text-center">
                    <p className="text-sm text-zinc-500">
                      {supplierFilter === 'all' && statusFilter === 'all'
                        ? 'No PromoStandards invoices yet. Trigger a pull on a supplier above.'
                        : 'No invoices match your filters.'}
                    </p>
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => {
                  const data = inv.invoice_data as Record<string, unknown>;
                  return (
                    <tr
                      key={inv.id}
                      className="group border-b last:border-b-0 border-line hover:bg-paper transition-colors cursor-pointer"
                      onClick={() => setSelectedInvoice(inv)}
                    >
                      <Td>
                        <Pill variant={variantFor(inv.status)}>{labelFor(inv.status)}</Pill>
                      </Td>
                      <Td>
                        <div className="font-mono-num font-semibold text-[13px]">
                          {(data?.InvoiceNumber as string) || '—'}
                        </div>
                        <div className="text-[11px] font-mono text-zinc-500">
                          {inv.file_name}
                        </div>
                      </Td>
                      <Td className="text-zinc-700">
                        {inv.supplier?.name ?? <span className="text-zinc-400">—</span>}
                      </Td>
                      <Td align="right" className="font-num font-semibold">
                        {data?.InvoiceTotal
                          ? `$${Number(data.InvoiceTotal).toLocaleString(undefined, {
                              minimumFractionDigits: 2,
                            })}`
                          : <span className="text-zinc-400 font-normal">—</span>}
                      </Td>
                      <Td className="text-zinc-500 font-mono text-[12px]">
                        {relTime(inv.created_at)}
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedInvoice && (
        <InvoiceReview
          invoice={selectedInvoice}
          role="admin"
          onClose={() => setSelectedInvoice(null)}
          onChanged={loadAll}
        />
      )}
    </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────
// Sub-components & helpers
// ──────────────────────────────────────────────────────────

function HealthCard({
  row,
  onPullNow,
  pulling,
}: {
  row: HealthRow;
  onPullNow: () => void;
  pulling: boolean;
}) {
  const statusLabel = STATUS_LABEL[row.status];
  const dot = STATUS_DOT[row.status];
  const latest = row.latest_pull;
  const messages = (latest?.service_messages ?? []).slice(0, 2);

  return (
    <div className="bg-white border border-line rounded-card shadow-1 p-4 flex flex-col gap-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <span
            aria-hidden
            className={cn('h-2.5 w-2.5 rounded-full shrink-0 mt-1', dot)}
            title={statusLabel}
          />
          <div className="min-w-0">
            <div className="font-semibold text-ink text-[15px] truncate">{row.name}</div>
            <div className="text-[11px] uppercase tracking-[0.05em] text-zinc-500 mt-0.5">
              {row.code} · {statusLabel}
            </div>
          </div>
        </div>
        <Button variant="secondary" size="sm" disabled={pulling} onClick={onPullNow}>
          {pulling ? 'Pulling…' : 'Pull now'}
        </Button>
      </div>

      <div className="flex items-baseline justify-between text-[12px] text-zinc-500 border-t border-line pt-2">
        <span>Last pull</span>
        <span className="font-mono text-zinc-700">
          {latest?.pulled_at ? relTime(latest.pulled_at) : '—'}
          {latest && (latest.invoices_pulled ?? 0) > 0 && (
            <span className="text-success ml-1.5">+{latest.invoices_pulled}</span>
          )}
        </span>
      </div>

      <div className="flex items-baseline justify-between text-[12px] text-zinc-500">
        <span>Next pull</span>
        <span className="font-mono text-zinc-700">{nextPullText(row.next_pull_at)}</span>
      </div>

      {/* Most recent error takes priority */}
      {latest?.error_message ? (
        <div className="text-[11px] bg-danger-soft text-danger border border-danger/20 rounded-control px-2.5 py-1.5 flex items-start gap-1.5">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <strong>Error:</strong> {latest.error_message}
          </div>
        </div>
      ) : (
        messages.map((m, i) => {
          const sev = (m.severity || 'Information').toLowerCase();
          const styles =
            sev === 'error'
              ? 'bg-danger-soft text-danger border-danger/20'
              : sev === 'warning'
              ? 'bg-warning-soft text-warning border-warning/20'
              : 'bg-info-soft text-info border-info/20';
          return (
            <div
              key={i}
              className={cn(
                'text-[11px] border rounded-control px-2.5 py-1.5 flex gap-1.5',
                styles
              )}
            >
              <strong className="shrink-0">
                {m.severity || 'Info'} {m.code ?? ''}
              </strong>
              <span className="min-w-0">{m.description}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

function Th({
  children,
  align = 'left',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={`text-${align} text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.06em] px-4 py-2.5 whitespace-nowrap`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  className = '',
}: {
  children?: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <td className={`text-${align} text-[13px] px-4 py-3 align-middle ${className}`}>
      {children}
    </td>
  );
}

// Defers to the canonical maps in types/invoice.ts. This file used to
// have its own copies that drifted — `processed` rendered as
// "Submitted" here but "Ready to submit" everywhere else. Now they
// agree.
function variantFor(status: string): React.ComponentProps<typeof Pill>['variant'] {
  const mapped = STATUS_VARIANTS[status as InvoiceStatus];
  return (mapped as React.ComponentProps<typeof Pill>['variant']) ?? 'neutral';
}

function labelFor(status: string): string {
  return STATUS_LABELS[status as InvoiceStatus] ?? status;
}

function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function nextPullText(iso: string | undefined): string {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'now';
  if (ms < 3_600_000) return `in ${Math.floor(ms / 60_000)}m`;
  if (ms < 86_400_000) return `in ${Math.floor(ms / 3_600_000)}h`;
  return `in ${Math.floor(ms / 86_400_000)}d`;
}
