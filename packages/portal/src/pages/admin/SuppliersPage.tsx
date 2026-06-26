import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Plus, Pencil, X, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppShell } from '@/components/AppShell';

/**
 * Suppliers admin (Wave 6a, basic CRUD subset).
 *
 * API contracts (unchanged from team-admin-inject):
 *   GET    /api/suppliers
 *   POST   /api/suppliers              { name, code, email_prefix, contact_email?, contact_name?, test_mode? }
 *   PATCH  /api/suppliers/:id          partial of the same shape
 *   POST   /api/suppliers/:id/deactivate
 *   POST   /api/suppliers/:id/reactivate
 *   DELETE /api/suppliers/:id
 */

interface Supplier {
  id: string;
  name: string;
  code: string;
  email_prefix: string;
  contact_email: string | null;
  contact_name: string | null;
  active: boolean;
  test_mode?: boolean;
  /** Markdown text fed to Mistral OCR as a supplier-specific extraction
   *  guide via document_annotation_prompt. */
  extraction_template?: string | null;
  /** FK to communities table — holds the Corcentric DMS API credentials
   *  used when submitting this supplier's invoices. Required for live
   *  DMS submission to work. */
  community_id?: string | null;
  // PromoStandards ingestion config — when ps_ingestion_enabled is true,
  // the cron worker polls this supplier's Invoice Push web service every
  // ps_poll_interval_hours and lands invoices in our pipeline.
  ps_ingestion_enabled?: boolean;
  ps_endpoint_url?: string | null;
  ps_ws_version?: string | null;
  ps_auth_id?: string | null;
  ps_auth_password?: string | null;
  ps_poll_interval_hours?: number | null;
  ps_last_pulled_at?: string | null;
  created_at: string;
}

interface CommunityRef {
  id: string;
  code: string;
  name: string;
}

interface SupplierUser {
  id: string;
  email: string;
  display_name: string | null;
  role: string;
  active: boolean;
  last_sign_in_at?: string | null;
}

type ConfirmAction =
  | { kind: 'deactivate'; supplier: Supplier }
  | { kind: 'reactivate'; supplier: Supplier }
  | { kind: 'delete'; supplier: Supplier };

interface PageProps {
  role: 'admin' | 'team' | 'supplier';
  userId: string;
  userEmail: string | undefined;
}

export default function SuppliersPage({ role, userId, userEmail }: PageProps) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);

  useEffect(() => {
    fetchSuppliers();
  }, []);

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

  async function fetchSuppliers() {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/suppliers');
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      // /api/suppliers may return either { data: [...] } or [...] directly.
      const list: Supplier[] = Array.isArray(body) ? body : body?.data ?? [];
      setSuppliers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(formValues: SupplierFormValues, isNew: boolean, id?: string) {
    const path = isNew ? '/api/suppliers' : `/api/suppliers/${id}`;
    const method = isNew ? 'POST' : 'PATCH';
    const res = await authFetch(path, {
      method,
      body: JSON.stringify(formValues),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error || `HTTP ${res.status}`);
    }
    await fetchSuppliers();
  }

  async function runConfirm() {
    if (!confirm) return;
    const { kind, supplier } = confirm;
    let path = '';
    let method: 'POST' | 'DELETE' = 'POST';
    if (kind === 'deactivate') path = `/api/suppliers/${supplier.id}/deactivate`;
    else if (kind === 'reactivate') path = `/api/suppliers/${supplier.id}/reactivate`;
    else if (kind === 'delete') {
      path = `/api/suppliers/${supplier.id}`;
      method = 'DELETE';
    }
    const res = await authFetch(path, { method });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // surface the failure but don't crash the dialog
      window.alert(body?.error || `Failed: HTTP ${res.status}`);
      return;
    }
    setConfirm(null);
    await fetchSuppliers();
  }

  return (
    <AppShell role={role} userId={userId} userEmail={userEmail} breadcrumb="Suppliers">
    <div className="px-7 py-7 max-w-[1280px] mx-auto space-y-5">
      {/* Page head + Add CTA */}
      <div className="flex items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Suppliers</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Manage suppliers who can submit invoices via email or upload. Each
            supplier has a unique email prefix that routes inbound mail.
          </p>
        </div>
        <div className="ml-auto">
          <Button variant="primary" onClick={() => setEditing('new')}>
            <Plus size={13} aria-hidden />
            Add supplier
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-danger-soft border border-danger/20 rounded-card px-3 py-2.5 text-xs text-danger">
          {error}
        </div>
      )}

      {/* List table */}
      <div className="bg-white border border-line rounded-card shadow-1 overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-paper border-b border-line">
              <Th>Name</Th>
              <Th>Code</Th>
              <Th>Email prefix</Th>
              <Th>Contact</Th>
              <Th>Status</Th>
              <Th align="right" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <div className="inline-flex items-center gap-2 text-sm text-zinc-500">
                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-zinc-200 border-t-ink" />
                    Loading suppliers…
                  </div>
                </td>
              </tr>
            ) : suppliers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <p className="text-sm text-zinc-500">No suppliers yet.</p>
                </td>
              </tr>
            ) : (
              suppliers.map((s) => (
                <tr
                  key={s.id}
                  className={cn(
                    'border-b border-line last:border-b-0 transition-colors',
                    !s.active && 'opacity-60'
                  )}
                >
                  <Td>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink">{s.name}</span>
                      {s.test_mode && (
                        <Pill variant="review" hideDot className="text-[10px]">
                          Test
                        </Pill>
                      )}
                    </div>
                  </Td>
                  <Td className="font-mono text-zinc-700">{s.code}</Td>
                  <Td className="font-mono text-zinc-700 text-[12px]">
                    {s.email_prefix}@submitstream.com
                  </Td>
                  <Td className="text-zinc-700">
                    {s.contact_name ? (
                      <>
                        <div>{s.contact_name}</div>
                        {s.contact_email && (
                          <div className="text-[11px] font-mono text-zinc-500">
                            {s.contact_email}
                          </div>
                        )}
                      </>
                    ) : s.contact_email ? (
                      <div className="font-mono text-[12px]">{s.contact_email}</div>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </Td>
                  <Td>
                    {s.active ? (
                      <Pill variant="submitted">Active</Pill>
                    ) : (
                      <Pill variant="neutral">Inactive</Pill>
                    )}
                  </Td>
                  <Td align="right">
                    <div className="inline-flex items-center gap-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setEditing(s)}
                      >
                        <Pencil size={12} aria-hidden />
                        Edit
                      </Button>
                      {s.active ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirm({ kind: 'deactivate', supplier: s })}
                        >
                          Deactivate
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirm({ kind: 'reactivate', supplier: s })}
                        >
                          Reactivate
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirm({ kind: 'delete', supplier: s })}
                      >
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create / edit modal */}
      {editing && (
        <SupplierFormModal
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={async (vals) => {
            await handleSave(
              vals,
              editing === 'new',
              editing === 'new' ? undefined : editing.id
            );
            setEditing(null);
          }}
        />
      )}

      {/* Confirm modal */}
      {confirm && (
        <ConfirmModal
          action={confirm}
          onCancel={() => setConfirm(null)}
          onConfirm={runConfirm}
        />
      )}
    </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers + sub-components
// ──────────────────────────────────────────────────────────

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
    <td className={`text-${align} text-[13px] px-4 py-3 align-top ${className}`}>
      {children}
    </td>
  );
}

interface SupplierFormValues {
  name: string;
  code: string;
  email_prefix: string;
  contact_name: string | null;
  contact_email: string | null;
  test_mode: boolean;
  extraction_template?: string | null;
  community_id?: string | null;
  ps_ingestion_enabled?: boolean;
  ps_endpoint_url?: string | null;
  ps_ws_version?: string | null;
  ps_auth_id?: string | null;
  ps_auth_password?: string | null;
  ps_poll_interval_hours?: number | null;
}

const inputClass =
  'w-full h-9 px-2.5 bg-white border border-line-2 rounded-control text-[14px] text-ink placeholder:text-zinc-400 outline-none shadow-1 transition-[box-shadow,border-color] focus:border-brand focus:shadow-ring-brand';

type ModalTab = 'general' | 'extraction' | 'promostandards' | 'users';

function SupplierFormModal({
  supplier,
  onClose,
  onSave,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSave: (vals: SupplierFormValues) => Promise<void>;
}) {
  const isNew = supplier === null;

  // ── Tabs (only meaningful for existing suppliers — extraction + users
  // both need a supplier ID to scope to). For new, only General is shown. ──
  const [tab, setTab] = useState<ModalTab>('general');

  // ── General fields ──
  const [name, setName] = useState(supplier?.name ?? '');
  const [code, setCode] = useState(supplier?.code ?? '');
  const [emailPrefix, setEmailPrefix] = useState(supplier?.email_prefix ?? '');
  const [contactName, setContactName] = useState(supplier?.contact_name ?? '');
  const [contactEmail, setContactEmail] = useState(supplier?.contact_email ?? '');
  const [testMode, setTestMode] = useState(supplier?.test_mode ?? false);
  const [communityId, setCommunityId] = useState(supplier?.community_id ?? '');

  // ── Communities for the picker ──
  const [communities, setCommunities] = useState<CommunityRef[]>([]);
  useEffect(() => {
    (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const res = await fetch('/api/communities', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        const list: CommunityRef[] = Array.isArray(body) ? body : body?.data ?? [];
        setCommunities(list);
      }
    })();
  }, []);

  // ── Extraction template ──
  const [extractionTemplate, setExtractionTemplate] = useState(
    supplier?.extraction_template ?? ''
  );

  // ── PromoStandards (PS Invoice Push) ingestion config ──
  // When enabled, the cron worker polls this supplier's PS endpoint
  // every ps_poll_interval_hours hours and ingests new invoices into
  // the same pipeline as email-ingested ones.
  const [psEnabled, setPsEnabled] = useState(supplier?.ps_ingestion_enabled ?? false);
  const [psEndpointUrl, setPsEndpointUrl] = useState(supplier?.ps_endpoint_url ?? '');
  const [psWsVersion, setPsWsVersion] = useState(supplier?.ps_ws_version ?? '2.0.0');
  const [psAuthId, setPsAuthId] = useState(supplier?.ps_auth_id ?? '');
  const [psAuthPassword, setPsAuthPassword] = useState(supplier?.ps_auth_password ?? '');
  const [psPollIntervalHours, setPsPollIntervalHours] = useState<number>(
    supplier?.ps_poll_interval_hours ?? 24
  );
  const [psShowPassword, setPsShowPassword] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setErr(null);
    if (!name.trim() || !code.trim() || !emailPrefix.trim()) {
      setErr('Name, code, and email prefix are required.');
      setTab('general');
      return;
    }
    setSubmitting(true);
    try {
      await onSave({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        email_prefix: emailPrefix.trim().toLowerCase(),
        contact_name: contactName.trim() || null,
        contact_email: contactEmail.trim() || null,
        test_mode: testMode,
        community_id: communityId || null,
        // Only send extraction_template + ps_* when editing (POST schema
        // may not accept them on create — they're configured after the
        // supplier exists).
        ...(isNew
          ? {}
          : {
              extraction_template: extractionTemplate.trim() || null,
              ps_ingestion_enabled: psEnabled,
              ps_endpoint_url: psEndpointUrl.trim() || null,
              ps_ws_version: psWsVersion.trim() || null,
              ps_auth_id: psAuthId.trim() || null,
              ps_auth_password: psAuthPassword.trim() || null,
              ps_poll_interval_hours: Number.isFinite(psPollIntervalHours)
                ? psPollIntervalHours
                : 24,
            }),
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-card shadow-2 max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="text-base font-semibold text-ink">
            {isNew ? 'Add supplier' : `Edit ${supplier?.name}`}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-ink p-1 -m-1"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab strip — only for existing suppliers */}
        {!isNew && (
          <div className="px-5 border-b border-line bg-paper">
            <nav className="flex items-center gap-6">
              <ModalTabBtn active={tab === 'general'} onClick={() => setTab('general')}>
                General
              </ModalTabBtn>
              <ModalTabBtn active={tab === 'extraction'} onClick={() => setTab('extraction')}>
                Extraction
              </ModalTabBtn>
              <ModalTabBtn active={tab === 'promostandards'} onClick={() => setTab('promostandards')}>
                PromoStandards
              </ModalTabBtn>
              <ModalTabBtn active={tab === 'users'} onClick={() => setTab('users')}>
                Users
              </ModalTabBtn>
            </nav>
          </div>
        )}

        {/* Tab content */}
        <div className="overflow-y-auto flex-1">
          {(isNew || tab === 'general') && (
            <form
              id="supplier-general-form"
              onSubmit={handleSubmit}
              className="px-5 py-4 space-y-3"
            >
              <FormRow label="Supplier name" required>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  className={inputClass}
                />
              </FormRow>
              <FormRow
                label="Supplier code"
                required
                hint="Short uppercase identifier (e.g. OSPR, POLE)."
              >
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  required
                  className={cn(inputClass, 'font-mono uppercase')}
                />
              </FormRow>
              <FormRow
                label="Email prefix"
                required
                hint="Inbound invoices to {prefix}@submitstream.com route to this supplier."
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={emailPrefix}
                    onChange={(e) => setEmailPrefix(e.target.value.toLowerCase())}
                    required
                    className={cn(inputClass, 'font-mono lowercase')}
                  />
                  <span className="text-xs text-zinc-500 font-mono whitespace-nowrap">
                    @submitstream.com
                  </span>
                </div>
              </FormRow>
              <FormRow label="Contact name">
                <input
                  type="text"
                  value={contactName}
                  onChange={(e) => setContactName(e.target.value)}
                  className={inputClass}
                />
              </FormRow>
              <FormRow label="Contact email">
                <input
                  type="email"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className={cn(inputClass, 'font-mono')}
                />
              </FormRow>
              <FormRow
                label="Community"
                hint="The partner network whose Corcentric DMS credentials are used to submit this supplier's invoices."
              >
                <select
                  value={communityId}
                  onChange={(e) => setCommunityId(e.target.value)}
                  className={cn(inputClass, 'pr-8')}
                >
                  <option value="">— None —</option>
                  {communities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
                {communities.length === 0 && (
                  <p className="text-[11px] text-warning mt-1">
                    No communities configured yet. Create one under Admin → Communities first.
                  </p>
                )}
              </FormRow>
              <label className="flex items-center gap-2 pt-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={testMode}
                  onChange={(e) => setTestMode(e.target.checked)}
                  className="h-4 w-4 accent-brand"
                />
                <span className="text-xs text-ink">
                  Test mode — flag this supplier's invoices as test data (won't post to DMS).
                </span>
              </label>
            </form>
          )}

          {!isNew && tab === 'extraction' && (
            <ExtractionTab
              value={extractionTemplate}
              onChange={setExtractionTemplate}
            />
          )}

          {!isNew && tab === 'promostandards' && (
            <PromoStandardsTab
              enabled={psEnabled}
              onEnabledChange={setPsEnabled}
              endpointUrl={psEndpointUrl}
              onEndpointUrlChange={setPsEndpointUrl}
              wsVersion={psWsVersion}
              onWsVersionChange={setPsWsVersion}
              authId={psAuthId}
              onAuthIdChange={setPsAuthId}
              authPassword={psAuthPassword}
              onAuthPasswordChange={setPsAuthPassword}
              showPassword={psShowPassword}
              onShowPasswordToggle={() => setPsShowPassword((s) => !s)}
              pollIntervalHours={psPollIntervalHours}
              onPollIntervalHoursChange={setPsPollIntervalHours}
              lastPulledAt={supplier?.ps_last_pulled_at ?? null}
            />
          )}

          {!isNew && tab === 'users' && supplier && (
            <UsersTab supplier={supplier} />
          )}
        </div>

        {/* Footer */}
        {(isNew || tab === 'general' || tab === 'extraction' || tab === 'promostandards') && (
          <div className="border-t border-line px-5 py-3.5 flex items-center gap-2">
            {err && (
              <div className="flex-1 text-xs text-danger flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {err}
              </div>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={submitting}
                onClick={() => handleSubmit()}
              >
                {submitting ? 'Saving…' : isNew ? 'Create supplier' : 'Save changes'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ModalTabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center px-0 py-2.5 text-[13px] font-medium border-b-2 -mb-px transition-colors',
        active ? 'text-ink border-ink' : 'text-zinc-500 border-transparent hover:text-ink'
      )}
    >
      {children}
    </button>
  );
}

// ──────────────────────────────────────────────────────────
// Extraction tab — markdown textarea fed to Mistral
// ──────────────────────────────────────────────────────────

function PromoStandardsTab({
  enabled, onEnabledChange,
  endpointUrl, onEndpointUrlChange,
  wsVersion, onWsVersionChange,
  authId, onAuthIdChange,
  authPassword, onAuthPasswordChange,
  showPassword, onShowPasswordToggle,
  pollIntervalHours, onPollIntervalHoursChange,
  lastPulledAt,
}: {
  enabled: boolean;
  onEnabledChange: (v: boolean) => void;
  endpointUrl: string;
  onEndpointUrlChange: (v: string) => void;
  wsVersion: string;
  onWsVersionChange: (v: string) => void;
  authId: string;
  onAuthIdChange: (v: string) => void;
  authPassword: string;
  onAuthPasswordChange: (v: string) => void;
  showPassword: boolean;
  onShowPasswordToggle: () => void;
  pollIntervalHours: number;
  onPollIntervalHoursChange: (v: number) => void;
  lastPulledAt: string | null;
}) {
  return (
    <div className="px-5 py-4 space-y-4">
      <p className="text-xs text-zinc-500 leading-relaxed max-w-prose">
        PromoStandards Invoice Push lets us pull invoices on a schedule
        from suppliers that expose the spec-compliant SOAP endpoint. When
        enabled, the cron worker polls every{' '}
        <span className="font-mono">poll interval</span> hours, dedupes by
        invoice number, and lands new invoices in the same OCR/review
        pipeline as email-ingested ones.
      </p>

      {/* Enable toggle */}
      <label className="flex items-start gap-3 bg-paper border border-line rounded-control px-3.5 py-3 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 rounded border-line-2 text-brand focus:ring-brand"
        />
        <div className="flex-1">
          <div className="text-[13px] font-semibold text-ink">
            Enable PromoStandards ingestion
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">
            When on, the cron worker polls the endpoint below at the
            interval set. Off means we ignore this supplier on the cron
            sweep — invoices still come in via email if configured.
          </div>
        </div>
      </label>

      {/* Endpoint */}
      <FormRow label="Endpoint URL" hint="Supplier's Invoice Push WSDL endpoint.">
        <input
          type="url"
          value={endpointUrl}
          onChange={(e) => onEndpointUrlChange(e.target.value)}
          placeholder="https://supplier.example.com/PromoStandards/InvoicePush"
          className={cn(inputClass, 'font-mono text-[12px]')}
          disabled={!enabled}
        />
      </FormRow>

      <div className="grid grid-cols-2 gap-3">
        <FormRow label="Web service version" hint='Usually "2.0.0".'>
          <input
            type="text"
            value={wsVersion}
            onChange={(e) => onWsVersionChange(e.target.value)}
            placeholder="2.0.0"
            className={cn(inputClass, 'font-mono')}
            disabled={!enabled}
          />
        </FormRow>
        <FormRow
          label="Poll interval (hours)"
          hint="How often the cron sweep should ask for new invoices."
        >
          <input
            type="number"
            min={1}
            max={168}
            value={pollIntervalHours}
            onChange={(e) => onPollIntervalHoursChange(Number(e.target.value))}
            className={cn(inputClass, 'font-num')}
            disabled={!enabled}
          />
        </FormRow>
      </div>

      {/* Auth — visually grouped, with show/hide for password */}
      <div className="pt-1">
        <div className="text-[10px] uppercase tracking-[0.06em] font-semibold text-brand mb-2">
          Auth
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormRow label="Auth ID">
            <input
              type="text"
              value={authId}
              onChange={(e) => onAuthIdChange(e.target.value)}
              placeholder="ID provided by the supplier"
              className={cn(inputClass, 'font-mono')}
              autoComplete="off"
              disabled={!enabled}
            />
          </FormRow>
          <FormRow label="Auth password">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={authPassword}
                onChange={(e) => onAuthPasswordChange(e.target.value)}
                placeholder="Provided by the supplier"
                className={cn(inputClass, 'font-mono pr-16')}
                autoComplete="off"
                disabled={!enabled}
              />
              <button
                type="button"
                onClick={onShowPasswordToggle}
                disabled={!enabled}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-zinc-500 hover:text-ink px-1 disabled:opacity-50"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </FormRow>
        </div>
      </div>

      {/* Status */}
      <div className="bg-paper border border-line rounded-control px-3 py-2.5 text-[11px] text-zinc-700 flex items-center justify-between">
        <span>Last successful pull</span>
        <span className="font-mono">
          {lastPulledAt
            ? new Date(lastPulledAt).toLocaleString()
            : <span className="text-zinc-400 italic">never</span>}
        </span>
      </div>
    </div>
  );
}

function ExtractionTab({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="px-5 py-4">
      <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
        Markdown / plain-text guidance passed to Mistral OCR alongside this
        supplier's invoices. Use it to call out template quirks the model
        would otherwise miss — where to find the PO number, what tracking
        formats look like, how to interpret unusual line-item layouts.
      </p>
      <div className="bg-paper border border-line rounded-control px-3 py-2 mb-3 text-[11px] text-zinc-600 font-mono leading-relaxed">
        # Example<br />
        - PO number is in the upper-right header<br />
        - Tracking numbers always start with "1Z" (UPS)<br />
        - Line items use 12-digit vendor part numbers in column 2<br />
        - Subtotal is labeled "Net amount" on this template
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={14}
        placeholder="Markdown extraction guide for this supplier…"
        className="w-full px-3 py-2.5 bg-white border border-line-2 rounded-control text-[13px] text-ink placeholder:text-zinc-400 font-mono outline-none shadow-1 focus:border-brand focus:shadow-ring-brand resize-y leading-[1.55]"
      />
      <p className="text-[11px] text-zinc-500 mt-2">
        Saved on Save changes. Empty = use the default prompt.
      </p>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Users tab — list assigned users + invite form
// ──────────────────────────────────────────────────────────

function UsersTab({ supplier }: { supplier: Supplier }) {
  const [users, setUsers] = useState<SupplierUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

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

  async function loadUsers() {
    setError(null);
    try {
      const res = await authFetch(`/api/suppliers/${supplier.id}/users`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      const list: SupplierUser[] = Array.isArray(body) ? body : body?.data ?? [];
      setUsers(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier.id]);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviteErr(null);
    if (!inviteEmail.trim() || !inviteName.trim()) {
      setInviteErr('Email and display name are required.');
      return;
    }
    setInviteSubmitting(true);
    try {
      const res = await authFetch('/api/team/invite', {
        method: 'POST',
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          display_name: inviteName.trim(),
          role: 'supplier',
          // Backend validator expects singular supplier_id (string) when
          // role === 'supplier'. The plural supplier_ids[] form is only
          // accepted for the admin-invite path, not for supplier users.
          supplier_id: supplier.id,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setInviteErr(body?.error || `HTTP ${res.status}`);
        setInviteSubmitting(false);
        return;
      }
      setStatusMsg({
        kind: 'ok',
        text: `Invite sent to ${inviteEmail}. They'll receive a magic link to sign in — no password needed.`,
      });
      setInviteEmail('');
      setInviteName('');
      setInviting(false);
      await loadUsers();
    } catch (err) {
      setInviteErr(err instanceof Error ? err.message : String(err));
    } finally {
      setInviteSubmitting(false);
    }
  }

  return (
    <div className="px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-zinc-500 max-w-md">
          Portal users assigned to <strong className="text-ink">{supplier.name}</strong>.
          Each gets a magic-link sign-in and only sees this supplier's invoices.
        </p>
        {!inviting && (
          <Button variant="primary" size="sm" onClick={() => setInviting(true)}>
            <Plus size={12} aria-hidden />
            Invite user
          </Button>
        )}
      </div>

      {statusMsg && (
        <div
          className={cn(
            'text-xs rounded-control px-3 py-2 mb-3',
            statusMsg.kind === 'ok'
              ? 'bg-success-soft text-success border border-success/20'
              : 'bg-danger-soft text-danger border border-danger/20'
          )}
        >
          {statusMsg.text}
        </div>
      )}

      {/* Inline invite form */}
      {inviting && (
        <form
          onSubmit={handleInvite}
          className="bg-paper border border-line rounded-card p-3 mb-3 space-y-2.5"
        >
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-zinc-700 mb-1">
                Display name
              </label>
              <input
                type="text"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                required
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-zinc-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
                className={cn(inputClass, 'font-mono')}
              />
            </div>
          </div>
          {inviteErr && (
            <div className="text-xs text-danger flex items-start gap-1.5">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              {inviteErr}
            </div>
          )}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="sm" disabled={inviteSubmitting}>
              {inviteSubmitting ? 'Sending…' : 'Send invite'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setInviting(false);
                setInviteEmail('');
                setInviteName('');
                setInviteErr(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {error && (
        <div className="text-xs text-danger bg-danger-soft border border-danger/20 rounded-control px-3 py-2 mb-3">
          {error}
        </div>
      )}

      {/* Users list */}
      {users === null ? (
        <div className="text-sm text-zinc-500 px-3 py-6 text-center">Loading users…</div>
      ) : users.length === 0 ? (
        <div className="text-sm text-zinc-500 px-3 py-6 text-center bg-paper rounded-control">
          No users assigned yet. Click <strong className="text-ink">Invite user</strong> above to add one.
        </div>
      ) : (
        <div className="border border-line rounded-control overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-paper border-b border-line">
                <th className="text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.06em] px-3 py-2">
                  Name
                </th>
                <th className="text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.06em] px-3 py-2">
                  Email
                </th>
                <th className="text-left text-[10px] font-semibold text-zinc-500 uppercase tracking-[0.06em] px-3 py-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b last:border-b-0 border-line">
                  <td className="px-3 py-2 font-medium text-ink">
                    {u.display_name || (
                      <span className="text-zinc-400 italic">no name</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-700 text-[12px]">
                    {u.email}
                  </td>
                  <td className="px-3 py-2">
                    {u.active ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500">
                        <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
                        Inactive
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConfirmModal({
  action,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const { kind, supplier } = action;

  const title =
    kind === 'deactivate'
      ? `Deactivate ${supplier.name}?`
      : kind === 'reactivate'
      ? `Reactivate ${supplier.name}?`
      : `Permanently delete ${supplier.name}?`;

  const body =
    kind === 'deactivate'
      ? `${supplier.name} won't receive new invoices and will be hidden from active lists. You can reactivate later.`
      : kind === 'reactivate'
      ? `${supplier.name} will appear in active lists and receive invoices again.`
      : `This cannot be undone. Permanently removes ${supplier.name} and all team assignments. Existing invoices will retain their supplier reference.`;

  const confirmLabel =
    kind === 'deactivate' ? 'Deactivate' : kind === 'reactivate' ? 'Reactivate' : 'Delete';
  const variant = kind === 'delete' ? 'danger' : 'primary';

  async function go() {
    setPending(true);
    await onConfirm();
    setPending(false);
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="bg-white rounded-card shadow-2 max-w-sm w-full p-5">
        <div className="flex items-start gap-3 mb-3">
          {kind === 'delete' && <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />}
          <div>
            <h3 className="text-base font-semibold text-ink">{title}</h3>
            <p className="text-sm text-zinc-700 mt-1.5">{body}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant={variant} onClick={go} disabled={pending}>
            {pending ? 'Working…' : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function FormRow({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="flex items-center gap-1 text-xs font-medium text-zinc-700 mb-1.5">
        {label}
        {required && <span className="text-danger">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-zinc-500 mt-1">{hint}</p>}
    </div>
  );
}
