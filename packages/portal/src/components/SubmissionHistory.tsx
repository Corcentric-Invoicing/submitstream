import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  ChevronDown,
  ChevronRight,
  Check,
  AlertTriangle,
  Clock,
  FileText,
  TestTube,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * SubmissionHistory — collapsible per-invoice log of every Corcentric
 * submission attempt.
 *
 * Reads `corcentric_submissions` directly via supabase client. The table's
 * RLS is open SELECT (qual: true) for authenticated users; service-role
 * inserts/updates from the worker, the UI just reads.
 *
 * Each row shows: timestamp, status (color-coded), attempt #, dry-run
 * flag, Corcentric response ID. Click to expand for the error message
 * and a truncated response XML preview.
 *
 * Empty state still renders so the user sees the section exists; previously
 * the indicator silently disappeared when there was no data, which made
 * the whole "DMS history" feature look like it was missing.
 */

interface SubmissionRow {
  id: string;
  invoice_id: string;
  status: string;
  cor_status_code: number | null;
  cor_response_id: string | null;
  cor_messages: unknown;
  attempt_number: number;
  is_dry_run: boolean;
  submitted_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  response_xml: string | null;
  created_at: string;
}

interface SubmissionHistoryProps {
  invoiceId: string;
  /** Bump to force a reload — e.g. after Submit fires. */
  reloadKey?: number | string;
}

export function SubmissionHistory({ invoiceId, reloadKey }: SubmissionHistoryProps) {
  const [rows, setRows] = useState<SubmissionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await supabase
        .from('corcentric_submissions')
        .select(
          'id, invoice_id, status, cor_status_code, cor_response_id, cor_messages, attempt_number, is_dry_run, submitted_at, completed_at, error_message, response_xml, created_at',
        )
        .eq('invoice_id', invoiceId)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setRows([]);
      } else {
        setRows((data as SubmissionRow[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [invoiceId, reloadKey]);

  const count = rows.length;
  const lastSuccess = rows.find((r) => r.status === 'success' && !r.is_dry_run);

  return (
    <div className="bg-paper border border-line rounded-card overflow-hidden">
      {/* Header (always visible, click to toggle) */}
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-zinc-50 transition-colors"
      >
        {collapsed ? (
          <ChevronRight size={14} className="text-zinc-500 shrink-0" />
        ) : (
          <ChevronDown size={14} className="text-zinc-500 shrink-0" />
        )}
        <FileText size={13} className="text-zinc-500 shrink-0" />
        <strong className="text-ink text-xs flex-shrink-0">DMS history</strong>
        <span className="text-zinc-500 text-[11px] truncate">
          {loading
            ? '· loading…'
            : count === 0
              ? '· no submissions yet'
              : `· ${count} attempt${count === 1 ? '' : 's'}${
                  lastSuccess ? ' · last success ' + relTime(lastSuccess.completed_at ?? lastSuccess.created_at) : ''
                }`}
        </span>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="border-t border-line">
          {error && (
            <div className="px-3 py-2 text-xs text-danger bg-danger-soft">
              Failed to load history: {error}
            </div>
          )}
          {!loading && !error && rows.length === 0 && (
            <div className="px-3 py-3 text-[12px] text-zinc-500 italic">
              No Corcentric submissions recorded for this invoice yet. Hit
              Submit on the DMS bar to send one.
            </div>
          )}
          {rows.length > 0 && (
            <ul className="divide-y divide-line">
              {rows.map((r) => {
                const isExpanded = expandedRowId === r.id;
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => setExpandedRowId(isExpanded ? null : r.id)}
                      className="w-full text-left px-3 py-2 hover:bg-zinc-50 transition-colors flex items-center gap-3"
                    >
                      <StatusIcon status={r.status} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-medium text-ink">
                            {labelForStatus(r.status)}
                          </span>
                          {r.cor_status_code !== null && (
                            <span
                              className={cn(
                                'text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold',
                                badgeClassForHttp(r.cor_status_code),
                              )}
                              title="Corcentric HTTP status"
                            >
                              {r.cor_status_code}
                            </span>
                          )}
                          {r.is_dry_run && (
                            <span
                              className="text-[10px] uppercase tracking-[0.06em] font-semibold bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                              title="Dry run — not submitted live"
                            >
                              <TestTube size={9} /> dry run
                            </span>
                          )}
                          <span className="text-[11px] text-zinc-500">
                            attempt #{r.attempt_number}
                          </span>
                        </div>
                        <div className="text-[11px] text-zinc-500 mt-0.5 flex items-center gap-2 flex-wrap">
                          <Clock size={10} aria-hidden />
                          <span>{relTime(r.completed_at ?? r.submitted_at ?? r.created_at) ?? 'recently'}</span>
                          {r.cor_response_id && (
                            <span className="font-mono truncate" title="Corcentric response ID">
                              · {r.cor_response_id}
                            </span>
                          )}
                        </div>
                      </div>
                      {isExpanded ? (
                        <ChevronDown size={12} className="text-zinc-400 shrink-0" />
                      ) : (
                        <ChevronRight size={12} className="text-zinc-400 shrink-0" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="px-3 pb-3 pt-1 bg-zinc-50/50 space-y-2">
                        {r.error_message && (
                          <div className="text-[11px]">
                            <div className="font-semibold text-zinc-500 uppercase tracking-[0.06em] mb-1">
                              Error
                            </div>
                            <div className="text-danger whitespace-pre-wrap break-words">
                              {r.error_message}
                            </div>
                          </div>
                        )}
                        {Array.isArray(r.cor_messages) && r.cor_messages.length > 0 && (
                          <div className="text-[11px]">
                            <div className="font-semibold text-zinc-500 uppercase tracking-[0.06em] mb-1">
                              Corcentric messages
                            </div>
                            <ul className="text-zinc-700 space-y-0.5">
                              {(r.cor_messages as Array<Record<string, unknown>>).map((m, i) => (
                                <li key={i} className="font-mono break-words">
                                  {JSON.stringify(m)}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {r.response_xml && (
                          <details className="text-[11px]">
                            <summary className="cursor-pointer font-semibold text-zinc-500 uppercase tracking-[0.06em] hover:text-ink">
                              Response XML ({Math.round((r.response_xml.length / 1024) * 10) / 10} KB)
                            </summary>
                            <pre className="mt-1 bg-white border border-line rounded-control p-2 overflow-x-auto max-h-[200px] text-[10px] font-mono text-zinc-700">
                              {truncate(r.response_xml, 4000)}
                            </pre>
                          </details>
                        )}
                        {!r.error_message &&
                          !(Array.isArray(r.cor_messages) && r.cor_messages.length) &&
                          !r.response_xml && (
                            <div className="text-[11px] text-zinc-400 italic">
                              No additional details recorded for this attempt.
                            </div>
                          )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  if (status === 'success') {
    return <Check size={13} className="text-success shrink-0" aria-label="success" />;
  }
  if (status === 'failed' || status === 'invalid') {
    return <AlertTriangle size={13} className="text-danger shrink-0" aria-label="failed" />;
  }
  // pending / submitted / unknown
  return <Clock size={13} className="text-warning shrink-0" aria-label="pending" />;
}

function labelForStatus(status: string): string {
  switch (status) {
    case 'success':
      return 'Submitted';
    case 'failed':
      return 'Failed';
    case 'invalid':
      return 'Validation failed';
    case 'pending':
      return 'Pending';
    case 'submitted':
      return 'Sent';
    default:
      return status || 'Unknown';
  }
}

function badgeClassForHttp(code: number): string {
  if (code >= 200 && code < 300) return 'bg-success/10 text-success';
  if (code >= 400 && code < 500) return 'bg-warning/10 text-warning';
  if (code >= 500) return 'bg-danger/10 text-danger';
  return 'bg-zinc-100 text-zinc-600';
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n… [truncated, ${s.length - max} more chars]`;
}

function relTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}
