import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Pill, type PillProps } from '@/components/ui/pill';
import { BrandedSpinner } from '@/components/ui/branded-spinner';
import { RefreshCw, Search, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Activity log — audit trail of every admin/user action.
 *
 * Reads access_audit_log directly via the Supabase client (the table has
 * SELECT-for-admin RLS so only admin/team users can read). Hydrates each
 * row with the actor's email + display name from user_profiles.
 *
 * Filters: action type, actor (search), date range. Click a row → expand
 * inline showing IP, full metadata, target resource link.
 */

interface PageProps {
  role: 'admin' | 'team' | 'supplier';
  userId: string;
  userEmail: string | undefined;
}

interface AuditRow {
  id: string;
  user_id: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  ip_address: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor_email?: string;
  actor_name?: string;
}

const PAGE_SIZE = 100;

const ACTION_LABEL: Record<string, string> = {
  invoice_view: 'Invoice viewed',
  invoice_list: 'Invoice list',
  pdf_download: 'PDF downloaded',
  csv_export: 'CSV exported',
  invoice_update: 'Invoice updated',
};

function variantForAction(action: string): PillProps['variant'] {
  if (action === 'invoice_update') return 'review';
  if (action === 'pdf_download' || action === 'csv_export') return 'submitted';
  if (action === 'invoice_view' || action === 'invoice_list') return 'ocr';
  return 'neutral';
}

export default function ActivityLogPage({ role, userId, userEmail }: PageProps) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionFilter, setActionFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    fetchAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionFilter]);

  async function fetchAudit() {
    setLoading(true);
    setError(null);
    try {
      let query = supabase
        .from('access_audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (actionFilter !== 'all') query = query.eq('action', actionFilter);
      const { data, error: dbErr } = await query;
      if (dbErr) {
        setError(dbErr.message);
        return;
      }
      const list: AuditRow[] = (data as AuditRow[]) ?? [];

      // Hydrate actor info from user_profiles (single roundtrip).
      const userIds = Array.from(new Set(list.map((r) => r.user_id).filter(Boolean))) as string[];
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('user_profiles')
          .select('id, email, display_name')
          .in('id', userIds);
        if (profiles) {
          const byId = new Map(
            (profiles as Array<{ id: string; email: string; display_name: string | null }>).map((p) => [
              p.id,
              { email: p.email, name: p.display_name ?? '' },
            ])
          );
          for (const r of list) {
            if (r.user_id) {
              const hit = byId.get(r.user_id);
              if (hit) {
                r.actor_email = hit.email;
                r.actor_name = hit.name;
              }
            }
          }
        }
      }
      setRows(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return rows;
    const q = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.actor_email?.toLowerCase().includes(q) ||
        r.actor_name?.toLowerCase().includes(q) ||
        r.action.toLowerCase().includes(q) ||
        r.resource_id?.toLowerCase().includes(q) ||
        r.ip_address?.toLowerCase().includes(q)
    );
  }, [rows, search]);

  const actionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r.action, (m.get(r.action) ?? 0) + 1);
    return m;
  }, [rows]);

  return (
    <AppShell
      role={role}
      userId={userId}
      userEmail={userEmail}
      breadcrumb="Activity log"
    >
      <div className="px-7 py-7 max-w-[1280px] mx-auto space-y-5">
        <div className="flex items-end gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Activity log</h1>
            <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
              Audit trail of every action — invoice views, PDF downloads, CSV
              exports, invoice updates. Used for SOC 2 compliance and
              forensic review.
            </p>
          </div>
          <div className="ml-auto">
            <Button variant="secondary" size="md" onClick={fetchAudit} disabled={loading}>
              <RefreshCw size={13} aria-hidden className={loading ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="h-9 pl-2.5 pr-8 bg-white border border-line-2 rounded-control text-[13px] text-ink shadow-1 focus:border-brand focus:shadow-ring-brand outline-none"
          >
            <option value="all">All actions ({rows.length})</option>
            {Array.from(actionCounts.entries()).map(([action, count]) => (
              <option key={action} value={action}>
                {ACTION_LABEL[action] || action} ({count})
              </option>
            ))}
          </select>
          <div className="relative flex-1 max-w-md">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
              aria-hidden
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search actor, action, resource ID, IP…"
              className="w-full h-9 pl-8 pr-3 bg-white border border-line-2 rounded-control text-[13px] text-ink placeholder:text-zinc-400 outline-none shadow-1 focus:border-brand focus:shadow-ring-brand"
            />
          </div>
        </div>

        {error && (
          <div className="bg-danger-soft border border-danger/20 rounded-card px-3 py-2.5 text-xs text-danger flex items-start gap-2">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
            <div>
              <div className="font-semibold">Couldn't load audit log</div>
              <div className="mt-0.5">{error}</div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="bg-white border border-line rounded-card shadow-1 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-paper border-b border-line">
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Resource</Th>
                <Th>IP</Th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center">
                    <div className="inline-flex flex-col items-center gap-2">
                      <BrandedSpinner size="md" />
                      <span className="text-sm text-zinc-500">Loading audit log…</span>
                    </div>
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-16 text-center">
                    <p className="text-sm text-zinc-500">
                      {search || actionFilter !== 'all'
                        ? 'No entries match your filters.'
                        : 'No audit entries yet.'}
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const isOpen = expandedId === r.id;
                  return (
                    <>
                      <tr
                        key={r.id}
                        className="group border-b last:border-b-0 border-line hover:bg-paper transition-colors cursor-pointer"
                        onClick={() => setExpandedId(isOpen ? null : r.id)}
                      >
                        <Td className="text-zinc-700 font-mono text-[12px] whitespace-nowrap">
                          {formatRel(r.created_at)}
                        </Td>
                        <Td>
                          <div className="text-ink font-medium">
                            {r.actor_name || (
                              <span className="text-zinc-400 italic">no name</span>
                            )}
                          </div>
                          <div className="text-[11px] font-mono text-zinc-500">
                            {r.actor_email || (
                              <span className="text-zinc-400">unknown</span>
                            )}
                          </div>
                        </Td>
                        <Td>
                          <Pill variant={variantForAction(r.action)}>
                            {ACTION_LABEL[r.action] || r.action}
                          </Pill>
                        </Td>
                        <Td className="font-mono text-[11px] text-zinc-700">
                          {r.resource_type}
                          {r.resource_id ? ` · ${r.resource_id.slice(0, 8)}…` : ''}
                        </Td>
                        <Td className="font-mono text-[11px] text-zinc-500">
                          {r.ip_address || '—'}
                        </Td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-paper">
                          <td colSpan={5} className="px-5 py-3 border-b border-line">
                            <ExpandedDetail row={r} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}

function ExpandedDetail({ row }: { row: AuditRow }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
      <Detail label="Timestamp" value={new Date(row.created_at).toLocaleString()} mono />
      <Detail label="Actor email" value={row.actor_email || '—'} mono />
      <Detail label="Actor user ID" value={row.user_id || '—'} mono />
      <Detail label="IP address" value={row.ip_address || '—'} mono />
      <Detail label="Resource type" value={row.resource_type} mono />
      <Detail label="Resource ID" value={row.resource_id || '—'} mono />
      {row.metadata && Object.keys(row.metadata).length > 0 && (
        <div className="col-span-2">
          <dt className="text-[10px] uppercase tracking-[0.06em] font-semibold text-zinc-500">
            Metadata
          </dt>
          <pre className="mt-1 text-[11px] font-mono bg-white border border-line rounded-control p-2 overflow-auto max-h-48">
            {JSON.stringify(row.metadata, null, 2)}
          </pre>
        </div>
      )}
    </dl>
  );
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.06em] font-semibold text-zinc-500">
        {label}
      </dt>
      <dd className={cn('text-ink mt-0.5 break-all', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return (
    <th className="text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-[0.06em] px-4 py-2.5 whitespace-nowrap">
      {children}
    </th>
  );
}

function Td({
  children,
  className = '',
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <td className={cn('text-[13px] px-4 py-3 align-top', className)}>{children}</td>
  );
}

function formatRel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
