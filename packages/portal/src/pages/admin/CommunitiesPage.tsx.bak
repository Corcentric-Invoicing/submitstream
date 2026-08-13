import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/ui/pill';
import { Plus, Pencil, X, AlertTriangle, KeyRound, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AppShell } from '@/components/AppShell';

/**
 * Communities admin — partner-network credential store.
 *
 * Each Community holds the Corcentric DMS API credentials (URL, username,
 * password) used to authenticate submissions. Suppliers belong to a
 * community via supplier.community_id; the DMS submit pipeline reads the
 * community's credentials when posting.
 *
 * API:
 *   GET    /api/communities
 *   POST   /api/communities      { code, name, cor_api_url?, cor_username?, cor_password? }
 *   PATCH  /api/communities/:id  partial of the above
 *   DELETE /api/communities/:id  soft-delete
 */

interface Community {
  id: string;
  code: string;
  name: string;
  cor_api_url: string | null;
  cor_username: string | null;
  cor_password: string | null;
  active?: boolean;
  created_at?: string;
  supplier_count?: number;
}

interface PageProps {
  role: 'admin' | 'team' | 'supplier';
  userId: string;
  userEmail: string | undefined;
}

export default function CommunitiesPage({ role, userId, userEmail }: PageProps) {
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Community | 'new' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Community | null>(null);

  useEffect(() => {
    fetchCommunities();
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

  async function fetchCommunities() {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch('/api/communities');
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error || `HTTP ${res.status}`);
        return;
      }
      const list: Community[] = Array.isArray(body) ? body : body?.data ?? [];

      // Fetch supplier-count per community (best-effort) from the
      // supplier_communities join. A supplier can belong to multiple
      // communities now, so counting via supplier.community_id would
      // miss any assignments made after the SUPPLIER-COMMUNITIES-REFACTOR.
      const asn = await authFetch('/api/supplier-communities');
      const asnBody = await asn.json().catch(() => null);
      const assignments: Array<{ community_id?: string; active?: boolean }> =
        asnBody?.data ?? [];
      const counts = new Map<string, number>();
      for (const a of assignments) {
        if (a.community_id && a.active !== false) {
          counts.set(a.community_id, (counts.get(a.community_id) ?? 0) + 1);
        }
      }
      setCommunities(
        list.map((c) => ({ ...c, supplier_count: counts.get(c.id) ?? 0 }))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(values: Partial<Community>, isNew: boolean, id?: string) {
    const path = isNew ? '/api/communities' : `/api/communities/${id}`;
    const method = isNew ? 'POST' : 'PATCH';
    const res = await authFetch(path, {
      method,
      body: JSON.stringify(values),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
    await fetchCommunities();
  }

  async function handleDelete(c: Community) {
    const res = await authFetch(`/api/communities/${c.id}`, { method: 'DELETE' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(body?.error || `Failed: HTTP ${res.status}`);
      return;
    }
    setConfirmDelete(null);
    await fetchCommunities();
  }

  return (
    <AppShell role={role} userId={userId} userEmail={userEmail} breadcrumb="Communities">
      <div className="px-7 py-7 max-w-[1280px] mx-auto space-y-5">
        <div className="flex items-end gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Communities</h1>
            <p className="text-sm text-zinc-500 mt-1 max-w-2xl">
              Partner networks. Each community holds the Corcentric DMS API
              credentials used to submit invoices for the suppliers within it.
            </p>
          </div>
          <div className="ml-auto">
            <Button variant="primary" onClick={() => setEditing('new')}>
              <Plus size={13} aria-hidden />
              Add community
            </Button>
          </div>
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
                <Th>Community</Th>
                <Th>Code</Th>
                <Th>DMS endpoint</Th>
                <Th>Credentials</Th>
                <Th>Suppliers</Th>
                <Th align="right" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <div className="inline-flex items-center gap-2 text-sm text-zinc-500">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-zinc-200 border-t-ink" />
                      Loading communities…
                    </div>
                  </td>
                </tr>
              ) : communities.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center">
                    <p className="text-sm text-zinc-500">
                      No communities yet. Click <strong className="text-ink">Add community</strong> above.
                    </p>
                  </td>
                </tr>
              ) : (
                communities.map((c) => (
                  <tr
                    key={c.id}
                    className="border-b border-line last:border-b-0 transition-colors"
                  >
                    <Td>
                      <div className="font-semibold text-ink">{c.name}</div>
                    </Td>
                    <Td className="font-mono text-zinc-700">{c.code}</Td>
                    <Td className="font-mono text-[12px] text-zinc-700 truncate max-w-[280px]">
                      {c.cor_api_url || (
                        <span className="text-zinc-400 italic">not set</span>
                      )}
                    </Td>
                    <Td>
                      {c.cor_username && c.cor_password ? (
                        <Pill variant="submitted" hideDot className="text-[10px]">
                          <CheckCircle2 size={10} className="mr-0.5" /> Configured
                        </Pill>
                      ) : c.cor_username || c.cor_password ? (
                        <Pill variant="review" hideDot className="text-[10px]">
                          Partial
                        </Pill>
                      ) : (
                        <Pill variant="neutral" hideDot className="text-[10px]">
                          None
                        </Pill>
                      )}
                    </Td>
                    <Td>
                      <span className="font-num text-zinc-700">
                        {c.supplier_count ?? 0}
                      </span>
                    </Td>
                    <Td align="right">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setEditing(c)}
                        >
                          <Pencil size={12} aria-hidden />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmDelete(c)}
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

        {editing && (
          <CommunityFormModal
            community={editing === 'new' ? null : editing}
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

        {confirmDelete && (
          <DeleteConfirm
            community={confirmDelete}
            onCancel={() => setConfirmDelete(null)}
            onConfirm={() => handleDelete(confirmDelete)}
          />
        )}
      </div>
    </AppShell>
  );
}

// ──────────────────────────────────────────────────────────
// Form modal
// ──────────────────────────────────────────────────────────

const inputClass =
  'w-full h-9 px-2.5 bg-white border border-line-2 rounded-control text-[14px] text-ink placeholder:text-zinc-400 outline-none shadow-1 transition-[box-shadow,border-color] focus:border-brand focus:shadow-ring-brand';

function CommunityFormModal({
  community,
  onClose,
  onSave,
}: {
  community: Community | null;
  onClose: () => void;
  onSave: (vals: Partial<Community>) => Promise<void>;
}) {
  const isNew = community === null;
  const [code, setCode] = useState(community?.code ?? '');
  const [name, setName] = useState(community?.name ?? '');
  const [apiUrl, setApiUrl] = useState(community?.cor_api_url ?? '');
  const [username, setUsername] = useState(community?.cor_username ?? '');
  const [password, setPassword] = useState(community?.cor_password ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  // Tab state — Suppliers tab only enabled when editing an existing
  // community (you can't assign suppliers to a record that doesn't
  // exist yet). When creating, this stays on 'general' the whole time.
  const [tab, setTab] = useState<'general' | 'suppliers'>('general');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!code.trim() || !name.trim()) {
      setErr('Code and name are required.');
      return;
    }
    setSubmitting(true);
    try {
      await onSave({
        code: code.trim().toUpperCase(),
        name: name.trim(),
        cor_api_url: apiUrl.trim() || null,
        cor_username: username.trim() || null,
        cor_password: password.trim() || null,
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
      // NOTE: no backdrop click-to-close. A stray click outside the modal
      // would nuke in-progress form input. Users close via X or Cancel.
    >
      <div className="bg-white rounded-card shadow-2 max-w-lg w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <h3 className="text-base font-semibold text-ink">
            {isNew ? 'Add community' : `Edit ${community?.name}`}
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

        {!isNew && (
          <div className="flex items-center gap-1 px-5 pt-3 border-b border-line text-[13px]">
            <button
              type="button"
              onClick={() => setTab('general')}
              className={cn(
                'px-3 py-2 -mb-px border-b-2 transition-colors',
                tab === 'general'
                  ? 'border-ink text-ink font-semibold'
                  : 'border-transparent text-zinc-500 hover:text-ink'
              )}
            >
              General
            </button>
            <button
              type="button"
              onClick={() => setTab('suppliers')}
              className={cn(
                'px-3 py-2 -mb-px border-b-2 transition-colors',
                tab === 'suppliers'
                  ? 'border-ink text-ink font-semibold'
                  : 'border-transparent text-zinc-500 hover:text-ink'
              )}
            >
              Suppliers
            </button>
          </div>
        )}

        {tab === 'suppliers' && community ? (
          <CommunitySuppliersTab community={community} />
        ) : (
        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 overflow-y-auto">
          <FormRow label="Community name" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. IPW"
              required
              className={inputClass}
            />
          </FormRow>
          <FormRow
            label="Code"
            required
            hint="Short uppercase identifier — used for routing and reporting."
          >
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. IPW"
              required
              className={cn(inputClass, 'font-mono uppercase')}
            />
          </FormRow>

          <div className="pt-2">
            <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.06em] font-semibold text-brand mb-2">
              <KeyRound size={11} aria-hidden />
              DMS API Credentials
            </div>
            <p className="text-[11px] text-zinc-500 mb-3">
              Used to authenticate against the Corcentric DMS for invoices submitted
              by suppliers in this community.
            </p>
          </div>

          <FormRow label="API URL">
            <input
              type="url"
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="https://dmsservice.corcentric.com/.../RequestProcessor.svc/web"
              className={cn(inputClass, 'font-mono text-[12px]')}
            />
          </FormRow>
          <FormRow label="Username">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="DMS API username"
              className={cn(inputClass, 'font-mono')}
              autoComplete="off"
            />
          </FormRow>
          <FormRow label="Password">
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="DMS API password"
                className={cn(inputClass, 'font-mono pr-16')}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-zinc-500 hover:text-ink px-1"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </FormRow>

          {err && (
            <div className="text-xs text-danger flex items-start gap-1.5">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {err}
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? 'Saving…' : isNew ? 'Create community' : 'Save changes'}
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </form>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Suppliers tab — manage supplier ↔ community assignments
//
// Uses the supplier_communities join table (post SUPPLIER-COMMUNITIES-
// REFACTOR), so a single supplier can be assigned to multiple
// communities, each with its own Corcentric vendor + customer codes.
// ──────────────────────────────────────────────────────────

interface SupplierLite {
  id: string;
  name: string;
  code: string;
  active: boolean;
}

interface AssignmentRow {
  id: string;
  supplier_id: string;
  community_id: string;
  cor_vendor_code: string | null;
  cor_customer_code: string | null;
  is_primary: boolean;
  active: boolean;
  suppliers?: { id: string; name: string; code: string } | null;
}

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

function CommunitySuppliersTab({ community }: { community: Community }) {
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [assignments, setAssignments] = useState<AssignmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState<AssignmentRow | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [supRes, asnRes] = await Promise.all([
        authFetch('/api/suppliers'),
        authFetch(`/api/supplier-communities?community_id=${encodeURIComponent(community.id)}`),
      ]);
      const supBody = await supRes.json();
      const asnBody = await asnRes.json();
      const supList: SupplierLite[] = (Array.isArray(supBody) ? supBody : supBody?.data ?? [])
        .map((s: Record<string, unknown>) => ({
          id: String(s.id),
          name: String(s.name),
          code: String(s.code),
          active: Boolean(s.active ?? true),
        }))
        .filter((s: SupplierLite) => s.active)
        .sort((a: SupplierLite, b: SupplierLite) => a.name.localeCompare(b.name));
      const asnList: AssignmentRow[] = (asnBody?.data ?? []) as AssignmentRow[];
      setSuppliers(supList);
      setAssignments(asnList);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.id]);

  async function removeAssignment(row: AssignmentRow) {
    setBusyId(row.id);
    setError(null);
    try {
      const res = await authFetch(`/api/supplier-communities/${encodeURIComponent(row.id)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  }

  const assignedSupplierIds = new Set(assignments.map((a) => a.supplier_id));
  const availableSuppliers = suppliers.filter((s) => !assignedSupplierIds.has(s.id));

  return (
    <>
      <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1">
        <p className="text-[12px] text-zinc-500">
          Suppliers assigned to this community use its DMS credentials when
          their invoices are submitted to Corcentric. Each assignment carries
          its own Corcentric vendor code (and optional customer-code default)
          because vendor codes are scoped to the DMS community.
        </p>

        {error && (
          <div className="bg-danger-soft border border-danger/20 rounded-control px-2.5 py-2 text-xs text-danger">
            {error}
          </div>
        )}

        {/* Assigned list */}
        <div>
          <div className="text-[10px] uppercase tracking-[0.06em] font-semibold text-zinc-500 mb-1.5">
            Assigned · {assignments.length}
          </div>
          {loading ? (
            <div className="text-[12px] text-zinc-500">Loading…</div>
          ) : assignments.length === 0 ? (
            <div className="text-[12px] text-zinc-500 italic">
              No suppliers assigned yet — use Add supplier below.
            </div>
          ) : (
            <ul className="space-y-1">
              {assignments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 bg-paper border border-line rounded-control px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] text-ink font-medium truncate">
                        {a.suppliers?.name || a.supplier_id}
                      </span>
                      {a.is_primary && (
                        <span className="text-[9px] uppercase tracking-[0.06em] font-semibold bg-brand/10 text-brand px-1.5 py-0.5 rounded">
                          primary
                        </span>
                      )}
                      {!a.active && (
                        <span className="text-[9px] uppercase tracking-[0.06em] font-semibold bg-zinc-100 text-zinc-500 px-1.5 py-0.5 rounded">
                          inactive
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-zinc-500 mt-0.5 flex items-center gap-3 flex-wrap">
                      <span className="truncate">{a.suppliers?.code || ''}</span>
                      <span>
                        vendor:{' '}
                        <span className={cn('text-ink', !a.cor_vendor_code && 'text-danger')}>
                          {a.cor_vendor_code || '— missing —'}
                        </span>
                      </span>
                      {a.cor_customer_code && (
                        <span>
                          customer default: <span className="text-ink">{a.cor_customer_code}</span>
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingAssignment(a)}
                    disabled={busyId === a.id}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busyId === a.id}
                    onClick={() => removeAssignment(a)}
                  >
                    {busyId === a.id ? 'Removing…' : 'Remove'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add CTA */}
        <div className="border-t border-line pt-4">
          <Button
            variant="primary"
            size="sm"
            disabled={loading || availableSuppliers.length === 0}
            onClick={() => setShowAssignModal(true)}
          >
            + Add supplier
          </Button>
          {availableSuppliers.length === 0 && (
            <span className="ml-3 text-[11px] text-zinc-500">
              Every active supplier is already in this community.
            </span>
          )}
        </div>
      </div>

      {/* Add assignment modal */}
      {showAssignModal && (
        <AssignmentModal
          mode="create"
          community={community}
          existing={null}
          availableSuppliers={availableSuppliers}
          hasPrimaryAlready={false /* per-community; primary is per-supplier so we always allow on create */}
          onClose={() => setShowAssignModal(false)}
          onSaved={async () => {
            setShowAssignModal(false);
            await load();
          }}
        />
      )}

      {/* Edit assignment modal */}
      {editingAssignment && (
        <AssignmentModal
          mode="edit"
          community={community}
          existing={editingAssignment}
          availableSuppliers={suppliers /* show all so the name renders */}
          hasPrimaryAlready={false}
          onClose={() => setEditingAssignment(null)}
          onSaved={async () => {
            setEditingAssignment(null);
            await load();
          }}
        />
      )}
    </>
  );
}

// ── Assignment modal (create + edit) ─────────────────────────

interface AssignmentModalProps {
  mode: 'create' | 'edit';
  community: Community;
  existing: AssignmentRow | null;
  availableSuppliers: SupplierLite[];
  hasPrimaryAlready: boolean;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

function AssignmentModal({
  mode,
  community,
  existing,
  availableSuppliers,
  onClose,
  onSaved,
}: AssignmentModalProps) {
  const [supplierId, setSupplierId] = useState(existing?.supplier_id ?? '');
  const [vendorCode, setVendorCode] = useState(existing?.cor_vendor_code ?? '');
  const [customerCode, setCustomerCode] = useState(existing?.cor_customer_code ?? '');
  const [isPrimary, setIsPrimary] = useState(existing?.is_primary ?? true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Default vendor code to supplier.code when supplier picked (create mode only)
  const selectedSupplier = availableSuppliers.find((s) => s.id === supplierId);
  useEffect(() => {
    if (mode === 'create' && selectedSupplier && !vendorCode) {
      setVendorCode(selectedSupplier.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId]);

  async function handleSubmit() {
    if (mode === 'create' && !supplierId) {
      setErr('Pick a supplier.');
      return;
    }
    if (!vendorCode.trim()) {
      setErr('Vendor code is required — Corcentric uses it to identify this supplier in this DMS community.');
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const path =
        mode === 'create'
          ? '/api/supplier-communities'
          : `/api/supplier-communities/${encodeURIComponent(existing!.id)}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const body =
        mode === 'create'
          ? {
              supplier_id: supplierId,
              community_id: community.id,
              cor_vendor_code: vendorCode.trim(),
              cor_customer_code: customerCode.trim() || null,
              is_primary: isPrimary,
            }
          : {
              cor_vendor_code: vendorCode.trim(),
              cor_customer_code: customerCode.trim() || null,
              is_primary: isPrimary,
            };
      const res = await authFetch(path, { method, body: JSON.stringify(body) });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      await onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      // NOTE: no backdrop click-to-close. A stray click outside the modal
      // would nuke in-progress codes. Users close via X or Cancel.
    >
      <div className="bg-white rounded-card shadow-2 max-w-md w-full">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-line">
          <div>
            <h3 className="text-base font-semibold text-ink">
              {mode === 'create' ? 'Add supplier to community' : 'Edit assignment'}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {community.name} ({community.code})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-ink p-1 -m-1"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          {/* Supplier picker (create only) */}
          {mode === 'create' ? (
            <div>
              <label className="text-[11px] uppercase tracking-[0.06em] font-semibold text-zinc-500 block mb-1">
                Supplier
              </label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className={inputClass}
                disabled={submitting}
              >
                <option value="">— Choose a supplier —</option>
                {availableSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <div className="text-[11px] uppercase tracking-[0.06em] font-semibold text-zinc-500 mb-1">
                Supplier
              </div>
              <div className="text-[13px] text-ink">
                {existing?.suppliers?.name} ({existing?.suppliers?.code})
              </div>
            </div>
          )}

          {/* Vendor code */}
          <div>
            <label className="text-[11px] uppercase tracking-[0.06em] font-semibold text-zinc-500 block mb-1">
              Corcentric vendor code *
            </label>
            <input
              type="text"
              value={vendorCode}
              onChange={(e) => setVendorCode(e.target.value)}
              placeholder="e.g. IPWS-EASYLBS"
              className={cn(inputClass, 'font-mono')}
              disabled={submitting}
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              The identifier Corcentric uses for this supplier in this DMS.
              Defaults to the supplier code; override if Corcentric assigned
              a different value.
            </p>
          </div>

          {/* Customer code (optional default) */}
          <div>
            <label className="text-[11px] uppercase tracking-[0.06em] font-semibold text-zinc-500 block mb-1">
              Default customer code <span className="text-zinc-400 normal-case">(optional)</span>
            </label>
            <input
              type="text"
              value={customerCode}
              onChange={(e) => setCustomerCode(e.target.value)}
              placeholder="Used when ShipTo / BillTo name doesn't match"
              className={cn(inputClass, 'font-mono')}
              disabled={submitting}
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Fallback customer code used when the OCR ship-to/bill-to name
              doesn't resolve to a customer. Leave blank to require a customer
              match per invoice.
            </p>
          </div>

          {/* Primary flag */}
          <div>
            <label className="flex items-center gap-2 text-[12px] text-ink">
              <input
                type="checkbox"
                checked={isPrimary}
                onChange={(e) => setIsPrimary(e.target.checked)}
                disabled={submitting}
              />
              <span>
                Make this the supplier's <strong>primary</strong> community
              </span>
            </label>
            <p className="text-[11px] text-zinc-500 mt-1 ml-5">
              Used as the default community for submission and auto-ingestion
              when no community is otherwise specified. Setting this here
              demotes any other primary the supplier has.
            </p>
          </div>

          {err && (
            <div className="bg-danger-soft border border-danger/20 rounded-control px-2.5 py-2 text-xs text-danger">
              {err}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : mode === 'create' ? 'Add' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({
  community,
  onCancel,
  onConfirm,
}: {
  community: Community;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState(false);
  async function go() {
    setPending(true);
    await onConfirm();
    setPending(false);
  }
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ background: 'rgba(10,11,13,0.5)', backdropFilter: 'blur(3px)' }}
      // NOTE: no backdrop click-to-close. Confirm/cancel via explicit
      // buttons — prevents accidental dismiss of a destructive action prompt.
    >
      <div className="bg-white rounded-card shadow-2 max-w-sm w-full p-5">
        <div className="flex items-start gap-3 mb-3">
          <AlertTriangle size={18} className="text-danger shrink-0 mt-0.5" />
          <div>
            <h3 className="text-base font-semibold text-ink">
              Delete {community.name}?
            </h3>
            <p className="text-sm text-zinc-700 mt-1.5">
              This is a soft delete — the community is hidden but historical
              submissions remain. Suppliers tied to this community will need to
              be reassigned.
            </p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" onClick={go} disabled={pending}>
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
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
    <td className={`text-${align} text-[13px] px-4 py-3 align-middle ${className}`}>
      {children}
    </td>
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
