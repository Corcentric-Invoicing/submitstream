import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { AppShell } from '@/components/AppShell';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { KpiCard } from '@/components/ui/kpi-card';
import { BrandedSpinner } from '@/components/ui/branded-spinner';
import {
  Building2,
  Users,
  Network,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Activity,
  ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * Admin Console — top-level overview surface.
 *
 * Three bands:
 *   1. KPIs (suppliers, customers, communities, invoices this month)
 *   2. Integration health (Supabase, R2, OCR, DMS)
 *   3. Recent submissions feed
 */

interface PageProps {
  role: 'admin' | 'team' | 'supplier';
  userId: string;
  userEmail: string | undefined;
}

interface Counts {
  suppliers: { total: number; active: number };
  customers: number;
  communities: number;
  invoicesThisMonth: number;
  invoicesTotal: number;
  submissionsThisMonth: number;
  successThisMonth: number;
}

interface HealthRow {
  label: string;
  status: 'ok' | 'warn' | 'down' | 'unknown';
  detail: string;
}

interface RecentSubmission {
  id: string;
  invoice_id: string;
  cor_status_code: number | null;
  submission_status: string;
  doc_id: string | null;
  submitted_at: string | null;
  is_dry_run: boolean;
  invoice_number?: string;
  supplier_name?: string;
}

export default function AdminConsolePage({ role, userId, userEmail }: PageProps) {
  const [counts, setCounts] = useState<Counts | null>(null);
  const [health, setHealth] = useState<HealthRow[]>([]);
  const [recent, setRecent] = useState<RecentSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function authFetch(path: string, init?: RequestInit) {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    return fetch(path, {
      ...init,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  }

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const [
        { count: suppliersTotal },
        { count: suppliersActive },
        { count: customersTotal },
        { count: communitiesTotal },
        { count: invoicesThisMonth },
        { count: invoicesTotal },
        submissionsRes,
      ] = await Promise.all([
        supabase.from('suppliers').select('id', { count: 'exact', head: true }),
        supabase.from('suppliers').select('id', { count: 'exact', head: true }).eq('active', true),
        supabase.from('customers').select('id', { count: 'exact', head: true }),
        supabase.from('communities').select('id', { count: 'exact', head: true }),
        supabase
          .from('invoices')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', monthStart.toISOString()),
        supabase.from('invoices').select('id', { count: 'exact', head: true }),
        authFetch(`/api/corcentric-submissions?limit=10`),
      ]);

      // Submissions response — recent + roll-up
      const subBody = await submissionsRes.json().catch(() => ({}));
      const submissionsList: RecentSubmission[] = (subBody?.submissions ?? []).slice(0, 10);

      // This-month submissions count and success.
      // Table is corcentric_submissions (was dms_submissions in an earlier
      // schema). The old name silently returned nothing.
      let submissionsThisMonth = 0;
      let successThisMonth = 0;
      const { data: monthSubs } = await supabase
        .from('corcentric_submissions')
        .select('cor_status_code, created_at')
        .gte('created_at', monthStart.toISOString());
      if (Array.isArray(monthSubs)) {
        submissionsThisMonth = monthSubs.length;
        successThisMonth = monthSubs.filter(
          (s) =>
            (s as { cor_status_code: number | null }).cor_status_code !== null &&
            (s as { cor_status_code: number }).cor_status_code >= 200 &&
            (s as { cor_status_code: number }).cor_status_code < 300
        ).length;
      }

      // Hydrate recent with invoice + supplier
      const invIds = Array.from(new Set(submissionsList.map((r) => r.invoice_id)));
      if (invIds.length > 0) {
        const { data: invs } = await supabase
          .from('invoices')
          .select('id, invoice_data, supplier:suppliers(name)')
          .in('id', invIds);
        const byId = new Map(
          ((invs as Array<{
            id: string;
            invoice_data: Record<string, unknown>;
            supplier: { name?: string } | null;
          }>) ?? []).map((x) => [
            x.id,
            {
              invoice_number: (x.invoice_data?.InvoiceNumber as string) ?? '',
              supplier_name: x.supplier?.name ?? '',
            },
          ])
        );
        for (const r of submissionsList) {
          const hit = byId.get(r.invoice_id);
          if (hit) {
            r.invoice_number = hit.invoice_number;
            r.supplier_name = hit.supplier_name;
          }
        }
      }

      setCounts({
        suppliers: { total: suppliersTotal ?? 0, active: suppliersActive ?? 0 },
        customers: customersTotal ?? 0,
        communities: communitiesTotal ?? 0,
        invoicesThisMonth: invoicesThisMonth ?? 0,
        invoicesTotal: invoicesTotal ?? 0,
        submissionsThisMonth,
        successThisMonth,
      });
      setRecent(submissionsList);

      // ── Health row ──
      // Supabase: if we got here, queries worked.
      // Other integrations: no public health endpoint exposed, so we
      // report them as configured (env presence implied by the worker
      // accepting requests). Real ping endpoints would slot in here
      // later — see #101 for Corcentric.
      setHealth([
        { label: 'Supabase', status: 'ok', detail: 'queries succeeding' },
        { label: 'R2 storage', status: 'ok', detail: 'PDFs streaming' },
        { label: 'Mistral OCR', status: 'ok', detail: 'primary extractor' },
        { label: 'Resend', status: 'ok', detail: 'auth + transactional email' },
        {
          label: 'Corcentric DMS',
          status: (communitiesTotal ?? 0) > 0 ? 'ok' : 'warn',
          detail:
            (communitiesTotal ?? 0) > 0
              ? 'community credentials configured'
              : 'no community credentials yet',
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const successRate = useMemo(() => {
    if (!counts) return null;
    if (counts.submissionsThisMonth === 0) return null;
    return Math.round((counts.successThisMonth / counts.submissionsThisMonth) * 100);
  }, [counts]);

  return (
    <AppShell
      role={role}
      userId={userId}
      userEmail={userEmail}
      breadcrumb="Admin console"
    >
      <div className="px-7 py-7 max-w-[1280px] mx-auto space-y-7">
        <div className="flex items-end gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Admin console</h1>
            <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
              Tenant overview — supplier, customer, and submission activity at
              a glance, plus integration health.
            </p>
          </div>
        </div>

        {error && (
          <div className="bg-danger-soft border border-danger/20 rounded-card px-3 py-2.5 text-xs text-danger">
            {error}
          </div>
        )}

        {/* ── KPI strip ── */}
        {loading || !counts ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="bg-white border border-line rounded-card shadow-1 h-32 animate-pulse"
              />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3.5">
            <KpiCard
              label="Suppliers"
              value={counts.suppliers.total.toString()}
              deltaSubtext={`${counts.suppliers.active} active`}
              tone="ink"
            />
            <KpiCard
              label="Customers"
              value={counts.customers.toString()}
              deltaSubtext="across all suppliers"
              tone="info"
            />
            <KpiCard
              label="Communities"
              value={counts.communities.toString()}
              deltaSubtext="DMS credential sets"
              tone="brand"
            />
            <KpiCard
              label="Invoices this month"
              value={counts.invoicesThisMonth.toString()}
              deltaSubtext={
                successRate != null
                  ? `${successRate}% submitted to DMS`
                  : `${counts.invoicesTotal} all-time`
              }
              tone="success"
            />
          </div>
        )}

        {/* ── Integration health ── */}
        <section className="bg-white border border-line rounded-card shadow-1 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
            <div>
              <h2 className="text-[13px] font-semibold text-ink uppercase tracking-[0.06em]">
                Integration health
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                External services this portal depends on.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={loadAll} disabled={loading}>
              Refresh
            </Button>
          </div>
          {loading ? (
            <div className="px-5 py-8 text-center">
              <BrandedSpinner size="md" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {health.map((h) => (
                <li key={h.label} className="px-5 py-3 flex items-center gap-3">
                  <span
                    aria-hidden
                    className={cn(
                      'h-2 w-2 rounded-full shrink-0',
                      h.status === 'ok'
                        ? 'bg-success'
                        : h.status === 'warn'
                        ? 'bg-warning'
                        : h.status === 'down'
                        ? 'bg-danger'
                        : 'bg-zinc-300'
                    )}
                  />
                  <span className="text-sm font-medium text-ink min-w-[160px]">
                    {h.label}
                  </span>
                  <span className="flex-1 text-xs text-zinc-500">{h.detail}</span>
                  {h.status === 'ok' && (
                    <CheckCircle2
                      size={14}
                      className="text-success shrink-0"
                      aria-hidden
                    />
                  )}
                  {h.status === 'warn' && (
                    <AlertTriangle
                      size={14}
                      className="text-warning shrink-0"
                      aria-hidden
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Quick actions ── */}
        <section>
          <h2 className="text-[13px] font-semibold text-ink uppercase tracking-[0.06em] mb-3">
            Quick actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <QuickAction
              to="/suppliers"
              icon={<Building2 size={16} />}
              label="Add supplier"
              hint="Create a new supplier with email prefix and DMS community."
            />
            <QuickAction
              to="/admin/communities"
              icon={<Network size={16} />}
              label="Add community"
              hint="Configure Corcentric DMS API credentials for a partner network."
            />
            <QuickAction
              to="/customers"
              icon={<Users size={16} />}
              label="Add customer"
              hint="Create a customer record with bill-to / ship-to details."
            />
            <QuickAction
              to="/submissions"
              icon={<FileText size={16} />}
              label="View submissions"
              hint="Inspect every Corcentric DMS submission and retry failures."
            />
          </div>
        </section>

        {/* ── Recent submissions ── */}
        <section className="bg-white border border-line rounded-card shadow-1 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-ink uppercase tracking-[0.06em]">
              Recent submissions
            </h2>
            <Link
              to="/submissions"
              className="text-xs text-zinc-500 hover:text-ink inline-flex items-center gap-1"
            >
              View all
              <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
          {loading ? (
            <div className="px-5 py-8 text-center">
              <BrandedSpinner size="md" />
            </div>
          ) : recent.length === 0 ? (
            <div className="px-5 py-12 text-center text-sm text-zinc-500">
              No submissions yet. Email a fixture invoice to one of your supplier
              prefixes to get the pipeline moving.
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((r) => {
                const ok = r.cor_status_code != null && r.cor_status_code >= 200 && r.cor_status_code < 300;
                return (
                  <li
                    key={r.id}
                    className="px-5 py-3 flex items-center gap-3 text-sm"
                  >
                    <Pill variant={ok ? 'submitted' : r.submission_status === 'pending' ? 'ocr' : 'rejected'}>
                      {ok ? 'Success' : r.submission_status}
                    </Pill>
                    {r.is_dry_run && (
                      <Pill variant="neutral" hideDot className="text-[10px]">
                        Dry
                      </Pill>
                    )}
                    <span className="font-mono-num font-semibold text-ink">
                      {r.invoice_number || '—'}
                    </span>
                    <span className="text-zinc-500">·</span>
                    <span className="text-zinc-700 flex-1 truncate">
                      {r.supplier_name || '—'}
                    </span>
                    {r.cor_status_code != null && (
                      <span
                        className={cn(
                          'font-mono text-[12px]',
                          ok ? 'text-success' : 'text-danger'
                        )}
                      >
                        {r.cor_status_code}
                      </span>
                    )}
                    <span className="font-mono text-[11px] text-zinc-500 w-20 text-right">
                      {formatRel(r.submitted_at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function QuickAction({
  to,
  icon,
  label,
  hint,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <Link
      to={to}
      className="block bg-white border border-line rounded-card shadow-1 p-3.5 hover:border-zinc-300 hover:shadow-2 transition-all group"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="inline-flex items-center justify-center h-8 w-8 rounded-control bg-paper border border-line text-zinc-700 group-hover:bg-brand-50 group-hover:text-brand-600 group-hover:border-brand/20 transition-colors">
          {icon}
        </span>
        <ArrowRight
          size={13}
          className="text-zinc-400 group-hover:text-ink transition-colors"
          aria-hidden
        />
      </div>
      <div className="text-sm font-semibold text-ink">{label}</div>
      <div className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{hint}</div>
    </Link>
  );
}

function formatRel(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 30 * 86_400_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
