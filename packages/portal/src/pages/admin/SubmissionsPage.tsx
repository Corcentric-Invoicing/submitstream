import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Pill, type PillProps } from '@/components/ui/pill';
import { Segmented } from '@/components/ui/segmented';
import { BrandedSpinner } from '@/components/ui/branded-spinner';
import { RefreshCw, X, AlertTriangle, Code2, RotateCw } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Submissions page — real DMS submission history.
 *
 * Backed by GET /api/corcentric-submissions which returns:
 *   { submissions: [...], total, limit, offset }
 *
 * Each row carries: id, invoice_id, attempt, submission_status,
 * cor_status_code, doc_id, error_message, request_xml, response_xml,
 * cor_reason_codes, submitted_at, completed_at, is_dry_run.
 *
 * Click a row → drawer with full request/response, retry button on
 * failed rows.
 */

interface Submission {
  id: string;
  invoice_id: string;
  attempt: number;
  submission_status: 'pending' | 'submitted' | 'success' | 'denied' | 'failed' | 'invalid' | 'retry' | string;
  cor_status_code: number | null;
  doc_id: string | null;
  error_message: string | null;
  request_xml: string | null;
  response_xml: string | null;
  cor_reason_codes: string[] | null;
  submitted_at: string | null;
  completed_at: string | null;
  is_dry_run: boolean;
  created_at: string;
  // Joined fields (we'll resolve client-side)
  invoice?: { invoice_number?: string; file_name?: string; supplier_id?: string };
  supplier?: { name?: string; code?: string };
}

interface PageProps {
  role: 'admin' | 'team' | 'supplier';
  userId: string;
  userEmail: string | undefined;
}

type StatusFilter = 'all' | 'success' | 'failed' | 'pending';

const PAGE_LIMIT = 50;

export default function SubmissionsPage({ role, userId, userEmail }: PageProps) {
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<Submission | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useEffect(() => {
    fetchSubmissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

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

  async function fetchSubmissions() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      // Map our coarse filter to backend statuses
      if (filter === 'success') params.set('status', 'success');
      else if (filter === 'failed') params.set('status', 'failed');
      else if (filter === 'pending') params.set('status', 'pending');
      const res = await authFetch(`/api/corcentric-submissions?${params.toString()}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      const list: Submission[] = body?.submissions ?? body?.data ?? [];
      setSubmissions(list);
      setTotal(body?.total ?? list.length);

      // Best-effort hydrate: invoice_number + supplier name (1 query each)
      const invIds = Array.from(new Set(list.map((s) => s.invoice_id))).filter(Boolean);
      if (invIds.length > 0) {
        const { data: invs } = await supabase
          .from('invoices')
          .select('id, invoice_data, file_name, supplier:suppliers(name, code)')
          .in('id', invIds);
        if (invs) {
          const byId = new Map(
            (invs as Array<{
              id: string;
              invoice_data: Record<string, unknown>;
              file_name: string;
              supplier: { name?: string; code?: string } | null;
            }>).map((x) => [
              x.id,
              {
                invoice_number: (x.invoice_data?.InvoiceNumber as string) ?? '',
                file_name: x.file_name,
                supplier: x.supplier ?? undefined,
              },
            ])
          );
          setSubmissions((prev) =>
            prev.map((s) => {
              const hit = byId.get(s.invoice_id);
              return hit
                ? { ...s, invoice: { invoice_number: hit.invoice_number, file_name: hit.file_name }, supplier: hit.supplier }
                : s;
            })
          );
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleRetry(s: Submission) {
    setRetryingId(s.id);
    try {
      const res = await authFetch(`/api/invoices/${s.invoice_id}/corcentric-retry`, {
        method: 'POST',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        window.alert(body?.error || `Retry failed: HTTP ${res.status}`);
        return;
      }
      await fetchSubmissions();
    } finally {
      setRetryingId(null);
    }
  }

  const counts = useMemo(() => {
    let success = 0;
    let failed = 0;
    let pending = 0;
    for (const s of submissions) {
      const isSuccess = s.cor_status_code != null && s.cor_status_code >= 200 && s.cor_status_code < 300;
      const isFailed = ['denied', 'failed', 'invalid'].includes(s.submission_status);
      if (isSuccess) success++;
      else if (isFailed) failed++;
      else pending++;
    }
    return { success, failed, pending, total };
  }, [submissions, total]);

  return (
    <AppShell
      role={role}
      userId={userId}
      userEmail={userEmail}
      breadcrumb="Submissions"
    >
      <div className="px-7 py-7 max-w-[1280px] mx-auto space-y-5">
        <div className="flex items-end gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Submissions</h1>
            <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
              Every Corcentric DMS submission, ordered newest-first. Click any
              row to inspect the full request and response payloads. Retry
              failed submissions in place.
            </p>
          </div>
          <div className="ml-auto">
            <Button variant="secondary" size="md" onClick={fetchSubmissions} disabled={loading}>
              <RefreshCw size={13} aria-hidden className={loading ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Segmented>
            <Segmented.Item active={filter === 'all'} onClick={() => setFilter('all')}>
              All <Segmented.Count>{counts.total}</Segmented.Count>
            </Segmented.Item>
            <Segmented.Item
              active={filter === 'success'}
              onClick={() => setFilter('success')}
            >
              Success <Segmented.Count>{counts.success}</Segmented.Count>
            </Segmented.Item>
            <Segmented.Item
              active={filter === 'failed'}
              onClick={() => setFilter('failed')}
            >
              Failed <Segmented.Count>{counts.failed}</Segmented.Count>
            </Segmented.Item>
            <Segmented.Item
              active={filter === 'pending'}
              onClick={() => setFilter('pending')}
            >
              Pending <Segmented.Count>{counts.pending}</Segmented.Count>
            </Segmented.Item>
          </Segmented>
        </div>

        {error && (
          <div className="bg-danger-soft border border-danger/20 rounded-card px-3 py-2.5 text-xs text-danger">
            {error}
          </div>
        )}

        <div className="bg-white border border-line rounded-card shadow-1 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-paper border-b border-line">
                <Th>Status</Th>
                <Th>Invoice</Th>
                <Th>Supplier</Th>
                <Th>Attempt</Th>
                <Th>HTTP / Reason</Th>
                <Th>Doc ID</Th>
                <Th>Submitted</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="inline-flex flex-col items-center gap-2">
                      <BrandedSpinner size="md" />
                      <span className="text-sm text-zinc-500">Loading submissions…</span>
                    </div>
                  </td>
                </tr>
              ) : submissions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <p className="text-sm text-zinc-500">
                      No submissions yet. They'll appear here once invoices are submitted to the DMS.
                    </p>
                  </td>
                </tr>
              ) : (
                submissions.map((s) => {
                  const variant = pillForStatus(s);
                  return (
                    <tr
                      key={s.id}
                      className="group border-b last:border-b-0 border-line hover:bg-paper transition-colors cursor-pointer"
                      onClick={() => setSelected(s)}
                    >
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <Pill variant={variant.variant}>{variant.label}</Pill>
                          {s.is_dry_run && (
                            <Pill variant="neutral" hideDot className="text-[10px]">
                              Dry
                            </Pill>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <div className="font-mono-num font-semibold text-[13px] text-ink">
                          {s.invoice?.invoice_number || (
                            <span className="text-zinc-400">—</span>
                          )}
                        </div>
                        {s.invoice?.file_name && (
                          <div className="text-[11px] font-mono text-zinc-500 truncate max-w-[220px]">
                            {s.invoice.file_name}
                          </div>
                        )}
                      </Td>
                      <Td className="text-zinc-700 text-[12px]">
                        {s.supplier?.name ?? <span className="text-zinc-400">—</span>}
                      </Td>
                      <Td className="font-num text-zinc-700">{s.attempt ?? 1}</Td>
                      <Td className="font-mono text-[12px] text-zinc-700">
                        {s.cor_status_code != null ? (
                          <span className={cn(
                            'font-semibold',
                            s.cor_status_code >= 200 && s.cor_status_code < 300
                              ? 'text-success'
                              : 'text-danger'
                          )}>
                            {s.cor_status_code}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                        {s.cor_reason_codes && s.cor_reason_codes.length > 0 && (
                          <div className="text-[11px] text-danger/85 mt-0.5 truncate max-w-[180px]">
                            {s.cor_reason_codes[0]}
                          </div>
                        )}
                      </Td>
                      <Td className="font-mono text-[12px] text-zinc-700">
                        {s.doc_id || <span className="text-zinc-400">—</span>}
                      </Td>
                      <Td className="text-zinc-500 font-mono text-[12px]">
                        {formatRelative(s.submitted_at || s.created_at)}
                      </Td>
                      <Td align="right">
                        <span
                          className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {(variant.label === 'Failed' || variant.label === 'Denied') && (
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={retryingId === s.id}
                              onClick={() => handleRetry(s)}
                            >
                              <RotateCw size={11} aria-hidden />
                              {retryingId === s.id ? 'Retrying…' : 'Retry'}
                            </Button>
                          )}
                          <Button variant="secondary" size="sm" onClick={() => setSelected(s)}>
                            <Code2 size={11} aria-hidden />
                            Inspect
                          </Button>
                        </span>
                      </Td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <SubmissionDrawer
          submission={selected}
          onClose={() => setSelected(null)}
          onRetry={() => handleRetry(selected)}
          retrying={retryingId === selected.id}
        />
      )}
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────
// Drawer
// ──────────────────────────────────────────────────────────

function SubmissionDrawer({
  submission: s,
  onClose,
  onRetry,
  retrying,
}: {
  submission: Submission;
  onClose: () => void;
  onRetry: () => void;
  retrying: boolean;
}) {
  const variant = pillForStatus(s);
  const isFailed = variant.label === 'Failed' || variant.label === 'Denied';
  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 bg-ink/30 backdrop-blur-[2px]"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl bg-white shadow-2 overflow-y-auto border-l border-line">
        <div className="sticky top-0 bg-white border-b border-line px-5 py-3.5 flex items-center justify-between z-10">
          <div className="flex items-center gap-2.5">
            <h2 className="text-base font-semibold text-ink">Submission detail</h2>
            <Pill variant={variant.variant}>{variant.label}</Pill>
            {s.is_dry_run && (
              <Pill variant="neutral" hideDot className="text-[10px]">
                Dry run
              </Pill>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isFailed && (
              <Button variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>
                <RotateCw size={11} aria-hidden />
                {retrying ? 'Retrying…' : 'Retry'}
              </Button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-zinc-500 hover:text-ink p-1 -m-1"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-5">
          <DetailGrid
            rows={[
              ['Invoice', s.invoice?.invoice_number ?? s.invoice_id],
              ['File', s.invoice?.file_name ?? '—'],
              ['Supplier', s.supplier?.name ?? '—'],
              ['Attempt', String(s.attempt ?? 1)],
              ['HTTP', s.cor_status_code != null ? String(s.cor_status_code) : '—'],
              ['Doc ID', s.doc_id ?? '—'],
              ['Submitted', formatFull(s.submitted_at || s.created_at)],
              ['Completed', formatFull(s.completed_at)],
            ]}
          />

          {s.error_message && (
            <Section heading="Error message" tone="danger">
              <pre className="whitespace-pre-wrap font-mono text-[12px] text-zinc-800 leading-relaxed">
                {s.error_message}
              </pre>
            </Section>
          )}

          {s.cor_reason_codes && s.cor_reason_codes.length > 0 && (
            <Section heading="Corcentric reason codes" tone="danger">
              <ul className="space-y-1">
                {s.cor_reason_codes.map((r, i) => (
                  <li
                    key={i}
                    className="font-mono text-[12px] text-zinc-800 flex items-start gap-2"
                  >
                    <AlertTriangle size={12} className="text-danger shrink-0 mt-0.5" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {s.request_xml && (
            <Section heading="Request XML" defaultOpen={false}>
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-zinc-800 leading-relaxed bg-paper border border-line rounded-control p-3 max-h-96 overflow-auto">
                {s.request_xml}
              </pre>
            </Section>
          )}

          {s.response_xml && (
            <Section heading="Response XML" defaultOpen={false}>
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-zinc-800 leading-relaxed bg-paper border border-line rounded-control p-3 max-h-96 overflow-auto">
                {s.response_xml}
              </pre>
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function pillForStatus(s: Submission): {
  variant: PillProps['variant'];
  label: string;
} {
  const code = s.cor_status_code;
  if (code != null && code >= 200 && code < 300) {
    return { variant: 'submitted', label: 'Success' };
  }
  if (s.submission_status === 'denied') return { variant: 'rejected', label: 'Denied' };
  if (s.submission_status === 'failed' || s.submission_status === 'invalid') {
    return { variant: 'rejected', label: 'Failed' };
  }
  if (s.submission_status === 'retry') return { variant: 'review', label: 'Retry' };
  if (s.submission_status === 'pending' || s.submission_status === 'submitted') {
    return { variant: 'ocr', label: 'Pending' };
  }
  return { variant: 'neutral', label: s.submission_status };
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

function DetailGrid({ rows }: { rows: [string, string | number][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-2 bg-paper border border-line rounded-control p-3">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[10px] uppercase tracking-[0.06em] font-semibold text-zinc-500">
            {label}
          </dt>
          <dd className="text-[13px] text-ink font-mono mt-0.5 truncate" title={String(value)}>
            {String(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Section({
  heading,
  tone,
  defaultOpen = true,
  children,
}: {
  heading: string;
  tone?: 'danger';
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className={cn(
        'group rounded-card overflow-hidden border',
        tone === 'danger'
          ? 'bg-danger-soft border-danger/20'
          : 'bg-white border-line'
      )}
    >
      <summary
        className={cn(
          'cursor-pointer px-3 py-2 text-[12px] font-semibold flex items-center gap-1.5',
          tone === 'danger' ? 'text-danger' : 'text-ink'
        )}
      >
        <span className="opacity-60 group-open:rotate-90 inline-block transition-transform">
          ›
        </span>
        {heading}
      </summary>
      <div
        className={cn(
          'px-3 py-2.5 border-t',
          tone === 'danger' ? 'border-danger/15' : 'border-line'
        )}
      >
        {children}
      </div>
    </details>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatFull(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' · ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  );
}
